/**
 * Filesystem access.
 *
 * Three tiers, in descending order of capability:
 *
 *  1. File System Access API — a granted directory we can read *and* write,
 *     and rename. The permission survives a reload if the user re-grants it.
 *  2. File API / drag-drop — read-only in practice; we export a copy instead.
 *  3. Local agent — a companion service on localhost for recursive scanning,
 *     atomic writes, backups and renames.
 *
 * We never request broader permission than the operation needs.
 */

import { AUDIO_EXTENSIONS, formatFromPath } from "../metadata/types";

export const AUDIO_EXT_SET = new Set(AUDIO_EXTENSIONS);

export function looksLikeAudio(name: string): boolean {
  return AUDIO_EXT_SET.has(extensionOf(name));
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/* ---------- capability detection ---------- */

export interface FsCapabilities {
  directoryPicker: boolean;
  fileHandles: boolean;
  showSaveFilePicker: boolean;
  showOpenFilePicker: boolean;
  dragDrop: boolean;
  opfs: boolean;
}

const NO_CAPABILITIES: FsCapabilities = {
  directoryPicker: false,
  fileHandles: false,
  showSaveFilePicker: false,
  showOpenFilePicker: false,
  dragDrop: false,
  opfs: false,
};

export function detectCapabilities(): FsCapabilities {
  // Called at module init, so it has to survive a non-browser context.
  if (typeof window === "undefined") return { ...NO_CAPABILITIES };
  const w = window as unknown as Record<string, unknown>;
  return {
    directoryPicker: typeof w.showDirectoryPicker === "function",
    fileHandles: typeof FileSystemFileHandle !== "undefined",
    showSaveFilePicker: typeof w.showSaveFilePicker === "function",
    showOpenFilePicker: typeof w.showOpenFilePicker === "function",
    dragDrop: "DataTransfer" in window,
    opfs: typeof navigator.storage?.getDirectory === "function",
  };
}

export type FsMode = "handle" | "file" | "agent" | "none";

export function modeFor(caps: FsCapabilities, agentConnected: boolean): FsMode {
  if (caps.directoryPicker) return "handle";
  if (agentConnected) return "agent";
  if (caps.dragDrop) return "file";
  return "none";
}

/* ---------- collection ---------- */

export interface CollectedFile {
  file: File;
  /** Path relative to the import root, using forward slashes. */
  path: string;
  folder: string;
  name: string;
  size: number;
  modifiedAt: number;
  handle?: FileSystemFileHandle;
}

/** Drop targets hand us a flat list; we re-derive relative folders from paths. */
export async function fromDataTransfer(dt: DataTransfer): Promise<CollectedFile[]> {
  const out: CollectedFile[] = [];
  const entries: FileSystemEntry[] = [];

  const items = Array.from(dt.items ?? []);
  if (items.length) {
    for (const item of items) {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null })
        .webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
  }
  if (entries.length) {
    await Promise.all(entries.map((entry) => walkEntry(entry, "", out)));
    if (out.length) return out;
  }

  for (const file of Array.from(dt.files ?? [])) {
    if (!looksLikeAudio(file.name)) continue;
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    out.push(toCollected(file, rel));
  }
  return out;
}

function toCollected(file: File, relativePath: string, handle?: FileSystemFileHandle): CollectedFile {
  const clean = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const slash = clean.lastIndexOf("/");
  return {
    file,
    path: clean,
    folder: slash === -1 ? "" : clean.slice(0, slash),
    name: slash === -1 ? clean : clean.slice(slash + 1),
    size: file.size,
    modifiedAt: file.lastModified,
    handle,
  };
}

/**
 * Recursive directory walk with a hard cap, so a mis-drop of a home directory
 * cannot lock the tab up.
 */
const MAX_FILES = 250_000;
const MAX_DEPTH = 24;

