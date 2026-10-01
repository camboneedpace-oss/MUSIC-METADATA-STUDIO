/**
 * Application store.
 *
 * One store, split into slices by concern. State is deliberately normalised
 * enough to stay fast: files live in a Map, the visible list is a derived
 * array of ids, and pending edits are stored per file rather than by copying
 * whole records.
 */

import { create } from "zustand";
import { useMemo } from "react";
import { detectCapabilities, type FsCapabilities, ensureWritePermission, writeFile } from "../filesystem";
import { agentClient, type AgentStatus } from "../filesystem/agent";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type StoredSettings,
} from "../db/idb";
import type { FormatId, MusicMetadata } from "../metadata/types";
import { formatFromPath } from "../metadata/types";
import { matchesClause, matchesText, parseQuery } from "../search/query";
import { verifyWrite, writeMetadata, type ScannedFile } from "../metadata";
import { isLossless } from "../metadata/types";
import { readArtwork, scanFiles, type ScannedResult } from "../workers/scan-client";
import {
  DEFAULT_FILE_READ_LIMIT,
  safeWriteFile,
} from "../safe-write";
import type {
  BulkOperationResult,
  FileRef,
  HistoryEntry,
  LibraryFile,
  PendingEdit,
  RenamePlanItem,
} from "../library/types";

/* ---------- ids ---------- */

let idCounter = 0;
export function nextId(prefix = "id"): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/* ---------- selection model ---------- */

export interface Selection {
  /** Explicitly selected ids. */
  set: Set<string>;
  /** Anchor for shift-range selection. */
  anchor: string | null;
  lastClicked: string | null;
}

const emptySelection = (): Selection => ({ set: new Set(), anchor: null, lastClicked: null });

/* ---------- pending edits ---------- */

export type { PendingEdit };

export interface Operation {
  id: string;
  label: string;
  at: number;
  /** Per-file change sets, enough to undo exactly what happened. */
  entries: Array<{
    fileId: string;
    before: Partial<MusicMetadata>;
    after: Partial<MusicMetadata>;
    beforeName?: string;
    afterName?: string;
  }>;
}

export type Panel = "library" | "inspector" | "artwork" | "history" | "actions";

export interface Toast {
  id: string;
  kind: "info" | "success" | "warning" | "error";
  message: string;
  detail?: string;
  at: number;
  /** Optional undo affordance. */
  undoOperationId?: string;
  duration?: number;
}

export interface ScanProgress {
  active: boolean;
  done: number;
  total: number;
  current: string;
  byFormat: Record<string, number>;
  bytes: number;
}

export interface AppState {
  /* files */
  files: Map<string, LibraryFile>;
  order: string[];
  roots: Array<{ name: string; path: string; writable: boolean; source: string }>;
  scan: ScanProgress;
  scanning: boolean;

  /* environment */
  capabilities: FsCapabilities;
  agent: AgentStatus;
  writeMode: "handle" | "file" | "agent" | "none";
  settings: StoredSettings;
  settingsLoaded: boolean;

  /* selection + view */
  selection: Selection;
  visibleIds: string[];
  query: string;
  activeView: string;
  sidebarView: string;
  panels: Record<Panel, boolean>;
  sort: Array<{ column: string; desc: boolean }>;
  columnOrder: string[];
  hiddenColumns: Set<string>;

  /* edits */
  pending: Map<string, PendingEdit>;
  undoStack: Operation[];
  redoStack: Operation[];
  history: HistoryEntry[];
  clipboard?: { fileId: string; metadata: MusicMetadata; fields: string[] };

  /* ui */
  toasts: Toast[];
  busy: { label: string; detail?: string; progress?: number } | null;

  /* actions */
  /** Name of the dialog currently open, or null. */
  dialog: string | null;
  dialogPayload: unknown;
}

export interface AppActions {
  init(): Promise<void>;
  addFiles(files: Array<{ file: File; path: string; folder: string; name: string; size: number; modifiedAt: number; handle?: FileSystemFileHandle }>): Promise<void>;
  openFolder(): Promise<void>;
  pickFiles(): Promise<void>;
  clearLibrary(): void;
  rescan(): Promise<void>;
  detectAgent(): Promise<void>;
  /** Re-read one file's embedded artwork, which the scan path drops. */
  ensureArtwork(fileId: string): Promise<void>;

  select(ids: string[], mode?: "replace" | "toggle" | "range" | "all" | "none"): void;
  selectAll(): void;
  clearSelection(): void;

  setQuery(q: string): void;
  setView(view: string): void;
  setSidebarView(view: string): void;
  togglePanel(panel: Panel): void;
  setSort(column: string, additive?: boolean): void;
  setColumnOrder(order: string[]): void;
  toggleColumn(id: string): void;

  applyEdits(edits: Array<{ fileId: string; changes: Partial<MusicMetadata>; cleared?: string[] }>, label: string): void;
  clearField(fileId: string, field: keyof MusicMetadata, label?: string): void;
  queueRename(items: RenamePlanItem[], label: string): void;
  discardChanges(fileIds?: string[]): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  save(only?: string[]): Promise<BulkOperationResult>;
  restoreBackup(entryId: string): Promise<void>;

