import * as React from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  FileMusic,
  Music4,
  Pencil,
} from "lucide-react";
import { useStore } from "../lib/store";
import {
  formatBitrate,
  formatBytes,
  formatDuration,
  formatSampleRate,
  type MusicMetadata,
} from "../lib/metadata/types";
import type { LibraryFile } from "../lib/library/types";
import { loadThumbnail, fullArtworkUrl } from "../lib/artwork";
import { cn } from "./ui/primitives";
import { ContextMenu } from "./ContextMenu";

export interface Column {
  id: string;
  label: string;
  width: number;
  minWidth?: number;
  align?: "left" | "right" | "center";
  mono?: boolean;
  editable?: boolean;
  sortValue?: (f: LibraryFile) => string | number | undefined;
  display?: (f: LibraryFile) => string;
  groupValue?: (f: LibraryFile) => string;
  sortable?: boolean;
}

const text = (get: (m: MusicMetadata) => string | string[] | undefined) => (f: LibraryFile) => {
  const v = get(f.metadata);
  return Array.isArray(v) ? v.join(" & ") : (v ?? "");
};

export const COLUMNS: Column[] = [
  { id: "artwork", label: "", width: 34, minWidth: 34, align: "center", sortable: false },
  {
    id: "filename",
    label: "Filename",
    width: 210,
    mono: true,
    display: (f) => f.name,
    sortValue: (f) => f.name,
    groupValue: (f) => f.folder || "—",
  },
  {
    id: "title",
    label: "Title",
    width: 200,
    editable: true,
    display: text((m) => m.title),
    sortValue: text((m) => m.title),
    groupValue: (f) => f.metadata.album || "—",
  },
  {
    id: "artist",
    label: "Artist",
    width: 170,
    editable: true,
    display: text((m) => m.artists ?? m.artist),
    sortValue: text((m) => m.artists?.[0] ?? m.artist),
  },
  {
    id: "album",
    label: "Album",
    width: 180,
    editable: true,
    display: text((m) => m.album),
    sortValue: text((m) => m.album),
  },
  {
    id: "albumartist",
    label: "Album Artist",
    width: 160,
    editable: true,
    display: text((m) => m.albumArtists ?? m.albumArtist),
    sortValue: text((m) => m.albumArtists?.[0] ?? m.albumArtist),
  },
  {
    id: "track",
    label: "Track",
    width: 58,
    align: "right",
    editable: true,
    display: (f) => (f.metadata.trackNumber !== undefined ? String(f.metadata.trackNumber) : ""),
    sortValue: (f) => f.metadata.trackNumber,
  },
  {
    id: "disc",
    label: "Disc",
    width: 52,
    align: "right",
    editable: true,
    display: (f) => (f.metadata.discNumber !== undefined ? String(f.metadata.discNumber) : ""),
    sortValue: (f) => f.metadata.discNumber,
  },
  {
    id: "year",
    label: "Year",
    width: 62,
    align: "right",
    editable: true,
    display: (f) => (f.metadata.year !== undefined ? String(f.metadata.year) : ""),
    sortValue: (f) => f.metadata.year,
  },
  {
    id: "genre",
    label: "Genre",
    width: 130,
    editable: true,
    display: text((m) => m.genres ?? m.genre),
    sortValue: text((m) => m.genres?.[0] ?? m.genre),
  },
  {
    id: "duration",
    label: "Time",
    width: 62,
    align: "right",
    display: (f) => formatDuration(f.audio.duration),
    sortValue: (f) => f.audio.duration,
  },
  {
    id: "bitrate",
    label: "Bitrate",
    width: 78,
    align: "right",
    display: (f) => formatBitrate(f.audio.bitrate),
    sortValue: (f) => f.audio.bitrate,
  },
  {
    id: "samplerate",
    label: "Sample",
    width: 76,
    align: "right",
    display: (f) => formatSampleRate(f.audio.sampleRate),
    sortValue: (f) => f.audio.sampleRate,
  },
  {
    id: "format",
    label: "Format",
    width: 62,
    display: (f) => f.format.toUpperCase(),
    sortValue: (f) => f.format,
  },
  {
    id: "size",
    label: "Size",
    width: 78,
    align: "right",
    display: (f) => formatBytes(f.size),
    sortValue: (f) => f.size,
  },
  {
    id: "folder",
    label: "Folder",
    width: 190,
    mono: true,
    display: (f) => f.folder,
    sortValue: (f) => f.folder,
  },
  {
    id: "modified",
    label: "Modified",
    width: 110,
    display: (f) => new Date(f.modifiedAt).toLocaleDateString(),
    sortValue: (f) => f.modifiedAt,
  },
  {
    id: "status",
    label: "Status",
    width: 84,
    display: (f) => statusLabel(f),
    sortValue: (f) => f.tagStatus,
  },
];

