import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  AudioLines,
  Copy,
  Disc3,
  Download,
  FileMusic,
  FolderOpen,
  Gauge,
  Globe,
  Heart,
  Image as ImageIcon,
  ListMusic,
  Music2,
  Repeat,
  Search,
  Sparkles,
  Tag,
  Timer,
  Wand2,
  Wrench,
} from "lucide-react";
import { useStore, useSelectedFiles, type LibraryFile } from "../lib/store";
import { findDuplicates } from "../lib/analysis/duplicates";
import { computeHealth } from "../lib/analysis/validation";
import { cn, ProgressBar } from "./ui/primitives";

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  count?: number;
  tone?: "warn" | "danger";
}

export function Sidebar({ onOpenTool }: { onOpenTool: (name: string) => void }) {
  const activeView = useStore((s) => s.activeView);
  const setView = useStore((s) => s.setView);
  const files = useStore((s) => s.files);
  const order = useStore((s) => s.order);
  const selected = useSelectedFiles();

  const derived = useMemo(() => {
    const all: LibraryFile[] = [];
    for (const id of order) {
      const file = files.get(id);
      if (file) all.push(file);
    }
    const duplicates = findDuplicates(all).length;
    const health = computeHealth(all, duplicates);
    return {
      all,
      duplicates,
      health,
      missingArtwork: all.filter((f) => !(f.metadata.artwork ?? []).length).length,
      missingMetadata: all.filter((f) => !f.metadata.title || !f.metadata.artists?.length).length,
      errors: all.filter((f) => f.tagStatus === "error").length,
      recent: all.filter((f) => Date.now() - f.addedAt < 7 * 864e5).length,
      modified: all.filter((f) => Date.now() - f.modifiedAt < 7 * 864e5).length,
      dirty: all.filter((f) => f.dirty).length,
      artists: new Set(all.flatMap((f) => f.metadata.artists ?? [])).size,
      albums: new Set(all.map((f) => f.metadata.album).filter(Boolean)).size,
      genres: new Set(all.flatMap((f) => f.metadata.genres ?? [])).size,
      years: new Set(all.map((f) => f.metadata.year).filter(Boolean)).size,
      formats: new Set(all.map((f) => f.format)).size,
      folders: new Set(all.map((f) => f.folder).filter(Boolean)).size,
    };
  }, [files, order]);

  const library: NavItem[] = [
    { id: "all", label: "All Files", icon: <FileMusic size={13} />, count: derived.all.length },
    { id: "recent", label: "Recently Added", icon: <Timer size={13} />, count: derived.recent },
    { id: "modified", label: "Recently Modified", icon: <Activity size={13} />, count: derived.modified },
    { id: "dirty", label: "Unsaved Changes", icon: <Wand2 size={13} />, count: derived.dirty, tone: "warn" },
    { id: "favorites", label: "Writable Files", icon: <Heart size={13} /> },
    { id: "missing-artwork", label: "Missing Artwork", icon: <ImageIcon size={13} />, count: derived.missingArtwork },
    { id: "missing-metadata", label: "Missing Metadata", icon: <Tag size={13} />, count: derived.missingMetadata },
    { id: "errors", label: "Errors", icon: <AlertTriangle size={13} />, count: derived.errors, tone: "danger" },
  ];

  const collection: NavItem[] = [
    { id: "collection:artist", label: "Artists", icon: <Music2 size={13} />, count: derived.artists },
    { id: "collection:album", label: "Albums", icon: <Disc3 size={13} />, count: derived.albums },
    { id: "collection:genre", label: "Genres", icon: <AudioLines size={13} />, count: derived.genres },
    { id: "collection:year", label: "Years", icon: <Sparkles size={13} />, count: derived.years },
    { id: "collection:label", label: "Labels", icon: <Tag size={13} /> },
    { id: "collection:folder", label: "Folders", icon: <FolderOpen size={13} />, count: derived.folders },
    { id: "formats", label: "Format Matrix", icon: <Disc3 size={13} />, count: derived.formats },
  ];

  const tools: NavItem[] = [
    { id: "batch", label: "Batch Editor", icon: <Tag size={13} /> },
    { id: "lookup", label: "Metadata Lookup", icon: <Globe size={13} /> },
    { id: "artwork", label: "Artwork Manager", icon: <ImageIcon size={13} /> },
    { id: "rename", label: "Rename Tool", icon: <Sparkles size={13} /> },
    { id: "parse", label: "Filename Parser", icon: <Wand2 size={13} /> },
    { id: "cleanup", label: "Metadata Cleanup", icon: <Wand2 size={13} /> },
    { id: "findreplace", label: "Find & Replace", icon: <Search size={13} /> },
    { id: "converter", label: "Converter", icon: <Repeat size={13} /> },
    { id: "playlist", label: "Playlist Builder", icon: <ListMusic size={13} /> },
    { id: "duplicates", label: "Duplicate Finder", icon: <Copy size={13} />, count: derived.duplicates },
    { id: "analyzer", label: "Audio Analyzer", icon: <Gauge size={13} /> },
    { id: "export", label: "Export Studio", icon: <Download size={13} /> },
    { id: "actions", label: "Action Groups", icon: <Wrench size={13} /> },
    { id: "formats", label: "Format Matrix", icon: <Disc3 size={13} /> },
  ];

  const renderGroup = (title: string, items: NavItem[]) => (
    <div className="mb-4">
      <h3 className="label-xs px-3 pb-1.5 pt-3">{title}</h3>
      <ul className="px-1.5">
        {items.map((item) => {
          const isView = library.includes(item);
          const active = isView && activeView === item.id;
          return (
            <li key={`${title}-${item.id}`}>
              <button
                type="button"
                onClick={() => (isView ? setView(item.id) : onOpenTool(item.id))}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "group relative flex h-[26px] w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-body transition-all duration-150",
                  active
                    ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                    : "text-[var(--text-dim)] hover:bg-[var(--raised)] hover:text-[var(--text)]",
                )}
              >
                {/* Active rail: a 2px marker so the current view is obvious
                    even when the accent is overridden by the user. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-0 h-[14px] w-[2px] rounded-full bg-[var(--accent)] transition-opacity duration-150",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
                <span
                  className={cn(
                    "shrink-0 transition-colors",
                    active ? "text-[var(--accent)]" : "text-[var(--text-faint)] group-hover:text-[var(--text-dim)]",
                  )}
                >
                  {item.icon}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.count !== undefined && item.count > 0 ? (
                  <span
                    className={cn(
                      "tnum rounded-full px-1.5 text-[10px] leading-[15px] transition-colors",
                      item.tone === "danger"
                        ? "bg-[color-mix(in_oklab,var(--danger)_16%,transparent)] text-[var(--danger)]"
                        : item.tone === "warn"
                          ? "bg-[color-mix(in_oklab,var(--warn)_16%,transparent)] text-[var(--warn)]"
                          : "text-[var(--text-faint)] group-hover:text-[var(--text-dim)]",
                    )}
                  >
                    {item.count}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <nav
      aria-label="Library navigation"
      className="flex w-[216px] shrink-0 flex-col overflow-y-auto border-r border-[var(--line)] bg-[var(--panel)]"
    >
      <div className="flex-1 pb-4">
        {renderGroup("Library", library)}
        {renderGroup("Collection", collection)}
        {renderGroup("Tools", tools)}
      </div>

      {derived.all.length > 0 ? (
        <div className="border-t border-[var(--line)] bg-[var(--panel-2)] px-3 py-3">
          <h3 className="label-xs pb-2">Library Health</h3>
          <HealthRow label="Metadata" value={derived.health.metadataCompleteness} />
          <HealthRow label="Artwork" value={derived.health.artworkCoverage} />
          <HealthRow label="Filenames" value={derived.health.filenameConsistency} />
          <p className="mt-2.5 border-t border-[var(--line)] pt-2 text-label leading-snug text-[var(--text-faint)]">
            {derived.duplicates} duplicate group{derived.duplicates === 1 ? "" : "s"}
            {selected.length ? ` · ${selected.length} selected` : ""}
          </p>
        </div>
      ) : null}
    </nav>
  );
}

function HealthRow({ label, value }: { label: string; value: number }) {
  const tone = value > 80 ? "ok" : value > 50 ? "warn" : "danger";
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-label text-[var(--text-dim)]">{label}</span>
        <span className={cn("tnum text-label font-medium", `text-[var(--${tone})]`)}>{value}%</span>
      </div>
      <ProgressBar value={value / 100} tone={tone} />
    </div>
  );
}