  toast(t: Omit<Toast, "id" | "at">): void;
  dismissToast(id: string): void;
  setBusy(label: string | null, detail?: string, progress?: number): void;
  openDialog(name: string, payload?: unknown): void;
  closeDialog(): void;
  updateSettings(patch: Partial<StoredSettings>): Promise<void>;
  applyTheme(): void;

  copyMetadata(fileId: string, fields: string[]): void;
  pasteMetadata(fileId: string, fields: string[]): void;
  pushHistory(entry: HistoryEntry): void;
  /** Drop the audit trail. Undo/redo stacks are untouched. */
  clearHistory(): void;
}

export type Store = AppState & AppActions;

const initialScan: ScanProgress = {
  active: false,
  done: 0,
  total: 0,
  current: "",
  byFormat: {},
  bytes: 0,
};

export const useStore = create<Store>((set, get) => ({
  files: new Map(),
  order: [],
  roots: [],
  scan: initialScan,
  scanning: false,
  capabilities: detectCapabilities(),
  agent: { state: "checking" },
  writeMode: "none",
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  selection: emptySelection(),
  visibleIds: [],
  query: "",
  activeView: "all",
  sidebarView: "all",
  panels: { library: false, inspector: true, artwork: false, history: false, actions: false },
  sort: [{ column: "track", desc: false }],
  columnOrder: [],
  hiddenColumns: new Set(),
  pending: new Map(),
  undoStack: [],
  redoStack: [],
  history: [],
  toasts: [],
  busy: null,
  dialog: null,
  dialogPayload: null,

  /* ------------------------------------------------------------------ init */

  async init() {
    const settings = await loadSettings().catch(() => DEFAULT_SETTINGS);
    set({ settings, settingsLoaded: true });
    get().applyTheme();
    void get().detectAgent();
  },

  applyTheme() {
    const { settings } = get();
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.style.setProperty("--accent", settings.accent);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", settings.theme === "light" ? "#eef0f3" : "#0b0c0e");
  },

  async updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    get().applyTheme();
    await saveSettings(settings).catch(() => undefined);
  },

  /* --------------------------------------------------------------- importing */

  async addFiles(collections) {
    if (!collections.length) return;
    set({ scanning: true, scan: { ...initialScan, active: true, total: collections.length } });

    const files = new Map(get().files);
    const order = [...get().order];
    const byFormat: Record<string, number> = {};
    const entries: LibraryFile[] = [];

    for (const collected of collections) {
      const id = nextId("file");
      const file: LibraryFile = {
        id,
        name: collected.name,
        folder: collected.folder,
        size: collected.size,
        modifiedAt: collected.modifiedAt,
        file: collected.file,
        handle: collected.handle,
        writable: Boolean(collected.handle),
        format: "mp3",
        metadata: {},
        onDisk: {},
        audio: {},
        raw: [],
        warnings: [],
        tagScheme: "None",
        tagStatus: "clean",
        dirty: false,
        addedAt: Date.now(),
      };
      files.set(id, file);
      order.push(id);
      entries.push(file);
    }
    // Publish the rows straight away so the table is populated while the
    // worker pool is still parsing.
    set({ files: new Map(files), order: [...order] });
    recomputeVisible(set, get);

    const run = scanFiles(
      entries.map((file) => ({
        id: file.id,
        path: `${file.folder}/${file.name}`,
        source: file.file,
        hash: false,
      })),
      {
        workers: get().settings.workerCount,
        onResult: (result) => {
          applyScanResult(get, set, files, byFormat, result);
        },
        onProgress: (progress) => {
          set({ scan: { ...get().scan, ...progress, active: true } });
        },
      },
    );

    await run.done;
    set({ files, order, scanning: false, scan: { ...get().scan, active: false } });
    recomputeVisible(set, get);
    get().toast({
      kind: "success",
      message: `${entries.length} file${entries.length === 1 ? "" : "s"} imported`,
      detail: summariseFormats(byFormat),
    });
  },

  async openFolder() {
    const caps = get().capabilities;
    if (!caps.directoryPicker) {
      get().toast({
        kind: "warning",
        message: "This browser cannot open folders directly",
        detail: "Drag a folder onto the window instead, or connect the local agent for recursive scanning.",
      });
      return;
    }
    try {
      const picker = (window as unknown as { showDirectoryPicker: (o?: unknown) => Promise<FileSystemDirectoryHandle> });
      const dir = await picker.showDirectoryPicker({ id: "music-library", mode: "readwrite" });
      const { scanDirectory } = await import("../filesystem");
      const collected = await scanDirectory(dir, (found) =>
        set({ scan: { ...get().scan, done: found, active: true } }),
      );
      set({
        roots: [...get().roots, { name: dir.name, path: dir.name, writable: true, source: "handle" }],
        writeMode: "handle",
      });
      await get().addFiles(collected);
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      get().toast({ kind: "error", message: "Could not open that folder", detail: (err as Error).message });
    }
  },

  async pickFiles() {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "audio/*,.mp3,.flac,.m4a,.ogg,.opus,.wav,.aiff,.ape,.wma,.wv,.mpc";
    input.onchange = () => {
      const list = Array.from(input.files ?? []);
      void get().addFiles(
        list.map((file) => ({
          file,
          path: file.name,
          folder: "",
          name: file.name,
          size: file.size,
          modifiedAt: file.lastModified,
        })),
      );
    };
    input.click();
  },

  clearLibrary() {
    set({
      files: new Map(),
      order: [],
      roots: [],
      pending: new Map(),
      selection: emptySelection(),
      visibleIds: [],
      undoStack: [],
      redoStack: [],
      scan: initialScan,
    });
    get().toast({ kind: "info", message: "Library cleared" });
  },

  async rescan() {
    const entries = [...get().files.values()];
    if (!entries.length) {
      get().toast({ kind: "info", message: "Nothing to rescan" });
      return;
    }
    set({ scanning: true, scan: { ...initialScan, active: true, total: entries.length } });
    const files = new Map(get().files);
    const byFormat: Record<string, number> = {};

    const run = scanFiles(
      entries.map((file) => ({
        id: file.id,
        path: `${file.folder}/${file.name}`,
        source: file.file,
        hash: false,
      })),
      {
        workers: get().settings.workerCount,
        onResult: (result) => {
          const file = files.get(result.id);
          if (!file) return;
          const pending = get().pending.get(result.id);
          const hasPending = Boolean(pending && Object.keys(pending.values).length > 0);
          byFormat[result.format] = (byFormat[result.format] ?? 0) + 1;
          files.set(result.id, {
            ...file,
            format: result.format,
            artworkCount: result.artworkCount,
            contentHash: result.contentHash ?? file.contentHash,
            onDisk: result.metadata,
            // Unsaved edits win over what is actually on disk.
            metadata: hasPending ? { ...result.metadata, ...pending!.values } : result.metadata,
            audio: result.audio,
            raw: result.raw,
            warnings: result.warnings,
            tagScheme: result.tagScheme,
            tagStatus: result.error ? "error" : hasPending ? "dirty" : "clean",
            dirty: hasPending,
            error: result.error ?? (isReadableAudio(result.path, result.tagScheme) ? undefined : `No audio or tags found in ${result.path}`),
          });
        },
        onProgress: (progress) => {
          set({ scan: { ...get().scan, ...progress, active: true } });
        },
      },
    );

    await run.done;
    const dirtyCount = [...files.values()].filter((f) => f.dirty).length;
    set({ files, scanning: false, scan: { ...get().scan, active: false } });
    recomputeVisible(set, get);
    get().toast({
      kind: "success",
      message: `Rescanned ${entries.length} files`,
      detail: dirtyCount ? `${dirtyCount} file(s) kept unsaved edits` : undefined,
    });
  },

  async ensureArtwork(fileId) {
    const file = get().files.get(fileId);
    if (!file || file.artworkCount === 0 || file.metadata.artwork?.length) return;
    try {
      const artwork = await readArtwork(file.file, `${file.folder}/${file.name}`);
      if (!artwork.length) return;
      const files = new Map(get().files);
      const current = files.get(fileId);
      if (!current) return;
      files.set(fileId, { ...current, metadata: { ...current.metadata, artwork } });
      set({ files });
    } catch {
      // A missing thumbnail is not worth interrupting the user over.
    }
  },

  async detectAgent() {
    set({ agent: { state: "checking" } });
    const status = await agentClient.discover();
    set({
      agent: status,
      writeMode:
        get().capabilities.directoryPicker ? "handle" : status.state === "connected" ? "agent" : "file",
    });
  },

  /* -------------------------------------------------------------- selection */

  select(ids, mode = "replace") {
    const current = get().selection;
    const next = new Set<string>();
    if (mode === "replace") {
      for (const id of ids) next.add(id);
    } else if (mode === "toggle") {
      for (const id of ids) {
        if (current.set.has(id)) next.delete(id);
        else next.add(id);
      }
    } else if (mode === "all") {
      for (const id of get().visibleIds) next.add(id);
    } else if (mode === "range" && ids[0]) {
      const anchor = current.anchor ?? ids[0];
      const from = get().visibleIds.indexOf(anchor);
      const to = get().visibleIds.indexOf(ids[0]);
      if (from === -1 || to === -1) next.add(ids[0]);
      else {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        for (let i = lo; i <= hi; i++) next.add(get().visibleIds[i]);
      }
    }
    set({ selection: { set: next, anchor: ids[0] ?? current.anchor, lastClicked: ids[0] ?? current.lastClicked } });
  },

  selectAll() {
    get().select([], "all");
  },

  clearSelection() {
    set({ selection: emptySelection() });
  },

  /* ------------------------------------------------------------- view state */

  setQuery(q) {
    set({ query: q });
    recomputeVisible(set, get);
  },

  setView(view) {
    set({ activeView: view });
    recomputeVisible(set, get);
  },

  setSidebarView(view) {
    set({ sidebarView: view });
  },

  togglePanel(panel) {
    set({ panels: { ...get().panels, [panel]: !get().panels[panel] } });
  },

  setSort(column, additive = false) {
    const sort = [...get().sort];
    const existing = sort.findIndex((s) => s.column === column);
    if (additive && existing !== -1) {
      const next = [...sort];
      next[existing] = { column, desc: !next[existing].desc };
      set({ sort: next });
    } else {
      set({ sort: [{ column, desc: existing === -1 ? false : !sort[existing].desc }] });
    }
    recomputeVisible(set, get);
  },

  setColumnOrder(order) {
    set({ columnOrder: order });
  },

  toggleColumn(id) {
    const hidden = new Set(get().hiddenColumns);
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    set({ hiddenColumns: hidden });
  },

  /* -------------------------------------------------------------- mutations */

  applyEdits(edits, label) {
    if (!edits.length) return;
    const files = new Map(get().files);
    const pending = new Map<string, PendingEdit>(get().pending);
    const entries: Operation["entries"] = [];
    const historyChanges: HistoryEntry["changes"] = [];

    for (const edit of edits) {
      const file = files.get(edit.fileId);
      if (!file) continue;
      const current: PendingEdit = pending.get(edit.fileId) ?? {
        fileId: edit.fileId,
        values: {},
        cleared: [],
      };
      const before: Partial<MusicMetadata> = {};
      const after: Partial<MusicMetadata> = {};

      for (const [rawKey, value] of Object.entries(edit.changes)) {
        const key = rawKey as keyof MusicMetadata;
        (before as Record<string, unknown>)[key] = file.metadata[key];
        (after as Record<string, unknown>)[key] = value;
        (current.values as Record<string, unknown>)[key] = value;
        current.cleared = current.cleared.filter((c) => c !== rawKey);
      }
      for (const key of edit.cleared ?? []) {
        const typed = key as keyof MusicMetadata;
        (before as Record<string, unknown>)[key] = file.metadata[typed];
        const clearedValue = isTextField(key) ? "" : [];
        (after as Record<string, unknown>)[key] = clearedValue;
        (current.values as Record<string, unknown>)[key] = clearedValue;
        current.cleared = [...new Set([...current.cleared, key])];
      }

      const nextMetadata: MusicMetadata = { ...file.metadata, ...current.values };
      files.set(edit.fileId, {
        ...file,
        metadata: nextMetadata,
        tagStatus: "dirty",
        dirty: true,
      });
      pending.set(edit.fileId, current);
      entries.push({ fileId: edit.fileId, before, after });

      for (const key of Object.keys(after)) {
        historyChanges.push({
          fileId: edit.fileId,
          fileName: file.name,
          field: key,
          before: (before as Record<string, unknown>)[key],
          after: (after as Record<string, unknown>)[key],
        });
      }
    }

    const operation: Operation = { id: nextId("op"), label, at: Date.now(), entries };
    set({
      files,
      pending,
      undoStack: [...get().undoStack.slice(-99), operation],
      redoStack: [],
    });
    get().pushHistory({
      id: operation.id,
      at: operation.at,
      operation: label,
      changes: historyChanges,
      undoable: true,
    });
    recomputeVisible(set, get);
  },

  clearField(fileId, field, label = `Clear ${String(field)}`) {
    get().applyEdits([{ fileId, changes: {}, cleared: [String(field)] }], label);
  },

  queueRename(items, label) {
    if (!items.length) return;
    const files = new Map(get().files);
    const pending = new Map<string, PendingEdit>(get().pending);
    const entries: Operation["entries"] = [];
    const historyChanges: HistoryEntry["changes"] = [];

    for (const item of items) {
      const file = files.get(item.fileId);
      if (!file) continue;
      const current: PendingEdit = pending.get(item.fileId) ?? {
        fileId: item.fileId,
        values: {},
        cleared: [],
      };
      current.newName = item.to;
      pending.set(item.fileId, current);
      files.set(item.fileId, { ...file, tagStatus: "dirty", dirty: true });
      entries.push({ fileId: item.fileId, before: {}, after: {}, beforeName: item.from, afterName: item.to });
      historyChanges.push({
        fileId: item.fileId,
        fileName: item.from,
        field: "filename",
        before: item.from,
        after: item.to,
      });
    }

    const operation: Operation = { id: nextId("op"), label, at: Date.now(), entries };
    set({
      files,
      pending,
      undoStack: [...get().undoStack.slice(-99), operation],
      redoStack: [],
    });
    get().pushHistory({
      id: operation.id,
      at: operation.at,
      operation: label,
      changes: historyChanges,
      undoable: true,
    });
    recomputeVisible(set, get);
  },

  discardChanges(fileIds) {
    const targets = fileIds ?? [...get().pending.keys()];
    if (!targets.length) return;
    const files = new Map(get().files);
    const pending = new Map<string, PendingEdit>(get().pending);
    for (const id of targets) {
      const file = files.get(id);
      if (!file) continue;
      files.set(id, { ...file, metadata: file.onDisk, tagStatus: "clean", dirty: false });
      pending.delete(id);
    }
    set({ files, pending });
    get().toast({ kind: "info", message: `Discarded unsaved edits on ${targets.length} file(s)` });
    recomputeVisible(set, get);
  },

  canUndo() {
    return get().undoStack.length > 0;
  },

  canRedo() {
    return get().redoStack.length > 0;
  },

  undo() {
    const stack = [...get().undoStack];
    const operation = stack.pop();
    if (!operation) return;
    const files = new Map(get().files);
    const pending = new Map<string, PendingEdit>(get().pending);

    for (const entry of operation.entries) {
      const file = files.get(entry.fileId);
      if (!file) continue;
      const current = pending.get(entry.fileId);
      if (current) {
        for (const key of Object.keys(entry.after)) {
          if ((entry.before as Record<string, unknown>)[key] === undefined) {
            delete (current.values as Record<string, unknown>)[key];
          } else {
            (current.values as Record<string, unknown>)[key] = (entry.before as Record<string, unknown>)[key];
          }
        }
        if (current.newName && entry.beforeName !== undefined) current.newName = entry.beforeName;
        if (!Object.keys(current.values).length && !current.newName) pending.delete(entry.fileId);
      }
      const metadata = { ...file.metadata };
      for (const key of Object.keys(entry.before)) {
        const value = (entry.before as Record<string, unknown>)[key];
        if (value === undefined) delete (metadata as Record<string, unknown>)[key];
        else (metadata as Record<string, unknown>)[key] = value;
      }
      files.set(entry.fileId, { ...file, metadata, dirty: pending.has(entry.fileId) });
    }

    set({
      files,
      pending,
      undoStack: stack,
      redoStack: [...get().redoStack, operation],
    });
    get().pushHistory({
      id: nextId("undo"),
      at: Date.now(),
      operation: `Undo ${operation.label}`,
      changes: [],
      undoable: false,
    });
    get().toast({ kind: "info", message: `Undid ${operation.label}`, undoOperationId: operation.id });
    recomputeVisible(set, get);
  },

  redo() {
    const stack = [...get().redoStack];
    const operation = stack.pop();
    if (!operation) return;
    const files = new Map(get().files);
    const pending = new Map<string, PendingEdit>(get().pending);

    for (const entry of operation.entries) {
      const file = files.get(entry.fileId);
      if (!file) continue;
      const current: PendingEdit = pending.get(entry.fileId) ?? {
        fileId: entry.fileId,
        values: {},
        cleared: [],
      };
      Object.assign(current.values, entry.after);
      if (entry.afterName !== undefined) current.newName = entry.afterName;
      pending.set(entry.fileId, current);
      files.set(entry.fileId, {
        ...file,
        metadata: { ...file.metadata, ...entry.after } as MusicMetadata,
        dirty: true,
        tagStatus: "dirty",
      });
    }

    set({
      files,
      pending,
      redoStack: stack,
      undoStack: [...get().undoStack, operation],
    });
    get().toast({ kind: "info", message: `Redid ${operation.label}` });
    recomputeVisible(set, get);
  },

  /* ---------------------------------------------------------------- saving */

  async save(only) {
    const targets = (only ?? [...get().pending.keys()]).filter((id) => {
      const pending = get().pending.get(id);
      return pending && (Object.keys(pending.values).length > 0 || pending.newName);
    });
    if (!targets.length) {
      get().toast({ kind: "info", message: "Nothing to save" });
      return { completed: 0, skipped: 0, failed: 0, errors: [], warnings: [] };
    }

    const result: BulkOperationResult = { completed: 0, skipped: 0, failed: 0, errors: [], warnings: [] };
    const files = new Map(get().files);
    const historyChanges: HistoryEntry["changes"] = [];
    const backups: NonNullable<HistoryEntry["backups"]> = [];
    let i = 0;

    for (const id of targets) {
      const file = files.get(id);
      const pending = get().pending.get(id);
      if (!file || !pending) {
        result.skipped++;
        continue;
      }
      get().setBusy(
        `Saving tags`,
        `${file.folder ? `${file.folder}/` : ""}${file.name}`,
        targets.length ? i / targets.length : 0,
      );

      try {
        const outcome = await safeWriteFile(file, pending, get().settings.backups, {
          id3v1: get().settings.writeId3v1,
        });
        const written: LibraryFile = {
          ...file,
          metadata: { ...file.metadata, ...pending.values },
          onDisk: { ...file.metadata, ...pending.values },
          name: pending.newName ?? file.name,
          tagStatus: "clean",
          dirty: false,
          modifiedAt: Date.now(),
          // Kept so a later save can be rolled back from the History panel.
          backupPath: outcome.backupPath,
        };
        files.set(id, written);
        result.completed++;
        if (outcome.backupPath) {
          backups.push({ fileId: id, fileName: file.name, path: outcome.backupPath });
        }
        for (const [field, after] of Object.entries(pending.values)) {
          historyChanges.push({ fileId: id, fileName: file.name, field, before: undefined, after });
        }
      } catch (err) {
        result.failed++;
        result.errors.push({ fileName: file.name, reason: (err as Error).message });
        files.set(id, { ...file, tagStatus: "error", error: (err as Error).message });
      }
      i++;
      await new Promise((r) => setTimeout(r, 0));
    }

    const pending = new Map<string, PendingEdit>(get().pending);
    for (const id of targets) pending.delete(id);
    set({ files, pending });
    set({ busy: null });
    recomputeVisible(set, get);

    get().pushHistory({
      id: nextId("save"),
      at: Date.now(),
      operation: `Save ${result.completed} file(s)`,
      changes: historyChanges,
      writeResult: result.failed ? "partial" : "applied",
      backups,
      backupPath: backups[0]?.path,
      errors: result.errors.map((e) => `${e.fileName}: ${e.reason}`),
      undoable: false,
    });

    get().toast({
      kind: result.failed ? "warning" : "success",
      message: `Saved ${result.completed} file${result.completed === 1 ? "" : "s"}`,
      detail: result.failed
        ? `${result.failed} failed, ${result.skipped} skipped`
        : result.skipped
          ? `${result.skipped} skipped`
          : undefined,
    });
    return result;
  },

  /**
   * Roll a save back by putting each file's `.bak` copy back in place.
   *
   * Restoring needs the same access as saving did, so it only works for
   * files opened through a granted directory. When it cannot, this says
   * exactly why instead of pretending the job is queued somewhere.
   */
  async restoreBackup(entryId) {
    const entry = get().history.find((h) => h.id === entryId);
    if (!entry) {
      get().toast({ kind: "error", message: "That operation is no longer in the history" });
      return;
    }
    const backups = entry.backups ?? [];
    if (!backups.length) {
      get().toast({
        kind: "warning",
        message: "No backup was recorded for this save",
        detail: "Backups are only written for files opened from a folder, and only when backups are enabled in Settings.",
      });
      return;
    }

    const files = new Map(get().files);
    const errors: string[] = [];
    let restored = 0;

    for (const backup of backups) {
      const file = files.get(backup.fileId);
      if (!file) {
        errors.push(`${backup.fileName}: no longer in the library`);
        continue;
      }
      if (!file.handle || !file.folderHandle) {
        errors.push(`${backup.fileName}: opened without folder access, so it cannot be restored here`);
        continue;
      }
      try {
        const bytes = await readBackupBytes(file, backup.path);
        if (!bytes) {
          errors.push(`${backup.fileName}: ${backup.path} is missing`);
          continue;
        }
        if (!(await ensureWritePermission(file.handle))) {
          errors.push(`${backup.fileName}: write permission declined`);
          continue;
        }
        const outcome = await writeFile(file.handle, bytes);
        if (!outcome.ok) {
          errors.push(`${backup.fileName}: ${outcome.reason}`);
          continue;
        }
        files.set(backup.fileId, {
          ...file,
          metadata: file.onDisk,
          tagStatus: "clean",
          dirty: false,
          modifiedAt: Date.now(),
          backupPath: undefined,
          error: undefined,
        });
        restored++;
      } catch (err) {
        errors.push(`${backup.fileName}: ${(err as Error).message}`);
      }
    }

    set({ files });
    recomputeVisible(set, get);

    if (restored) {
      get().pushHistory({
        id: nextId("restore"),
        at: Date.now(),
        operation: `Restore ${restored} file(s) from backup`,
        changes: [],
        writeResult: errors.length ? "partial" : "undone",
        errors,
        undoable: false,
      });
    }
    get().toast({
      kind: restored && !errors.length ? "success" : restored ? "warning" : "error",
      message: restored
        ? `Restored ${restored} file${restored === 1 ? "" : "s"} from backup`
        : "Nothing was restored",
      detail: errors.length ? errors.slice(0, 3).join(" · ") : undefined,
    });

    // The bytes on disk changed underneath us; re-read what is actually there.
    if (restored) void get().rescan();
  },

  /* ------------------------------------------------------------------- ui */

  toast(t) {
    const toast: Toast = { ...t, id: nextId("toast"), at: Date.now() };
    set({ toasts: [...get().toasts, toast].slice(-6) });
    const duration = t.duration ?? (t.kind === "error" ? 9000 : 4500);
    if (duration > 0) {
      setTimeout(() => get().dismissToast(toast.id), duration);
    }
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  setBusy(label, detail, progress) {
    set({ busy: label ? { label, detail, progress } : null });
  },

  openDialog(name, payload) {
    set({ dialog: name, dialogPayload: payload ?? null });
  },

  closeDialog() {
    set({ dialog: null, dialogPayload: null });
  },

  /* ----------------------------------------------------------- copy/paste */

  copyMetadata(fileId, fields) {
    const file = get().files.get(fileId);
    if (!file) return;
    const metadata: Partial<MusicMetadata> = {};
    for (const field of fields) {
      (metadata as Record<string, unknown>)[field] = file.metadata[field as keyof MusicMetadata];
    }
    set({ clipboard: { fileId, metadata: metadata as MusicMetadata, fields } });
    get().toast({ kind: "success", message: `Copied ${fields.length} field(s)` });
  },

  pasteMetadata(fileId, fields) {
    const clipboard = get().clipboard;
    if (!clipboard) {
      get().toast({ kind: "warning", message: "Nothing copied yet" });
      return;
    }
    const changes: Partial<MusicMetadata> = {};
    for (const field of fields) {
      if (!clipboard.fields.includes(field)) continue;
      (changes as Record<string, unknown>)[field] = clipboard.metadata[field as keyof MusicMetadata];
    }
    get().applyEdits([{ fileId, changes }], `Paste ${fields.join(", ")}`);
  },

  pushHistory(entry) {
    const history = [entry, ...get().history].slice(0, 300);
    set({ history });
  },

  clearHistory() {
    set({ history: [] });
    get().toast({ kind: "info", message: "History cleared", detail: "Undo and redo steps are still available." });
  },
}));

