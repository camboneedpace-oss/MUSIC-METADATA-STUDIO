import * as React from "react";
import {
  ArrowRight,
  Command as CommandIcon,
  FolderOpen,
  Gauge,
  Globe,
  ListChecks,
  Redo2,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Undo2,
  Wrench,
} from "lucide-react";
import { useStore, useSelectedFiles } from "../lib/store";

interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  keys?: string;
  disabled?: boolean;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const files = useStore((s) => s.files);
  const selected = useSelectedFiles();
  const [query, setQuery] = React.useState("");
  const [index, setIndex] = React.useState(0);
  const listRef = React.useRef<HTMLUListElement>(null);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  const commands = React.useMemo<Command[]>(() => {
    const hasFiles = files.size > 0;
    const hasSelection = selected.length > 0;
    const hasPending = store.pending.size > 0;
    const open = (name: string) => () => store.openDialog(name);
    const collection = (bucket: string) => () => store.openDialog("collection", bucket);

    return [
      {
        id: "open-folder",
        label: "Open folder",
        group: "Library",
        keys: "Ctrl+O",
        disabled: !store.capabilities.directoryPicker,
        run: () => void store.openFolder(),
      },
      { id: "add-files", label: "Add files…", group: "Library", run: () => void store.pickFiles() },
      {
        id: "rescan",
        label: "Rescan library",
        group: "Library",
        keys: "Ctrl+R",
        disabled: !hasFiles,
        run: () => void store.rescan(),
      },
      {
        id: "save",
        label: hasPending ? `Save ${store.pending.size} pending change(s)` : "Save (nothing pending)",
        group: "Library",
        keys: "Ctrl+S",
        disabled: !hasPending,
        run: () => void store.save(),
      },
      { id: "discard", label: "Discard unsaved changes", group: "Library", disabled: !hasPending, run: () => store.discardChanges() },
      { id: "clear", label: "Clear library", group: "Library", disabled: !hasFiles, run: () => store.clearLibrary() },

      {
        id: "undo",
        label: "Undo",
        group: "Edit",
        keys: "Ctrl+Z",
        disabled: !store.undoStack.length,
        run: () => store.undo(),
      },
      {
        id: "redo",
        label: "Redo",
        group: "Edit",
        keys: "Ctrl+Shift+Z",
        disabled: !store.redoStack.length,
        run: () => store.redo(),
      },
      { id: "batch", label: "Batch editor", group: "Edit", disabled: !hasSelection, run: open("batch") },
      { id: "cleanup", label: "Metadata cleanup", group: "Edit", disabled: !hasSelection, run: open("cleanup") },
      { id: "findreplace", label: "Find & replace", group: "Edit", disabled: !hasSelection, run: open("findreplace") },
      { id: "actions", label: "Action groups", group: "Edit", disabled: !hasSelection, run: open("actions") },
      { id: "preview", label: "Preview changes", group: "Edit", disabled: !hasPending, run: open("preview") },

      { id: "lookup", label: "Metadata lookup", group: "Tools", disabled: !hasSelection, run: open("lookup") },
      { id: "artwork", label: "Artwork manager", group: "Tools", disabled: !hasSelection, run: open("artwork") },
      { id: "rename", label: "Rename tool", group: "Tools", disabled: !hasSelection, run: open("rename") },
      { id: "parse", label: "Parse filenames", group: "Tools", disabled: !hasSelection, run: open("parse") },
      { id: "converter", label: "Converter", group: "Tools", disabled: !hasSelection, run: open("converter") },
      { id: "playlist", label: "Playlist builder", group: "Tools", disabled: !hasSelection, run: open("playlist") },
      { id: "duplicates", label: "Duplicate finder", group: "Tools", disabled: !hasFiles, run: open("duplicates") },
      { id: "analyzer", label: "Audio analyzer", group: "Tools", disabled: !hasFiles, run: open("analyzer") },
      { id: "export", label: "Export studio", group: "Tools", disabled: !hasFiles, run: open("export") },
      { id: "formats", label: "Format support matrix", group: "Tools", run: open("formats") },
      { id: "artists", label: "Browse artists", group: "Browse", disabled: !hasFiles, run: collection("artist") },
      { id: "albums", label: "Browse albums", group: "Browse", disabled: !hasFiles, run: collection("album") },
      { id: "genres", label: "Browse genres", group: "Browse", disabled: !hasFiles, run: collection("genre") },
      { id: "labels", label: "Browse labels", group: "Browse", disabled: !hasFiles, run: collection("label") },
      { id: "folders", label: "Browse folders", group: "Browse", disabled: !hasFiles, run: collection("folder") },

      {
        id: "theme",
        label: `Theme: ${store.settings.theme}`,
        group: "View",
        run: () => {
          const order = ["dark", "oled", "light", "contrast"];
          const next = order[(order.indexOf(store.settings.theme) + 1) % order.length];
          void store.updateSettings({ theme: next });
        },
      },
      { id: "inspector", label: "Toggle inspector", group: "View", keys: "Ctrl+I", run: () => store.togglePanel("inspector") },
      { id: "select-all", label: "Select all visible", group: "View", keys: "Ctrl+A", disabled: !hasFiles, run: () => store.selectAll() },
      { id: "settings", label: "Settings", group: "View", run: open("settings") },
    ].filter((c) => Boolean(c.run)) as Command[];
  }, [files.size, selected.length, store]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const scored = commands.filter((c) => !c.disabled);
    if (!q) return scored;
    return scored
      .map((c) => ({ c, score: score(c.label.toLowerCase(), q) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
  }, [commands, query]);

  React.useEffect(() => {
    setIndex(0);
  }, [query]);

  React.useEffect(() => {
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [index, filtered.length]);

  if (!open) return null;

  const activate = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <div className="animate-overlay-in fixed inset-0 z-[80] flex items-start justify-center bg-black/55 pt-[13vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Command palette"
        className="animate-dialog-in w-[600px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line-strong)] bg-[var(--panel)] shadow-[var(--shadow-pop)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--line)] px-4">
          <Search size={14} className="shrink-0 text-[var(--text-faint)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                activate(filtered[index]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Run a command…"
            aria-label="Command"
            className="h-[46px] flex-1 bg-transparent text-lead outline-none placeholder:text-[var(--text-faint)]"
          />
          <span className="kbd">esc</span>
        </div>

        <ul ref={listRef} className="max-h-[46vh] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-body text-[var(--text-faint)]">
              No command matches “{query}”.
            </li>
          ) : (
            filtered.map((command, i) => (
              <li key={command.id}>
                <button
                  type="button"
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => activate(command)}
                  className={
                    i === index
                      ? "flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-2.5 py-[7px] text-left"
                      : "flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-[7px] text-left hover:bg-[var(--raised)]"
                  }
                >
                  <IconFor id={command.id} active={i === index} />
                  <span className="flex-1 truncate text-[12.5px]">{command.label}</span>
                  <span className="label-xs">{command.group}</span>
                  {command.keys ? (
                    <span className="kbd">{command.keys}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="flex items-center gap-4 border-t border-[var(--line)] bg-[var(--panel-2)] px-4 py-2 text-label text-[var(--text-faint)]">
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">↑↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">↵</kbd> run
          </span>
          <span className="flex-1" />
          <span className="tnum">{filtered.length} command(s)</span>
        </div>
      </div>
    </div>
  );
}

function IconFor({ id, active }: { id: string; active: boolean }) {
  const props = {
    size: 14,
    className: active ? "shrink-0 text-[var(--accent)]" : "shrink-0 text-[var(--text-faint)]",
  };
  switch (id) {
    case "open-folder":
      return <FolderOpen {...props} />;
    case "add-files":
      return <FolderOpen {...props} />;
    case "rescan":
      return <RefreshCw {...props} />;
    case "save":
      return <Save {...props} />;
    case "discard":
      return <Trash2 {...props} />;
    case "clear":
      return <Trash2 {...props} />;
    case "undo":
      return <Undo2 {...props} />;
    case "redo":
      return <Redo2 {...props} />;
    case "batch":
      return <ListChecks {...props} />;
    case "lookup":
      return <Globe {...props} />;
    case "actions":
      return <Wrench {...props} />;
    case "analyzer":
      return <Gauge {...props} />;
    case "rename":
    case "parse":
      return <Sparkles {...props} />;
    case "formats":
      return <ListChecks {...props} />;
    case "artists":
    case "albums":
    case "genres":
      return <ArrowRight {...props} />;
    case "settings":
      return <Settings {...props} />;
    default:
      return <CommandIcon {...props} />;
  }
}

/** Subsequence match; lower score is a better (tighter) match. */
function score(label: string, query: string): number {
  const direct = label.indexOf(query);
  if (direct !== -1) return direct;
  let at = 0;
  let gaps = 0;
  for (const ch of query) {
    const found = label.indexOf(ch, at);
    if (found === -1) return -1;
    gaps += found - at;
    at = found + 1;
  }
  return 100 + gaps;
}
