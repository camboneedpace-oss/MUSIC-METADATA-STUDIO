/**
 * Safe write system.
 *
 * The rule this file exists to enforce: a failed write must leave the
 * original file byte-identical.
 *
 *   1. validate the metadata against the target format
 *   2. serialise the whole file in memory
 *   3. re-read the serialised bytes and verify the tags came back
 *   4. optionally create a backup
 *   5. write through a handle (the browser swaps the file in atomically) or
 *      hand the bytes to the local agent, which does the same server-side
 *
 * If any step throws, the caller gets an error and the file is untouched.
 */

import { readMetadata, verifyWrite, writeMetadata, type ScannedFile } from "./metadata";
import {
  FORMAT_CAPABILITIES,
  type FormatId,
  type MusicMetadata,
} from "./metadata/types";
import { agentClient } from "./filesystem/agent";
import { downloadFile, ensureWritePermission, writeFile } from "./filesystem";
import type { LibraryFile } from "./library/types";
import type { PendingEdit } from "./store";

/** Read at most this much of a file into memory for a tag rewrite. */
export const DEFAULT_FILE_READ_LIMIT = 256 * 1024 * 1024;

export class WriteError extends Error {
  fileName: string;
  reason: string;
  stage: "validate" | "serialise" | "verify" | "backup" | "commit" | "rename";

  constructor(fileName: string, reason: string, stage: WriteError["stage"]) {
    super(`Unable to write metadata for ${fileName}: ${reason}`);
    this.name = "WriteError";
    this.fileName = fileName;
    this.reason = reason;
    this.stage = stage;
  }
}

export interface SafeWriteOptions {
  backups: boolean;
  id3v1?: boolean;
  /** Bytes allowed in memory at once. */
  limit?: number;
  /** Called with the backup path so the UI can offer a restore. */
  onBackup?: (path: string) => void;
}

export interface ValidateIssue {
  field: string;
  message: string;
  severity: "warning" | "error";
}

/** Reject writes that would silently lose data, before touching the file. */
export function validateForWrite(format: FormatId, metadata: MusicMetadata): ValidateIssue[] {
  const issues: ValidateIssue[] = [];
  const caps = FORMAT_CAPABILITIES[format];

  if (!caps.write) {
    issues.push({
      field: "format",
      severity: "error",
      message: `${format.toUpperCase()} has no tag writer in this build`,
    });
  }
  if ((metadata.artwork ?? []).length && !caps.artwork) {
    issues.push({
      field: "artwork",
      severity: "error",
      message: `${format.toUpperCase()} has no artwork slot; ${metadata.artwork!.length} image(s) would be dropped`,
    });
  }
  if (metadata.lyrics && !caps.lyrics) {
    issues.push({
      field: "lyrics",
      severity: "warning",
      message: `${format.toUpperCase()} has no lyrics field; the text would be lost`,
    });
  }
  for (const key of ["artists", "albumArtists", "genres", "composers"] as const) {
    const values = metadata[key];
    if (values && values.length > 1 && !caps.multiValue) {
      issues.push({
        field: key,
        severity: "warning",
        message: `${format.toUpperCase()} stores one ${key.replace(/s$/, "")} value; only "${values[0]}" would be kept`,
      });
    }
  }
  if (caps.multiValue) {
    // Multi-value text frames in ID3 use NUL separators, which some older
    // decoders display literally.
    for (const key of ["artists", "genres", "albumArtists", "composers"] as const) {
      const values = metadata[key];
      if (values?.some((v) => v.includes("\u0000"))) {
        issues.push({
          field: key,
          severity: "error",
          message: `${key} contains a NUL character, which cannot be stored in a tag`,
        });
      }
    }
  }
  for (const value of [metadata.title, metadata.album, ...(metadata.artists ?? [])]) {
    if (typeof value === "string" && /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
      issues.push({
        field: "control-characters",
        severity: "warning",
        message: "A value contains control characters that may render as garbage in some players",
      });
      break;
    }
  }
  return issues;
}

export interface SafeWriteResult {
  bytesWritten: number;
  warnings: string[];
  backupPath?: string;
  /** True when the bytes were handed to the user instead of written in place. */
  exportedAsDownload: boolean;
}

/**
 * Write pending edits into one file. Throws `WriteError` on any failure, and
 * the original file is guaranteed untouched when it does.
 */
