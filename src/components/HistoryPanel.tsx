import { useStore } from "../lib/store";
import { Badge, Button, EmptyState, IconButton } from "./ui/primitives";
import { History, RotateCcw, Trash2, Undo2 } from "lucide-react";
import type { HistoryEntry } from "../lib/library/types";

/**
 * The audit trail.
 *
 * Every edit, batch action and save lands here, which makes the undo
 * history inspectable rather than invisible — and it is the only place a
 * save can be rolled back from its pre-write backup.
 */
export function HistoryPanel() {
  const history = useStore((s) => s.history);
  const undoStack = useStore((s) => s.undoStack);
  const redoStack = useStore((s) => s.redoStack);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const clearHistory = useStore((s) => s.clearHistory);

  return (
    <div className="flex h-full flex-col">
      <header className="hairline-b flex h-[42px] shrink-0 items-center gap-2 px-3">
        <History size={13} className="text-[var(--text-faint)]" />
        <h2 className="text-[13px] font-semibold">History</h2>
        <span className="tnum text-[11px] text-[var(--text-faint)]">{history.length}</span>
        <div className="flex-1" />
        <IconButton
          label="Undo"
          onClick={undo}
          disabled={!undoStack.length}
          className="h-[24px] w-[24px]"
        >
          <Undo2 size={12} />
        </IconButton>
        <IconButton
          label="Redo"
          onClick={redo}
          disabled={!redoStack.length}
          className="h-[24px] w-[24px]"
        >
          <RotateCcw size={12} />
        </IconButton>
        <IconButton
          label="Clear history"
          onClick={clearHistory}
          disabled={!history.length}
          className="h-[24px] w-[24px]"
        >
          <Trash2 size={12} />
        </IconButton>
      </header>

      {!history.length ? (
        <EmptyState
          icon={<History size={18} />}
          title="Nothing recorded yet"
          description="Edits, batch actions and saves are logged here as you work. Saves keep a pre-write copy that can be restored from this panel."
        />
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto">
          {history.map((entry) => (
            <li key={entry.id}>
              <HistoryRow entry={entry} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const restoreBackup = useStore((s) => s.restoreBackup);
  const files = new Set(entry.changes.map((c) => c.fileId)).size;

  return (
    <div className="row-hover hairline-b flex flex-col gap-1.5 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <time className="tnum shrink-0 text-[10.5px] text-[var(--text-faint)]">
          {new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </time>
        <span className="min-w-0 flex-1 truncate text-[12px]">{entry.operation}</span>
        {entry.writeResult ? <Badge tone={toneFor(entry.writeResult)} dot>{entry.writeResult}</Badge> : null}
      </div>

      {entry.changes.length ? (
        <p className="hint truncate">
          {files} file{files === 1 ? "" : "s"} · {entry.changes.length} field
          {entry.changes.length === 1 ? "" : "s"}
        </p>
      ) : null}

      {entry.errors?.length ? (
        <p className="truncate text-[10.5px] text-[var(--danger)]" title={entry.errors.join("\n")}>
          {entry.errors[0]}
          {entry.errors.length > 1 ? ` (+${entry.errors.length - 1})` : ""}
        </p>
      ) : null}

      {entry.backups?.length ? (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void restoreBackup(entry.id)}>
            <RotateCcw size={11} /> Restore {entry.backups.length} backup
            {entry.backups.length === 1 ? "" : "s"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function toneFor(result: NonNullable<HistoryEntry["writeResult"]>): "ok" | "warn" | "danger" | "neutral" {
  switch (result) {
    case "applied":
      return "ok";
    case "partial":
      return "warn";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}
