import * as React from "react";
import { Loader2, Upload } from "lucide-react";
import { useStore } from "./lib/store";
import { fromDataTransfer, isAudioFileList } from "./lib/filesystem";
import { TooltipProvider } from "./components/ui/primitives";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { FileTable } from "./components/FileTable";
import { Inspector } from "./components/Inspector";
import { StatusBar } from "./components/StatusBar";
import { HistoryPanel } from "./components/HistoryPanel";
import { Toasts } from "./components/Toasts";
import { Welcome } from "./components/Welcome";
import { CommandPalette } from "./components/CommandPalette";
import { SelectionToolbar } from "./components/BatchEditor";
import { BatchEditor } from "./components/BatchEditor";
import { PreviewDialog } from "./components/PreviewDialog";
import { RenameDialog, ParseDialog } from "./components/RenameDialog";
import { LookupDialog } from "./components/LookupDialog";
import { ArtworkDialog } from "./components/ArtworkDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { ActionsDialog } from "./components/ActionsDialog";
import { AnalyzerDialog } from "./components/AnalyzerDialog";
import { FormatsDialog } from "./components/FormatsMatrix";
import { CollectionDialog, type Bucket } from "./components/CollectionDialog";
import { CleanupDialog, FindReplaceDialog, ConverterDialog } from "./components/ToolsDialogs";
import { DuplicatesDialog, PlaylistDialog, ExportDialog } from "./components/OutputDialogs";

