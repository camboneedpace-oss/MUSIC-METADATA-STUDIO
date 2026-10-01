import * as React from "react";
import { ArrowRight, CheckCircle2, FileWarning, Save } from "lucide-react";
import { useStore } from "../lib/store";
import { validateForWrite, previewFile } from "../lib/safe-write";
import { formatBytes } from "../lib/metadata/types";
import { Button, Dialog, Badge, cn } from "./ui/primitives";
import type { LibraryFile } from "../lib/library/types";

interface Row {
  fileId: string;
  fileName: string;
  field: string;
  before: string;
  after: string;
}

export function PreviewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const files = useStore((s) => s.files);
  const pending = useStore((s) => s.pending);
  const applyTheme = useStore((s) => s.applyTheme);
  void applyTheme;
  const save = useStore((s) => s.save);
  const closeDialog = useStore((s) => s.closeDialog);
  const toast = useStore((s) => s.toast);

  const [rows, setRows] = React.useState<Row[]>([]);
  const [issues, setIssues] = React.useState<Map<string, string[]>>(new Map());
  const [sizes, setSizes] = React.useState<Map<string, { before: number; after: number }>>(new Map());
  const [checked, setChecked] = React.useState<boolean>(false);
  const [limitHit, setLimitHit] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setRows([]);
      setIssues(new Map());
      setChecked(false);
      return;
    }
    const out: Row[] = [];
    const problems = new Map<string, string[]>();

    for (const [fileId, edit] of pending) {
      const file = files.get(fileId);
      if (!file) continue;
      const target = { ...file.metadata, ...edit.values };
      const problemsForFile = validateForWrite(file.format, target)
        .filter((i) => i.severity === "error")
        .map((i) => i.message);
      if (problemsForFile.length) problems.set(fileId, problemsForFile);

      for (const [field, value] of Object.entries(edit.values)) {
        const beforeValue = file.metadata[field as keyof typeof file.metadata];
        out.push({
          fileId,
          fileName: file.name,
          field,
          before: stringify(beforeValue),
          after: stringify(value),
        });
      }
      if (edit.newName && edit.newName !== file.name) {
        out.push({
          fileId,
          fileName: file.name,
          field: "filename",
          before: file.name,
          after: edit.newName,
        });
      }
    }

    setRows(out.slice(0, 4000));
    setLimitHit(out.length > 4000);
    setIssues(problems);
    setSizes(new Map());
    setChecked(false);
  }, [open, pending, files]);

  /**
   * Serialises every pending file in memory and re-reads the result, exactly as
   * the real write will. Nothing touches the filesystem.
   */
  const verifyAll = async () => {
    setBusy(true);
    const problems = new Map<string, string[]>(issues);
    const nextSizes = new Map<string, { before: number; after: number }>();
    for (const [fileId, edit] of pending) {
      const file = files.get(fileId);
      if (!file) continue;
      try {
        const result = await previewFile(file, { ...file.metadata, ...edit.values });
        nextSizes.set(fileId, { before: result.before, after: result.after });
        const failure = validateForWrite(file.format, { ...file.metadata, ...edit.values })
          .filter((i) => i.severity === "error")
          .map((i) => i.message);
        if (failure.length) problems.set(fileId, failure);
      } catch (err) {
        problems.set(fileId, [(err as Error).message]);
      }
    }
    setIssues(problems);
    setSizes(nextSizes);
    setBusy(false);
  };

  const affectedFiles = [...pending.keys()];
  const errorCount = issues.size;

  const onApply = async () => {
    const result = await save();
    if (!result.failed) {
      closeDialog();
      toast({
        kind: "success",
        message: `Saved ${result.completed} file(s)`,
        detail: "Every written file was re-read and verified.",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Preview changes"
      description="Nothing is written until you press Save. Every file is verified after it is written."
      width={860}
      icon={<CheckCircle2 size={14} />}
      footer={
        <>
          {errorCount ? (
            <span className="mr-auto flex items-center gap-1.5 text-label text-[var(--danger)]">
              <FileWarning size={12} />
              {errorCount} file{errorCount === 1 ? "" : "s"} cannot be written
            </span>
          ) : (
            <span className="mr-auto text-label text-[var(--text-faint)]">
              {rows.length} field change{rows.length === 1 ? "" : "s"} on {affectedFiles.length} file
              {affectedFiles.length === 1 ? "" : "s"}
            </span>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void onApply()} disabled={!rows.length}>
            <Save size={12} /> Save {affectedFiles.length} file{affectedFiles.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="px-4 py-2.5">
        <label className="flex items-start gap-2 text-body text-[var(--text-dim)]">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-[3px] h-[12px] w-[12px] accent-[var(--accent)]"
          />
          <span>
            I have reviewed every change below. {errorCount ? `${errorCount} file(s) will be skipped.` : ""}
            <button
              type="button"
              disabled={busy}
              onClick={() => void verifyAll()}
              className="ml-1 text-[var(--accent)] hover:underline disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Re-verify files now"}
            </button>
          </span>
        </label>
      </div>

      {limitHit ? (
        <div className="mx-4 mb-2 rounded-[4px] border border-[color-mix(in_oklab,var(--warn)_35%,transparent)] px-2 py-1 text-label text-[var(--warn)]">
          Showing the first 4,000 changes. Saving still applies all of them.
        </div>
      ) : null}

      <div className="border-t border-[var(--line)]">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-3 border-b border-[var(--line)] bg-[var(--panel-2)] px-4 py-1.5 text-micro font-semibold uppercase tracking-[0.07em] text-[var(--text-faint)]">
          <span>File / Field</span>
          <span>Change</span>
          <span className="w-[128px] text-right">Status</span>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-body text-[var(--text-faint)]">
            No pending changes. Edit something in the table or the batch editor first.
          </p>
        ) : (
          rows.map((row, i) => {
            const fileErrors = issues.get(row.fileId);
            return (
              <div
                key={`${row.fileId}-${row.field}-${i}`}
                className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 border-b border-[color-mix(in_oklab,var(--line)_45%,transparent)] px-4 py-1"
              >
                <div className="min-w-0">
                  <p className="mono truncate text-label text-[var(--text-dim)]" title={row.fileName}>
                    {row.fileName}
                  </p>
                  <p className="text-label text-[var(--text-faint)]">{row.field}</p>
                </div>
                <div className="flex min-w-0 items-center gap-2 text-label">
                  <span className="mono truncate text-[var(--text-faint)]" title={row.before}>
                    {row.before || <em>empty</em>}
                  </span>
                  <ArrowRight size={10} className="shrink-0 text-[var(--text-faint)]" />
                  <span className="mono truncate text-[var(--accent)]" title={row.after}>
                    {row.after || <em>empty</em>}
                  </span>
                </div>
                <div className="flex w-[128px] justify-end">
                  {fileErrors ? (
                    <Badge tone="danger" title={fileErrors.join(" ")}>
                      skipped
                    </Badge>
                  ) : (
                    <Badge tone="ok">ready</Badge>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <FileList sizes={sizes} problems={issues} files={affectedFiles.map((id) => files.get(id))} />
    </Dialog>
  );
}

function FileList({
  sizes,
  problems,
  files,
}: {
  sizes: Map<string, { before: number; after: number }>;
  problems: Map<string, string[]>;
  files: Array<LibraryFile | undefined>;
}) {
  return (
    <div className="border-t border-[var(--line)] px-4 py-2.5">
      <h4 className="label-xs mb-1.5">Files to be written</h4>
      <ul className="max-h-[140px] space-y-0.5 overflow-auto">
        {files.map((file) => {
          if (!file) return null;
          const size = sizes.get(file.id);
          const errors = problems.get(file.id);
          return (
            <li key={file.id} className="flex items-center gap-2 text-label">
              <span className={cn("h-[5px] w-[5px] shrink-0 rounded-full", errors ? "bg-[var(--danger)]" : "bg-[var(--ok)]")} />
              <span className="mono flex-1 truncate text-[var(--text-dim)]" title={file.name}>
                {file.folder ? `${file.folder}/` : ""}{file.name}
              </span>
              <span className="mono shrink-0 text-label text-[var(--text-faint)]">
                {file.format.toUpperCase()} · {formatBytes(size?.before ?? file.size)}
                {file.writable ? "" : " · export"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(" & ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}