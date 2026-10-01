import * as React from "react";
import { Disc3, FolderTree, Music2, Search, Tag } from "lucide-react";
import { useStore } from "../lib/store";
import { Dialog } from "./ui/primitives";
import { formatBytes } from "../lib/metadata/types";
import type { LibraryFile } from "../lib/library/types";

type Bucket = "artist" | "album" | "genre" | "label" | "year" | "folder" | "format";

const QUERY_FIELD: Record<Bucket, string> = {
  artist: "artist",
  album: "album",
  genre: "genre",
  label: "label",
  year: "year",
  folder: "folder",
  format: "format",
};

interface Entry {
  value: string;
  files: LibraryFile[];
  bytes: number;
  seconds: number;
}

const BUCKETS: Array<{ id: Bucket; label: string; icon: React.ReactNode }> = [
  { id: "artist", label: "Artists", icon: <Music2 size={13} /> },
  { id: "album", label: "Albums", icon: <Disc3 size={13} /> },
  { id: "genre", label: "Genres", icon: <Tag size={13} /> },
  { id: "label", label: "Labels", icon: <Tag size={13} /> },
  { id: "year", label: "Years", icon: <Search size={13} /> },
  { id: "folder", label: "Folders", icon: <FolderTree size={13} /> },
  { id: "format", label: "Formats", icon: <Disc3 size={13} /> },
];

function valuesFor(file: LibraryFile, bucket: Bucket): string[] {
  const m = file.metadata;
  switch (bucket) {
    case "artist":
      return m.artists?.length ? m.artists : m.artist ? [m.artist] : [];
    case "album":
      return m.album ? [m.album] : [];
    case "genre":
      return m.genres?.length ? m.genres : m.genre ? [m.genre] : [];
    case "label":
      return [m.label, m.publisher].filter((v): v is string => Boolean(v));
    case "year":
      return m.year !== undefined ? [String(m.year)] : [];
    case "folder":
      return file.folder ? [file.folder] : [];
    case "format":
      return [file.format];
    default:
      return [];
  }
}

export function CollectionDialog({
  open,
  bucket,
  onClose,
}: {
  open: boolean;
  bucket: Bucket;
  onClose: () => void;
}) {
  const files = useStore((s) => s.files);
  const visibleIds = useStore((s) => s.visibleIds);
  const setQuery = useStore((s) => s.setQuery);
  const select = useStore((s) => s.select);
  const [filter, setFilter] = React.useState("");

  const entries = React.useMemo(() => {
    const map = new Map<string, Entry>();
    for (const id of visibleIds) {
      const file = files.get(id);
      if (!file) continue;
      for (const value of valuesFor(file, bucket)) {
        const key = value.trim();
        if (!key) continue;
        let entry = map.get(key);
        if (!entry) {
          entry = { value: key, files: [], bytes: 0, seconds: 0 };
          map.set(key, entry);
        }
        entry.files.push(file);
        entry.bytes += file.size;
        entry.seconds += file.audio.duration ?? 0;
      }
    }
    const list = [...map.values()];
    const q = filter.trim().toLowerCase();
    return (q ? list.filter((e) => e.value.toLowerCase().includes(q)) : list).sort((a, b) =>
      b.files.length - a.files.length || a.value.localeCompare(b.value),
    );
  }, [files, visibleIds, bucket, filter]);

  const meta = BUCKETS.find((b) => b.id === bucket) ?? BUCKETS[0];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={`Browse ${meta.label.toLowerCase()}`}
      description={`${entries.length} distinct value(s) in the current view. Pick one to filter the table and select its files.`}
      width={640}
      icon={meta.icon}
      footer={
        <>
          <span className="mr-auto text-label text-[var(--text-faint)]">
            Filtering sets the search box to <span className="mono">{QUERY_FIELD[bucket]}:“…”</span>
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setQuery("");
              select([], "none");
              onClose();
            }}
          >
            Clear filter
          </button>
        </>
      }
    >
      <div className="border-b border-[var(--line)] px-4 py-2">
        <input
          autoFocus
          className="input h-[26px]"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${meta.label.toLowerCase()}…`}
          aria-label={`Filter ${meta.label.toLowerCase()}`}
        />
      </div>
      <ul className="max-h-[54vh] overflow-auto">
        {entries.length === 0 ? (
          <li className="px-4 py-8 text-center text-body text-[var(--text-faint)]">
            Nothing tagged in this view.
          </li>
        ) : (
          entries.map((entry) => (
            <li key={entry.value}>
              <button
                type="button"
                onClick={() => {
                  setQuery(`${QUERY_FIELD[bucket]}:"${entry.value.replace(/"/g, "")}"`);
                  select(
                    entry.files.map((f) => f.id),
                    "replace",
                  );
                  onClose();
                }}
                className="row-hover flex w-full items-center gap-3 border-b border-[var(--line)] px-4 py-[5px] text-left"
              >
                <span className="min-w-0 flex-1 truncate text-body">{entry.value}</span>
                <span className="tnum text-label text-[var(--text-faint)]">
                  {entry.files.length} file{entry.files.length === 1 ? "" : "s"}
                </span>
                <span className="tnum w-[70px] text-right text-label text-[var(--text-faint)]">
                  {formatBytes(entry.bytes)}
                </span>
                <span className="tnum w-[64px] text-right text-label text-[var(--text-faint)]">
                  {entry.seconds > 0 ? `${Math.round(entry.seconds / 60)}m` : ""}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </Dialog>
  );
}

export type { Bucket };