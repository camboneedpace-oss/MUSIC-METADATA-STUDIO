import {
  AudioWaveform,
  Command,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  ListChecks,
  Moon,
  History,
  PanelsTopLeft,
  Redo2,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Sun,
  Undo2,
  Wrench,
} from "lucide-react";
import { useStore } from "../lib/store";
import { cn, IconButton, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/primitives";

/** Kept out of the JSX attribute so the quotes stay literal. */
const SEARCH_PLACEHOLDER = 'Search  ·  artist:"Radiohead" format:flac year:>2000';

export function TopBar({
  onOpenDialog,
  onTogglePalette,
}: {
  onOpenDialog: (name: string) => void;
  onTogglePalette: () => void;
}) {
  const files = useStore((s) => s.files);
  const pending = useStore((s) => s.pending);
  const save = useStore((s) => s.save);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const openFolder = useStore((s) => s.openFolder);
  const pickFiles = useStore((s) => s.pickFiles);
  const rescan = useStore((s) => s.rescan);
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const agent = useStore((s) => s.agent);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const busy = useStore((s) => s.busy);
  const canOpenFolder = useStore((s) => s.capabilities.directoryPicker);
  const panels = useStore((s) => s.panels);
  const togglePanel = useStore((s) => s.togglePanel);
  const count = files.size;
  const dirtyCount = pending.size;

  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-1 border-b border-[var(--line)] bg-[linear-gradient(180deg,var(--panel-2),var(--panel))] pl-3 pr-2">
      {/* Wordmark */}
      <div className="flex items-center gap-2.5 pr-1">
        <span className="relative flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_2px_10px_-2px_var(--accent-glow)]">
          <AudioWaveform size={15} strokeWidth={2.4} />
        </span>
        <span className="hidden select-none leading-none lg:block">
          <span className="block text-[12.5px] font-semibold tracking-tight">Metadata Studio</span>
          <span className="label-xs mt-[3px] block">Universal music tagger</span>
        </span>
      </div>

      <div className="divider-v mx-1" />

      {/* Library actions */}
      <nav className="flex items-center gap-0.5" aria-label="Library">
        <IconButton label="Open folder  (Ctrl+O)" onClick={() => void openFolder()} disabled={!canOpenFolder}>
          <FolderOpen size={14} />
        </IconButton>
        <IconButton label="Add files  (Ctrl+Shift+O)" onClick={() => void pickFiles()}>
          <ListChecks size={14} />
        </IconButton>
        <IconButton label="Rescan library  (Ctrl+R)" onClick={() => void rescan()} disabled={!count}>
          <RefreshCw size={14} />
        </IconButton>
      </nav>

      <div className="divider-v mx-1" />

      {/* Editing actions — the save button carries state, so it gets weight. */}
      <nav className="flex items-center gap-0.5" aria-label="Edit">
        <IconButton
          label={dirtyCount ? `Save ${dirtyCount} pending change(s)  (Ctrl+S)` : "Nothing to save  (Ctrl+S)"}
          onClick={() => void save()}
          disabled={!dirtyCount}
        >
          <Save size={14} className={dirtyCount ? "text-[var(--accent)]" : undefined} />
        </IconButton>
        <IconButton label="Undo  (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
          <Undo2 size={14} />
        </IconButton>
        <IconButton label="Redo  (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}>
          <Redo2 size={14} />
        </IconButton>
      </nav>

      <div className="divider-v mx-1" />

      {/* Tools */}
      <nav className="hidden items-center gap-0.5 xl:flex" aria-label="Tools">
        <IconButton label="Lookup metadata" onClick={() => onOpenDialog("lookup")}>
          <Globe size={14} />
        </IconButton>
        <IconButton label="Artwork manager" onClick={() => onOpenDialog("artwork")}>
          <ImageIcon size={14} />
        </IconButton>
        <IconButton label="Rename tool" onClick={() => onOpenDialog("rename")}>
          <Sparkles size={14} />
        </IconButton>
        <IconButton label="Action groups" onClick={() => onOpenDialog("actions")}>
          <Wrench size={14} />
        </IconButton>
        <IconButton label="Export studio" onClick={() => onOpenDialog("export")}>
          <ListChecks size={14} />
        </IconButton>
      </nav>

      {/* Search — centred and always visible; this is the primary way to move. */}
      <div className="mx-auto min-w-0 flex-1 px-4">
        <div className="relative mx-auto max-w-[540px]">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={SEARCH_PLACEHOLDER}
            aria-label="Search library"
            className="input h-[30px] rounded-[var(--radius-md)] pl-8 pr-16"
          />
          <button
            type="button"
            onClick={onTogglePalette}
            aria-label="Open command palette"
            className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-[var(--radius-xs)] border border-[var(--line-strong)] bg-[var(--panel)] px-1.5 py-px text-[10px] font-medium text-[var(--text-faint)] transition-colors hover:border-[var(--text-faint)] hover:text-[var(--text-dim)]"
          >
            <Command size={9} />K
          </button>
        </div>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-1.5 pl-1">
        {busy ? (
          <span
            className="flex max-w-[200px] items-center gap-1.5 truncate text-[11px] text-[var(--accent)]"
            title={busy.detail}
          >
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--accent)]" />
            <span className="truncate">
              {busy.label}
              {busy.detail ? `: ${busy.detail}` : ""}
            </span>
          </span>
        ) : null}

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[10px] font-medium uppercase tracking-[0.06em] transition-colors",
                  agent.state === "connected"
                    ? "border-[color-mix(in_oklab,var(--ok)_40%,transparent)] text-[var(--ok)]"
                    : "border-[var(--line-strong)] text-[var(--text-faint)]",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    agent.state === "connected"
                      ? "bg-[var(--ok)] shadow-[0_0_6px_var(--ok)]"
                      : "bg-[var(--text-faint)]",
                  )}
                />
                <span className="hidden sm:inline">Agent</span>
                {agent.state === "connected" ? "on" : "off"}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {agent.state === "connected"
                ? `Local agent connected: ${agent.info.name} ${agent.info.version}`
                : agent.state === "checking"
                  ? "Looking for a local agent on 127.0.0.1"
                  : agent.state === "disconnected"
                    ? agent.detail
                    : "This browser cannot reach the local agent"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="divider-v mx-0.5" />

        <IconButton
          label="Toggle history  (Ctrl+H)"
          onClick={() => togglePanel("history")}
          data-active={panels.history}
        >
          <History size={14} />
        </IconButton>

        <IconButton
          label="Toggle history  (Ctrl+H)"
          onClick={() => togglePanel("history")}
          data-active={panels.history}
        >
          <History size={14} />
        </IconButton>

        <IconButton
          label="Toggle inspector  (Ctrl+I)"
          onClick={() => togglePanel("inspector")}
          data-active={panels.inspector}
        >
          <PanelsTopLeft size={14} />
        </IconButton>

        <IconButton
          label={`Theme: ${settings.theme}`}
          onClick={() =>
            void updateSettings({
              theme: settings.theme === "dark" ? "light" : settings.theme === "light" ? "oled" : settings.theme === "oled" ? "contrast" : "dark",
            })
          }
        >
          {settings.theme === "light" ? <Sun size={14} /> : <Moon size={14} />}
        </IconButton>
        <IconButton label="Settings" onClick={() => onOpenDialog("settings")}>
          <Settings size={14} />
        </IconButton>
      </div>
    </header>
  );
}