/* ---------- helpers ---------- */

/** Fold one worker result into the in-flight import. */
function applyScanResult(
  get: GetState,
  set: SetState,
  files: Map<string, LibraryFile>,
  byFormat: Record<string, number>,
  result: ScannedResult,
) {
  const file = files.get(result.id);
  if (!file) return;
  byFormat[result.format] = (byFormat[result.format] ?? 0) + 1;
  const unreadable = Boolean(result.error) || !isReadableAudio(result.path, result.tagScheme);
  files.set(result.id, {
    ...file,
    format: result.format,
    artworkCount: result.artworkCount,
    contentHash: result.contentHash ?? file.contentHash,
    metadata: result.metadata,
    onDisk: result.metadata,
    audio: result.audio,
    raw: result.raw,
    warnings: result.warnings,
    tagScheme: result.tagScheme,
    tagStatus: unreadable ? "error" : "clean",
    error: unreadable ? (result.error ?? `No audio or tags found in ${result.path}`) : undefined,
    writable: Boolean(file.writable && canWriteFormat(result.format)),
  });
  // Results arrive one at a time; republish on a frame so a 10k-file import
  // does not trigger 10k renders.
  schedulePublish(get, set, files);
}

let publishHandle: number | null = null;
function schedulePublish(get: GetState, set: SetState, files: Map<string, LibraryFile>) {
  if (publishHandle !== null) return;
  const raf =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;
  publishHandle = raf(() => {
    publishHandle = null;
    if (!get().scanning) return;
    set({ files: new Map(files) });
    recomputeVisible(set, get);
  });
}