export function statusLabel(file: LibraryFile): string {
  switch (file.tagStatus) {
    case "dirty":
      return "Unsaved";
    case "error":
      return "Error";
    case "unsaved":
      return "Unwritten";
    default:
      return file.writable ? "Clean" : "Export";
  }
}

const ROW_HEIGHT = 27;
const OVERSCAN = 8;

/* ---------------------------------------------------------------- artwork */

function ArtworkCell({ file }: { file: LibraryFile }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const ensureArtwork = useStore((s) => s.ensureArtwork);
  const art = file.metadata.artwork?.[0];
  const pendingUrl = file.pending?.values.artwork?.[0];

  // The scan deliberately drops image bytes. If the file is known to have
  // artwork but we have not loaded it yet, pull it in the background.
  React.useEffect(() => {
    if (!art && (file.artworkCount ?? 0) > 0) void ensureArtwork(file.id);
  }, [art, file.artworkCount, file.id, ensureArtwork]);

  React.useEffect(() => {
    let cancelled = false;
    if (!art) {
      setUrl(null);
      return;
    }
    void loadThumbnail(art, 32).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [art]);

  if (pendingUrl) return <img src={fullArtworkUrl(pendingUrl)} alt="" className="h-6 w-6 rounded-[2px] object-cover" />;
  if (!art && (file.artworkCount ?? 0) > 0) {
    return <span className="block h-6 w-6 animate-pulse rounded-[2px] bg-[var(--raised)]" />;
  }
  if (!art) {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-[2px] border border-dashed border-[var(--line-strong)] text-[var(--text-faint)]">
        <Music4 size={10} />
      </span>
    );
  }
  return url ? (
    <img src={url} alt="" className="h-6 w-6 rounded-[2px] object-cover" loading="lazy" />
  ) : (
    <span className="block h-6 w-6 animate-pulse rounded-[2px] bg-[var(--raised)]" />
  );
}

/* ------------------------------------------------------------------- table */