async function walkEntry(entry: FileSystemEntry, prefix: string, out: CollectedFile[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    if (!looksLikeAudio(entry.name)) return;
    const file = await new Promise<File | null>((resolve) => fileEntry.file(resolve, () => resolve(null)));
    if (file) out.push(toCollected(file, `${prefix}${entry.name}`));
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const nextPrefix = prefix ? `${prefix}${entry.name}/` : `${entry.name}/`;
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) =>
      reader.readEntries(resolve, () => resolve([])),
    );
    if (!batch.length) break;
    for (const child of batch) {
      if (child.name.startsWith(".")) continue;
      await walkEntry(child, nextPrefix, out);
      if (out.length >= MAX_FILES) return;
    }
  }
}

/** Recursive scan of a granted directory handle. */
export async function scanDirectory(
  dir: FileSystemDirectoryHandle,
  onProgress?: (found: number) => void,
  signal?: AbortSignal,
): Promise<CollectedFile[]> {
  const out: CollectedFile[] = [];
  await walkHandle(dir, "", out, 0, onProgress, signal);
  return out;
}

async function walkHandle(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: CollectedFile[],
  depth: number,
  onProgress?: (found: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  if (signal?.aborted) return;

  const iterator = (dir as unknown as {
    values(): AsyncIterableIterator<FileSystemHandle>;
  }).values();

  for await (const handle of iterator) {
    if (signal?.aborted || out.length >= MAX_FILES) return;
    if (handle.kind === "directory") {
      if (handle.name.startsWith(".")) continue;
      await walkHandle(
        handle as FileSystemDirectoryHandle,
        `${prefix}${handle.name}/`,
        out,
        depth + 1,
        onProgress,
        signal,
      );
      continue;
    }
    const fileHandle = handle as FileSystemFileHandle;
    if (!looksLikeAudio(fileHandle.name)) continue;
    try {
      const file = await fileHandle.getFile();
      out.push(toCollected(file, `${prefix}${fileHandle.name}`, fileHandle));
    } catch {
      // A file we cannot open right now (in use, permission revoked) should not
      // abort the whole scan.
      continue;
    }
    if (onProgress && out.length % 200 === 0) onProgress(out.length);
  }
  onProgress?.(out.length);
}

/* ---------- writing ---------- */

export interface WriteOutcome {
  ok: boolean;
  reason?: string;
  bytesWritten: number;
  backupPath?: string;
}

/**
 * Write through a granted handle, using the safest primitive available:
 * `createWritable({ keepExistingData: false })` writes to a swap file that the
 * browser renames into place, so a failure cannot leave a half-written tag.
 */
export async function writeFile(handle: FileSystemFileHandle, data: Uint8Array): Promise<WriteOutcome> {
  if (!("createWritable" in handle)) {
    return { ok: false, reason: "This browser cannot write through a file handle", bytesWritten: 0 };
  }
  try {
    const writable = await (handle as FileSystemFileHandle & {
      createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
    }).createWritable({ keepExistingData: false });
    await writable.write(data);
    await writable.close();
    return { ok: true, bytesWritten: data.length };
  } catch (err) {
    const message = (err as Error).message || String(err);
    if (/permission|denied|notallowed/i.test(message)) {
      return { ok: false, reason: "Permission denied", bytesWritten: 0 };
    }
    return { ok: false, reason: message, bytesWritten: 0 };
  }
}

/** Ask for write permission on an existing handle without a user gesture. */
export async function ensureWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as FileSystemFileHandle & {
    queryPermission?: (d: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (d: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
  };
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
  if (!h.requestPermission) return false;
  return (await h.requestPermission({ mode: "readwrite" })) === "granted";
}

/** Download a modified copy, for files we have no write access to. */
export function downloadFile(name: string, data: Uint8Array): void {
  const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------- drag helpers ---------- */

export function isAudioFileList(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  if (Array.from(dt.types ?? []).includes("Files")) return true;
  return Array.from(dt.items ?? []).some((i) => i.kind === "file");
}

/** Suggested export filename so two exports never collide in one folder. */
export function uniqueName(desired: string, taken: Set<string>): string {
  if (!taken.has(desired.toLowerCase())) return desired;
  const dot = desired.lastIndexOf(".");
  const stem = dot === -1 ? desired : desired.slice(0, dot);
  const ext = dot === -1 ? "" : desired.slice(dot);
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

export function detectFormatFromName(name: string) {
  return formatFromPath(name);
}