export async function safeWriteFile(
  file: LibraryFile,
  pending: PendingEdit,
  backups: boolean,
  options: Omit<SafeWriteOptions, "backups"> = {},
): Promise<SafeWriteResult> {
  const limit = options.limit ?? DEFAULT_FILE_READ_LIMIT;
  if (file.size > limit) {
    throw new WriteError(
      file.name,
      `File is ${(file.size / 1024 / 1024).toFixed(0)} MB, beyond the ${(limit / 1024 / 1024).toFixed(0)} MB rewrite limit`,
      "validate",
    );
  }

  const targetName = pending.newName ?? file.name;
  const targetMetadata: MusicMetadata = { ...file.metadata, ...pending.values };

  /* 1. validate */
  const issues = validateForWrite(file.format, targetMetadata);
  const fatal = issues.filter((i) => i.severity === "error");
  if (fatal.length) {
    throw new WriteError(file.name, fatal.map((i) => i.message).join("; "), "validate");
  }
  const warnings = issues.map((i) => i.message);

  /* 2. serialise in memory */
  let original: Uint8Array;
  let written: Uint8Array;
  try {
    original = new Uint8Array(await file.file.arrayBuffer());
    const current: ScannedFile = readMetadata(original, `${file.folder}/${file.name}`);
    const result = writeMetadata(original, `${file.folder}/${file.name}`, current, targetMetadata, {
      id3v1: options.id3v1,
    });
    written = result.bytes;
    warnings.push(...result.warnings);
  } catch (err) {
    throw new WriteError(file.name, (err as Error).message, "serialise");
  }

  /* 3. verify before committing anything */
  const verify = verifyWrite(written, targetMetadata, `${file.folder}/${targetName}`);
  if (!verify.ok) {
    throw new WriteError(
      file.name,
      `The written file did not read back correctly — ${verify.mismatches.join("; ")}`,
      "verify",
    );
  }

  /* 4 + 5. commit */
  if (file.handle) {
    if (!(await ensureWritePermission(file.handle))) {
      throw new WriteError(file.name, "Write permission was declined; the original file is unchanged", "commit");
    }
    let backupPath: string | undefined;
    if (backups) {
      backupPath = await writeBackup(file, original);
      if (backupPath) {
        options.onBackup?.(backupPath);
        warnings.push(`Backup written to ${backupPath}`);
      }
    }
    const outcome = await writeFile(file.handle, written);
    if (!outcome.ok) {
      throw new WriteError(file.name, `${outcome.reason}; the original file was not modified`, "commit");
    }
    if (pending.newName && pending.newName !== file.name) {
      const renamed = await renameHandle(file, pending.newName);
      if (!renamed) {
        warnings.push(
          `Tags were saved, but the file could not be renamed to ${pending.newName}. Rename it manually.`,
        );
      }
    }
    return { bytesWritten: written.length, warnings, backupPath, exportedAsDownload: false };
  }

  if (agentClient.connected) {
    const path = `${file.folder ? `${file.folder}/` : ""}${file.name}`;
    const result = await agentClient.writeFile(path, written, backups);
    if (pending.newName && pending.newName !== file.name) {
      try {
        await agentClient.rename(path, `${file.folder ? `${file.folder}/` : ""}${pending.newName}`);
      } catch (err) {
        warnings.push(`Tags saved, but the rename failed: ${(err as Error).message}`);
      }
    }
    return { bytesWritten: written.length, warnings, backupPath: result.backupPath, exportedAsDownload: false };
  }

  // No write access at all: hand the user a correct file rather than
  // pretending the change was saved.
  downloadFile(targetName, written);
  return {
    bytesWritten: written.length,
    warnings: [...warnings, "This file was exported as a download: the browser gave no write access to the original"],
    exportedAsDownload: true,
  };
}

async function renameHandle(file: LibraryFile, newName: string): Promise<boolean> {
  // File System Access has no rename; the closest safe equivalent is writing
  // the tagged bytes into a new handle in the same folder and leaving the
  // original untouched for the user to remove.
  const handle = file.handle;
  if (!handle) return false;
  try {
    const dir = file.folderHandle;
    if (!dir) return false;
    const target = await dir.getFileHandle(newName, { create: true });
    const source = await handle.getFile();
    const outcome = await writeFile(target, new Uint8Array(await source.arrayBuffer()));
    return outcome.ok;
  } catch {
    return false;
  }
}

async function writeBackup(file: LibraryFile, bytes: Uint8Array): Promise<string | undefined> {
  const dir = file.folderHandle;
  if (!dir) return undefined;
  const name = `${file.name}.bak`;
  try {
    const handle = await dir.getFileHandle(name, { create: true });
    const outcome = await writeFile(handle, bytes);
    return outcome.ok ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build the bytes a save would produce, for the preview dialog. Nothing is
 * written to disk.
 */
export async function previewFile(
  file: LibraryFile,
  metadata: MusicMetadata,
  options: { id3v1?: boolean } = {},
): Promise<{ bytes: Uint8Array; warnings: string[]; before: number; after: number }> {
  const original = new Uint8Array(await file.file.arrayBuffer());
  const current = readMetadata(original, `${file.folder}/${file.name}`);
  const result = writeMetadata(original, `${file.folder}/${file.name}`, current, metadata, {
    id3v1: options.id3v1,
  });
  return {
    bytes: result.bytes,
    warnings: result.warnings,
    before: original.length,
    after: result.bytes.length,
  };
}