export default function App() {
  const init = useStore((s) => s.init);
  const dialog = useStore((s) => s.dialog);
  const dialogPayload = useStore((s) => s.dialogPayload);
  const openDialog = useStore((s) => s.openDialog);
  const closeDialog = useStore((s) => s.closeDialog);
  const fileCount = useStore((s) => s.files.size);
  const visibleCount = useStore((s) => s.visibleIds.length);
  const showInspector = useStore((s) => s.panels.inspector);
  const showHistory = useStore((s) => s.panels.history);
  const scanning = useStore((s) => s.scanning);
  const scan = useStore((s) => s.scan);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const dragDepth = React.useRef(0);

  React.useEffect(() => {
    void init();
  }, [init]);

  /* ---------------------------------------------------------- drag & drop */

  React.useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!isAudioFileList(e.dataTransfer)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!isAudioFileList(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!isAudioFileList(e.dataTransfer)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      dragDepth.current = 0;
      setDragging(false);
      if (!e.dataTransfer) return;
      e.preventDefault();
      void fromDataTransfer(e.dataTransfer).then((collected) => {
        if (!collected.length) {
          useStore.getState().toast({
            kind: "warning",
            message: "Nothing importable in that drop",
            detail: "Drop audio files, or a folder that contains them.",
          });
          return;
        }
        void useStore.getState().addFiles(collected);
      });
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  /* --------------------------------------------------------- keyboard map */

  React.useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };

    const onKey = (e: KeyboardEvent) => {
      const store = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === "Escape") {
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        if (store.dialog) {
          store.closeDialog();
          return;
        }
        if (store.selection.set.size) {
          store.select([], "none");
          return;
        }
      }

      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }

      if (isTyping(e.target)) return;

      if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void store.pickFiles();
        return;
      }
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void store.openFolder();
        return;
      }
      if (mod && e.key.toLowerCase() === "r") {
        e.preventDefault();
        void store.rescan();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void store.save();
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        store.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "i") {
        e.preventDefault();
        store.togglePanel("inspector");
        return;
      }
      if (mod && e.key.toLowerCase() === "h") {
        e.preventDefault();
        store.togglePanel("history");
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[aria-label="Search library"]')?.focus();
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        store.selectAll();
        return;
      }
      if (mod && e.key.toLowerCase() === "p") {
        e.preventDefault();
        store.openDialog("preview");
        return;
      }

      if (e.altKey) return;

      switch (e.key) {
        case "Delete":
        case "Backspace":
          if (store.selection.set.size) {
            e.preventDefault();
            store.discardChanges([...store.selection.set]);
          }
          return;
        case "F2":
          if (store.selection.lastClicked) {
            e.preventDefault();
            document.querySelector<HTMLInputElement>('input[aria-label="Search library"]')?.blur();
            document.dispatchEvent(new CustomEvent("studio:begin-edit", { detail: store.selection.lastClicked }));
          }
          return;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

  /* Sidebar/selection toolbar hand us a tool id; collection entries arrive
     prefixed so the bucket can travel through the single dialog slot. */
  const openTool = React.useCallback(
    (name: string) => {
      if (name.startsWith("collection:")) {
        openDialog("collection", name.slice("collection:".length));
        return;
      }
      openDialog(name);
    },
    [openDialog],
  );

  /* ------------------------------------------------------------- rendering */

  const body = fileCount
    ? visibleCount
      ? <FileTable />
      : (
          <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-faint)]">
            No files match the current view.
          </div>
        )
    : <Welcome />;

  return (
    <TooltipProvider delayDuration={350}>
      <div className="flex h-full flex-col bg-[var(--chassis)] text-[var(--text)]">
        <TopBar onOpenDialog={openTool} onTogglePalette={() => setPaletteOpen((o) => !o)} />

        <div className="flex min-h-0 flex-1">
          {fileCount ? <Sidebar onOpenTool={openTool} /> : null}

          <main className="flex min-w-0 flex-1 flex-col">
            {fileCount ? <SelectionToolbar onOpen={openTool} /> : null}
            {body}
          </main>

          {fileCount && showHistory ? (
            <aside className="flex w-[300px] shrink-0 flex-col border-l border-[var(--line)] bg-[var(--panel)]">
              <HistoryPanel />
            </aside>
          ) : null}

          {fileCount && showInspector ? (
            <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-[var(--line)] bg-[var(--panel)]">
              <Inspector />
            </aside>
          ) : null}
        </div>

        <StatusBar />
      </div>

      {/* scan overlay */}
      {scanning && scan.total > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 top-[42px] z-[65]">
          <div className="mx-auto mt-2 flex w-[420px] items-center gap-2.5 rounded-[4px] border border-[var(--line-strong)] bg-[var(--raised)] px-3 py-2 shadow-[var(--shadow-pop)]">
            <Loader2 size={13} className="animate-spin text-[var(--accent)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11.5px]">
                Reading tags <span className="tnum text-[var(--text-faint)]">{scan.done}/{scan.total}</span>
              </p>
              <p className="mono truncate text-[10.5px] text-[var(--text-faint)]">{scan.current}</p>
            </div>
            <div className="h-[3px] w-[90px] overflow-hidden rounded-full bg-[var(--chassis)]">
              <div
                className="h-full bg-[var(--accent)] transition-[width] duration-150"
                style={{ width: `${Math.round((scan.done / scan.total) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* drop overlay */}
      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-[75] flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-2 rounded-[6px] border-2 border-dashed border-[var(--accent)] bg-[var(--panel)] px-10 py-8">
            <Upload size={22} className="text-[var(--accent)]" />
            <p className="text-[13px] font-semibold">Drop to import</p>
            <p className="text-[11px] text-[var(--text-dim)]">Files and folders are scanned recursively</p>
          </div>
        </div>
      ) : null}

      <Toasts />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      <Dialogs name={dialog} payload={dialogPayload} onClose={closeDialog} />
    </TooltipProvider>
  );
}

/** One place that maps the store's dialog name to a mounted component. */
function Dialogs({
  name,
  payload,
  onClose,
}: {
  name: string | null;
  payload: unknown;
  onClose: () => void;
}) {
  const open = Boolean(name);
  const bucket: Bucket = (payload as Bucket) ?? "artist";
  switch (name) {
    case "batch":
      return <BatchEditor open={open} onClose={onClose} />;
    case "preview":
      return <PreviewDialog open={open} onClose={onClose} />;
    case "rename":
      return <RenameDialog open={open} onClose={onClose} />;
    case "parse":
      return <ParseDialog open={open} onClose={onClose} />;
    case "lookup":
      return <LookupDialog open={open} onClose={onClose} />;
    case "artwork":
      return <ArtworkDialog open={open} onClose={onClose} />;
    case "cleanup":
      return <CleanupDialog open={open} onClose={onClose} />;
    case "findreplace":
      return <FindReplaceDialog open={open} onClose={onClose} />;
    case "converter":
      return <ConverterDialog open={open} onClose={onClose} />;
    case "duplicates":
      return <DuplicatesDialog open={open} onClose={onClose} />;
    case "playlist":
      return <PlaylistDialog open={open} onClose={onClose} />;
    case "export":
      return <ExportDialog open={open} onClose={onClose} />;
    case "actions":
      return <ActionsDialog open={open} onClose={onClose} />;
    case "analyzer":
      return <AnalyzerDialog open={open} onClose={onClose} />;
    case "formats":
      return <FormatsDialog open={open} onClose={onClose} />;
    case "settings":
      return <SettingsDialog open={open} onClose={onClose} />;
    case "collection":
      return <CollectionDialog open={open} bucket={bucket} onClose={onClose} />;
    default:
      return null;
  }
}