import type {
  Artwork,
  AudioProperties,
  FormatId,
  MusicMetadata,
  RawTag,
} from "../metadata/types";

/** A file handle we can re-read on demand. */
export interface FileRef {
  /** Stable id. */
  id: string;
  name: string;
  /** Folder path relative to the library root, or the absolute path. */
  folder: string;
  size: number;
  modifiedAt: number;
  /** The live File object, when the platform gives us one. */
  file: File;
  /** Set when the file came from a granted directory we can write to. */
  handle?: FileSystemFileHandle;
  /** The granted directory this file lives in, for backups and renames. */
  folderHandle?: FileSystemDirectoryHandle;
  /** True when we can write changes back in place. */
  writable: boolean;
}

export type TagStatus = "clean" | "dirty" | "unsaved" | "error";

/**
 * Unsaved edits for one file, layered over `onDisk`. Stored separately from
 * the file record so an edit never has to copy the whole metadata object.
 */
export interface PendingEdit {
  fileId: string;
  /** Fields set to a new value. */
  values: Partial<MusicMetadata>;
  /** Fields explicitly cleared (empty string / empty array). */
  cleared: string[];
  /** Proposed filename, when a rename is pending. */
  newName?: string;
}

export interface LibraryFile extends FileRef {
  format: FormatId;
  metadata: MusicMetadata;
  /** Metadata as it exists on disk right now. */
  onDisk: MusicMetadata;
  audio: AudioProperties;
  raw: RawTag[];
  warnings: string[];
  tagScheme: string;
  /** Pending edits, relative to `onDisk`. Mirrors the store's `pending` map. */
  pending?: PendingEdit;
  /**
   * How many embedded images the file has. The scan drops image bytes so a
   * large import does not clone megabytes per file; this lets the UI tell
   * "no artwork" apart from "artwork not loaded yet" and fetch it lazily.
   */
  artworkCount?: number;
  tagStatus: TagStatus;
  dirty: boolean;
  error?: string;
  /** Content hash of the tag region, used for duplicate detection. */
  contentHash?: string;
  /**
   * Where this file's pre-write copy was stored by the most recent save.
   * Set only when backups are enabled and the platform gave us somewhere to
   * put one; it is what makes a save reversible.
   */
  backupPath?: string;
  addedAt: number;
}

export type FileRecord = LibraryFile;

export interface LibraryStats {
  files: number;
  albums: number;
  artists: number;
  genres: number;
  folders: number;
  totalBytes: number;
  withArtwork: number;
  missingArtwork: number;
  missingMetadata: number;
  duplicates: number;
  lossless: number;
  lossy: number;
  byFormat: Array<{ format: string; count: number; bytes: number }>;
  byYear: Array<{ year: number; count: number }>;
  byGenre: Array<{ genre: string; count: number }>;
  topArtists: Array<{ artist: string; count: number }>;
  health: {
    metadataCompleteness: number;
    artworkCoverage: number;
    filenameConsistency: number;
  };
}

export interface HistoryEntry {
  id: string;
  at: number;
  operation: string;
  /** Files touched, with old and new values. */
  changes: Array<{
    fileId: string;
    fileName: string;
    field: string;
    before: unknown;
    after: unknown;
  }>;
  /** Populated for write operations. */
  writeResult?: "applied" | "failed" | "partial" | "undone";
  /** Where the pre-write copy was stored, when backups are enabled. */
  backupPath?: string;
  /** One entry per file, because a single save covers many files. */
  backups?: Array<{ fileId: string; fileName: string; path: string }>;
  errors?: string[];
  undoable: boolean;
}

export interface RenamePlanItem {
  fileId: string;
  from: string;
  to: string;
  collision?: string;
}

export interface DuplicateGroup {
  id: string;
  kind: "exact" | "metadata" | "fingerprint";
  members: string[];
  key: string;
  totalBytes: number;
}

export interface PreviewRow {
  fileId: string;
  fileName: string;
  field: string;
  before: string;
  after: string;
  changed: boolean;
}

export interface BulkOperationResult {
  completed: number;
  skipped: number;
  failed: number;
  errors: Array<{ fileName: string; reason: string }>;
  warnings: string[];
}

export interface SavedColumnState {
  id: string;
  label: string;
  width: number;
  visible: boolean;
  align?: "left" | "right" | "center";
  groupable?: boolean;
}

export interface ColumnDef extends SavedColumnState {
  /** Where the value comes from. */
  accessor: (file: LibraryFile) => string | number | boolean | undefined;
  /** Value used for sorting and grouping (numbers stay numeric). */
  raw?: (file: LibraryFile) => string | number | undefined;
  groupValue?: (file: LibraryFile) => string | undefined;
  mono?: boolean;
}

export type { Artwork, AudioProperties, FormatId, MusicMetadata, RawTag };