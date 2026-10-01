/**
 * IndexedDB persistence.
 *
 * Holds only what is safe and useful to keep: the index of imported files,
 * cached metadata, saved views, actions, settings and history. Music files
 * themselves never leave the user's machine and are never stored here.
 */

import type { HistoryEntry } from "../library/types";
import type { SavedView } from "../search/query";

const DB_NAME = "music-metadata-studio";
const DB_VERSION = 1;

export const STORES = {
  files: "files",
  meta: "meta",
  views: "views",
  actions: "actions",
  settings: "settings",
  history: "history",
  templates: "templates",
  playlists: "playlists",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.files)) {
        const store = db.createObjectStore(STORES.files, { keyPath: "id" });
        store.createIndex("path", "path", { unique: false });
        store.createIndex("addedAt", "addedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta);
      }
      if (!db.objectStoreNames.contains(STORES.views)) {
        db.createObjectStore(STORES.views, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.actions)) {
        db.createObjectStore(STORES.actions, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings);
      }
      if (!db.objectStoreNames.contains(STORES.history)) {
        const store = db.createObjectStore(STORES.history, { keyPath: "id" });
        store.createIndex("at", "at", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.templates)) {
        db.createObjectStore(STORES.templates, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.playlists)) {
        db.createObjectStore(STORES.playlists, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened"));
  });
  return dbPromise;
}

function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = fn(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

/* ---------- persisted record shapes ---------- */

/** Artwork is stored separately so the index stays cheap to load. */
export interface StoredFileIndex {
  id: string;
  path: string;
  name: string;
  folder: string;
  size: number;
  modifiedAt: number;
  addedAt: number;
  format: string;
  /** Serialised MusicMetadata with artwork stripped. */
  metadata: Record<string, unknown>;
  audio: Record<string, unknown>;
  warnings: string[];
  tagScheme: string;
  contentHash?: string;
  hasArtwork: number;
}

export interface StoredSettings {
  id: "app";
  theme: string;
  accent: string;
  providers: Record<string, unknown>;
  backups: boolean;
  writeId3v1: boolean;
  id3Version: 3 | 4;
  workerCount: number;
  thumbnailCacheSize: number;
  renameTemplate: string;
  parseTemplate: string;
  columns: unknown[];
  shortcuts: Record<string, string>;
  agentPort: number;
}

export const DEFAULT_SETTINGS: StoredSettings = {
  id: "app",
  theme: "dark",
  accent: "#f0a53c",
  providers: {},
  backups: true,
  writeId3v1: false,
  id3Version: 4,
  workerCount: Math.max(1, Math.min(4, navigator.hardwareConcurrency ?? 2)),
  thumbnailCacheSize: 400,
  renameTemplate: "%track% - %artist% - %title%",
  parseTemplate: "%track% - %artist% - %title%",
  columns: [],
  shortcuts: {},
  agentPort: 7331,
};

/* ---------- API ---------- */

export async function putFileIndex(record: StoredFileIndex): Promise<void> {
  await tx(STORES.files, "readwrite", (s) => s.put(record));
}

export async function putFileIndexes(records: StoredFileIndex[]): Promise<void> {
  if (!records.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORES.files, "readwrite");
    const store = transaction.objectStore(STORES.files);
    for (const record of records) store.put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Bulk index write failed"));
  });
}

export async function allFileIndexes(): Promise<StoredFileIndex[]> {
  return tx<StoredFileIndex[]>(STORES.files, "readonly", (s) => s.getAll() as IDBRequest<StoredFileIndex[]>);
}

export async function clearFileIndex(): Promise<void> {
  await tx(STORES.files, "readwrite", (s) => s.clear());
}

export async function saveArtwork(id: string, artwork: unknown): Promise<void> {
  await tx(STORES.meta, "readwrite", (s) => s.put(artwork, `art:${id}`));
}

export async function loadArtwork(id: string): Promise<unknown> {
  return tx<unknown>(STORES.meta, "readonly", (s) => s.get(`art:${id}`));
}

export async function saveViews(views: SavedView[]): Promise<void> {
  await tx(STORES.views, "readwrite", (s) => s.put(views, "all"));
}

export async function loadViews(): Promise<SavedView[]> {
  const result = await tx<SavedView[] | undefined>(STORES.views, "readonly", (s) => s.get("all"));
  return result ?? [];
}

export async function saveHistory(entry: HistoryEntry): Promise<void> {
  await tx(STORES.history, "readwrite", (s) => s.put(entry));
}

export async function loadHistory(limit = 200): Promise<HistoryEntry[]> {
  const all = await tx<HistoryEntry[]>(STORES.history, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.at - a.at).slice(0, limit);
}

export async function clearHistory(): Promise<void> {
  await tx(STORES.history, "readwrite", (s) => s.clear());
}

export async function saveSettings(settings: StoredSettings): Promise<void> {
  await tx(STORES.settings, "readwrite", (s) => s.put(settings, "app"));
}

export async function loadSettings(): Promise<StoredSettings> {
  const stored = await tx<Partial<StoredSettings> | undefined>(STORES.settings, "readonly", (s) => s.get("app"));
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function saveCollection<T>(store: StoreName, id: string, value: T): Promise<void> {
  await tx(store, "readwrite", (s) => s.put(value, id));
}

export async function loadCollection<T>(store: StoreName, id: string): Promise<T | undefined> {
  return tx<T | undefined>(store, "readonly", (s) => s.get(id));
}

export async function estimateUsage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}

export async function clearEverything(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(Object.values(STORES), "readwrite");
    for (const store of Object.values(STORES)) transaction.objectStore(store).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Clear failed"));
  });
}