const WRITABLE_FORMATS: FormatId[] = [
  "mp3", "flac", "ogg", "opus", "spx", "m4a", "m4b", "mp4", "alac", "wav",
  "ape", "mpc", "wv", "ofr", "ofs",
];

function canWriteFormat(format: FormatId): boolean {
  return WRITABLE_FORMATS.includes(format);
}

/**
 * A file we could not identify. The codecs report warnings rather than throwing,
 * so a wrong extension and an empty buffer both come back "clean" — the
 * extension is the only remaining signal that this is not audio at all.
 */
function isReadableAudio(path: string, tagScheme: string): boolean {
  return tagScheme !== "None" || formatFromPath(path) !== null;
}

function isTextField(field: string): boolean {
  return !["artists", "genres", "albumArtists", "composers", "artwork"].includes(field);
}

/** Read a `.bak` file back out of the folder a library file came from. */
async function readBackupBytes(file: LibraryFile, path: string): Promise<Uint8Array | null> {
  if (!file.folderHandle) return null;
  try {
    const handle = await file.folderHandle.getFileHandle(path);
    const blob = await handle.getFile();
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

function summariseFormats(byFormat: Record<string, number>): string | undefined {  const entries = Object.entries(byFormat).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return undefined;
  return entries.map(([format, count]) => `${format.toUpperCase()} ${count}`).join("  ·  ");
}

/* ---------- derived visible list ---------- */

type SetState = (partial: Partial<Store>) => void;
type GetState = () => Store;

export function recomputeVisible(set: SetState, get: GetState) {
  const { files, order, query, activeView, selection, pending } = get();
  const ids: string[] = [];
  // Mirror the pending map onto each record so table cells can read
  // `file.pending` without subscribing to a second store slice.
  let stamped: Map<string, LibraryFile> | null = null;

  for (const id of order) {
    const file = files.get(id);
    if (!file) continue;
    const edit = pending.get(id);
    if (file.pending !== edit) {
      stamped ??= new Map(files);
      stamped.set(id, { ...file, pending: edit });
    }
    if (!matchesView(file, activeView)) continue;
    if (query.trim() && !matchesQuickQuery(file, query)) continue;
    ids.push(id);
  }

  sortIds(ids, get);

  const visibleSet = new Set(ids);
  const selectionSet = new Set([...selection.set].filter((id) => visibleSet.has(id)));
  set({
    files: stamped ?? files,
    visibleIds: ids,
    selection: { ...selection, set: selectionSet },
  });
}

function matchesQuickQuery(file: LibraryFile, query: string): boolean {
  const parsed = parseQuery(query);
  return matchesText(file, parsed.text) && parsed.clauses.every((c) => matchesClause(file, c));
}

function matchesView(file: LibraryFile, view: string): boolean {
  const m = file.metadata;
  switch (view) {
    case "all":
      return true;
    case "recent":
      return Date.now() - file.addedAt < 7 * 24 * 3600 * 1000;
    case "modified":
      return Date.now() - file.modifiedAt < 7 * 24 * 3600 * 1000;
    case "favorites":
      return file.writable;
    case "missing-artwork":
      return !(m.artwork ?? []).length;
    case "missing-metadata":
      return !m.title || !m.artists?.length || !m.album;
    case "errors":
      return file.tagStatus === "error";
    case "dirty":
      return file.dirty;
    case "writable":
      return file.writable;
    case "lossless":
      return isLossless(file.format);
    case "lossy":
      return !isLossless(file.format);
    /* Collection buckets: the browser dialog narrows these further with a
       `field:"value"` query, so presence is the honest predicate here. */
    case "artists":
      return Boolean(m.artists?.length || m.artist);
    case "albums":
      return Boolean(m.album);
    case "genres":
      return Boolean(m.genres?.length || m.genre);
    case "years":
      return m.year !== undefined;
    case "labels":
      return Boolean(m.label || m.publisher);
    case "folders":
      return Boolean(file.folder);
    default:
      return true;
  }
}

function sortIds(ids: string[], get: GetState) {
  const { sort, files } = get();
  if (!sort.length) return;
  ids.sort((a, b) => {
    const fa = files.get(a);
    const fb = files.get(b);
    if (!fa || !fb) return 0;
    for (const { column, desc } of sort) {
      const result = compareBy(fa, fb, column);
      if (result !== 0) return desc ? -result : result;
    }
    return fa.name.localeCompare(fb.name);
  });
}

function compareBy(a: LibraryFile, b: LibraryFile, column: string): number {
  const am = a.metadata;
  const bm = b.metadata;
  switch (column) {
    case "track":
      return (am.trackNumber ?? Number.MAX_SAFE_INTEGER) - (bm.trackNumber ?? Number.MAX_SAFE_INTEGER);
    case "disc":
      return (am.discNumber ?? 0) - (bm.discNumber ?? 0);
    case "title":
      return (am.title ?? "").localeCompare(bm.title ?? "");
    case "artist":
      return (am.artists?.[0] ?? am.artist ?? "").localeCompare(bm.artists?.[0] ?? bm.artist ?? "");
    case "album":
      return (am.album ?? "").localeCompare(bm.album ?? "");
    case "albumartist":
      return (am.albumArtists?.[0] ?? am.albumArtist ?? "").localeCompare(bm.albumArtists?.[0] ?? bm.albumArtist ?? "");
    case "year":
      return (am.year ?? 0) - (bm.year ?? 0);
    case "genre":
      return (am.genres?.[0] ?? am.genre ?? "").localeCompare(bm.genres?.[0] ?? bm.genre ?? "");
    case "duration":
      return (a.audio.duration ?? 0) - (b.audio.duration ?? 0);
    case "bitrate":
      return (a.audio.bitrate ?? 0) - (b.audio.bitrate ?? 0);
    case "samplerate":
      return (a.audio.sampleRate ?? 0) - (b.audio.sampleRate ?? 0);
    case "format":
      return a.format.localeCompare(b.format);
    case "size":
      return a.size - b.size;
    case "folder":
      return a.folder.localeCompare(b.folder);
    case "filename":
    case "name":
      return a.name.localeCompare(b.name);
    case "modified":
      return a.modifiedAt - b.modifiedAt;
    case "tagstatus":
      return a.tagStatus.localeCompare(b.tagStatus);
    default:
      return 0;
  }
}

/** Convenience selector: the currently selected files. */
export function selectSelectedFiles(state: Store): LibraryFile[] {
  const out: LibraryFile[] = [];
  for (const id of state.selection.set) {
    const file = state.files.get(id);
    if (file) out.push(file);
  }
  return out;
}

/**
 * Hook form of `selectSelectedFiles`.
 *
 * `useSyncExternalStore` compares snapshots by identity, so subscribing to the
 * selector directly would build a fresh array on every read and re-render
 * forever. Subscribe to the two stable pieces and memoise the derivation.
 */
export function useSelectedFiles(): LibraryFile[] {
  const ids = useStore((s) => s.selection.set);
  const files = useStore((s) => s.files);
  return useMemo(() => {
    const out: LibraryFile[] = [];
    for (const id of ids) {
      const file = files.get(id);
      if (file) out.push(file);
    }
    return out;
  }, [ids, files]);
}

export type { LibraryFile, FileRef };
export { verifyWrite, writeMetadata };
export type { ScannedFile };
export { DEFAULT_FILE_READ_LIMIT };