export function FileTable() {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(600);
  const [editing, setEditing] = React.useState<{ fileId: string; column: string } | null>(null);

  const files = useStore((s) => s.files);
  const visibleIds = useStore((s) => s.visibleIds);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const sort = useStore((s) => s.sort);
  const setSort = useStore((s) => s.setSort);
  const applyEdits = useStore((s) => s.applyEdits);
  const hiddenColumns = useStore((s) => s.hiddenColumns);
  const columnOrder = useStore((s) => s.columnOrder);
  const applyTheme = useStore((s) => s.applyTheme);

  const columns = React.useMemo(() => {
    const ordered = columnOrder.length
      ? [...COLUMNS].sort(
          (a, b) => columnOrder.indexOf(a.id) - columnOrder.indexOf(b.id),
        )
      : COLUMNS;
    return ordered.filter((c) => !hiddenColumns.has(c.id));
  }, [columnOrder, hiddenColumns]);

  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const total = visibleIds.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(total, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const windowIds = visibleIds.slice(startIndex, endIndex);

  const allSelected = total > 0 && selection.set.size === total;
  const someSelected = selection.set.size > 0 && !allSelected;

  const handleRowClick = (event: React.MouseEvent, index: number, fileId: string) => {
    if (event.shiftKey) select([fileId], "range");
    else if (event.metaKey || event.ctrlKey) select([fileId], "toggle");
    else select([fileId], "replace");
    void index;
  };

  const commitEdit = (file: LibraryFile, columnId: string, raw: string) => {
    setEditing(null);
    const column = COLUMNS.find((c) => c.id === columnId);
    if (!column) return;
    const field = FIELD_FOR_COLUMN[columnId];
    if (!field) return;

    const numeric = ["trackNumber", "trackTotal", "discNumber", "discTotal", "year"].includes(field);
    if (numeric) {
      const value = raw.trim() === "" ? undefined : Number.parseInt(raw, 10);
      if (value !== undefined && !Number.isFinite(value)) return;
      if (value === undefined) {
        applyEdits([{ fileId: file.id, changes: {}, cleared: [field] }], `Clear ${column.label}`);
        return;
      }
      applyEdits([{ fileId: file.id, changes: { [field]: value } }], `Edit ${column.label}`);
      return;
    }

    const multi = ["artists", "genres", "albumArtists", "composers"].includes(field);
    if (multi) {
      const values = raw.split(/\s*[;/]\s*/).filter(Boolean);
      if (!values.length) {
        applyEdits([{ fileId: file.id, changes: {}, cleared: [field] }], `Clear ${column.label}`);
        return;
      }
      applyEdits([{ fileId: file.id, changes: { [field]: values } }], `Edit ${column.label}`);
      return;
    }

    if (!raw.trim()) {
      applyEdits([{ fileId: file.id, changes: {}, cleared: [field] }], `Clear ${column.label}`);
      return;
    }
    applyEdits([{ fileId: file.id, changes: { [field]: raw } }], `Edit ${column.label}`);
  };

  if (total === 0) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <div className="sticky top-0 z-10 flex shrink-0 items-stretch border-b border-[var(--line)] bg-[var(--panel-2)] shadow-[0_1px_0_0_var(--line)]">
        <div className="flex w-[36px] shrink-0 items-center justify-center border-r border-[var(--line)]">
          <input
            type="checkbox"
            aria-label="Select all files"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={(e) => (e.target.checked ? select([], "all") : select([], "none"))}
            className="h-[13px] w-[13px] accent-[var(--accent)]"
          />
        </div>
        {columns.map((column) => {
          const activeSort = sort.find((s) => s.column === column.id);
          return (
            <button
              key={column.id}
              type="button"
              onClick={(e) => column.sortable !== false && setSort(column.id, e.shiftKey)}
              onDoubleClick={() => column.id !== "artwork" && applyTheme()}
              style={{ width: column.width, minWidth: column.width }}
              className={cn(
                "group flex items-center gap-1 truncate border-r border-[var(--line)] px-2.5 text-left",
                "transition-colors hover:bg-[var(--raised)]",
                column.align === "right" && "justify-end",
                column.align === "center" && "justify-center",
              )}
            >
              <span
                className={cn(
                  "label-xs truncate transition-colors",
                  activeSort
                    ? "text-[var(--accent)]"
                    : "group-hover:text-[var(--text-dim)]",
                )}
              >
                {column.label}
              </span>
              {activeSort ? (
                activeSort.desc ? (
                  <ArrowDown size={9} className="text-[var(--accent)]" />
                ) : (
                  <ArrowUp size={9} className="text-[var(--accent)]" />
                )
              ) : null}
            </button>
          );
        })}
      </div>

      {/* body */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        role="grid"
        aria-rowcount={total}
        aria-label="Library files"
      >
        <div style={{ height: total * ROW_HEIGHT, position: "relative" }}>
          <div style={{ transform: `translateY(${startIndex * ROW_HEIGHT}px)` }}>
            {windowIds.map((fileId, i) => {
              const file = files.get(fileId);
              if (!file) return null;
              const index = startIndex + i;
              const selected = selection.set.has(fileId);
              return (
                <ContextMenu key={fileId} file={file}>
                  <div
                    role="row"
                    aria-rowindex={index + 1}
                    aria-selected={selected}
                    onMouseDown={(e) => handleRowClick(e, index, fileId)}
                    className={cn(
                      "row-hover group flex cursor-default items-stretch border-b border-[color-mix(in_oklab,var(--line)_50%,transparent)] text-body",
                      selected && "row-selected",
                    )}
                    style={{ height: ROW_HEIGHT }}
                  >
                    <div className="flex w-[36px] shrink-0 items-center justify-center border-r border-[var(--line)]">
                      <input
                        type="checkbox"
                        tabIndex={-1}
                        aria-label={`Select ${file.name}`}
                        checked={selected}
                        onChange={() => select([fileId], "toggle")}
                        className="h-[12px] w-[12px] accent-[var(--accent)]"
                      />
                    </div>
                    {columns.map((column) => (
                      <Cell
                        key={column.id}
                        column={column}
                        file={file}
                        selected={selected}
                        editing={editing?.fileId === fileId && editing.column === column.id}
                        onStartEdit={() => setEditing({ fileId, column: column.id })}
                        onCommit={(value) => commitEdit(file, column.id, value)}
                        onCancel={() => setEditing(null)}
                      />
                    ))}
                  </div>
                </ContextMenu>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const FIELD_FOR_COLUMN: Record<string, keyof MusicMetadata> = {
  title: "title",
  artist: "artists",
  album: "album",
  albumartist: "albumArtists",
  track: "trackNumber",
  disc: "discNumber",
  year: "year",
  genre: "genres",
};

function Cell({
  column,
  file,
  selected,
  editing,
  onStartEdit,
  onCommit,
  onCancel,
}: {
  column: Column;
  file: LibraryFile;
  selected: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const value = column.display ? column.display(file) : "";
  const isEdited = isFieldDirty(file, column.id);

  if (column.id === "artwork") {
    return (
      <div
        style={{ width: column.width, minWidth: column.width }}
        className="flex shrink-0 items-center justify-center border-r border-[var(--line)]"
      >
        <ArtworkCell file={file} />
      </div>
    );
  }

  return (
    <div
      style={{ width: column.width, minWidth: column.width }}
      className={cn(
        "flex shrink-0 items-center border-r border-[var(--line)] px-2",
        column.mono && "mono text-body",
        column.align === "right" && "justify-end tnum",
        column.align === "center" && "justify-center",
      )}
      onDoubleClick={column.editable ? onStartEdit : undefined}
      title={value}
    >
      {editing ? (
        <InlineEditor
          initial={value}
          onCommit={onCommit}
          onCancel={onCancel}
          align={column.align}
        />
      ) : (
        <span className={cn("flex w-full items-center gap-1 truncate", !value && "text-[var(--text-faint)]")}>
          {column.id === "status" && file.tagStatus === "error" ? (
            <AlertTriangle size={10} className="shrink-0 text-[var(--danger)]" />
          ) : null}
          {column.id === "status" && isEdited ? (
            <Pencil size={9} className="shrink-0 text-[var(--accent)]" />
          ) : null}
          <span className={cn("truncate", isEdited && "dirty-underline")}>{value || "—"}</span>
        </span>
      )}
      {selected && column.editable && !editing ? (
        <ChevronRight size={10} className="ml-auto shrink-0 text-[var(--text-faint)] opacity-0 group-hover:opacity-100" />
      ) : null}
    </div>
  );
}

function isFieldDirty(file: LibraryFile, columnId: string): boolean {
  const pending = file.pending;
  if (!pending) return false;
  if (columnId === "status") return true;
  if (columnId === "filename") return Boolean(pending.newName);
  const field = FIELD_FOR_COLUMN[columnId];
  if (!field) return false;
  return pending.cleared.includes(String(field)) || pending.values[field] !== undefined;
}

function InlineEditor({
  initial,
  onCommit,
  onCancel,
  align,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  align?: "left" | "right" | "center";
}) {
  const [value, setValue] = React.useState(initial);
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
        e.stopPropagation();
      }}
      className={cn(
        "h-[20px] w-full rounded-[2px] border border-[var(--accent)] bg-[var(--chassis)] px-1 text-body outline-none",
        align === "right" && "text-right tnum",
      )}
    />
  );
}

export function NoFiles({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="max-w-[420px] text-center">
        <FileMusic size={28} className="mx-auto mb-3 text-[var(--text-faint)]" />
        <h2 className="text-title font-semibold tracking-tight">No music loaded</h2>
        <p className="mt-1.5 text-body leading-relaxed text-[var(--text-dim)]">
          Open a folder to scan it, add individual files, or drop music anywhere in this window.
        </p>
        <button type="button" className="btn btn-primary mt-4" onClick={onOpen}>
          Open Folder
        </button>
      </div>
    </div>
  );
}