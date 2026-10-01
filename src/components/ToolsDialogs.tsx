import * as React from "react";
import { ArrowRight, Brush, Copy, Eraser, Repeat, Search, Trash2, Wand2 } from "lucide-react";
import { useStore, useSelectedFiles } from "../lib/store";
import { CLEANUP_OPS, applyCleanupOps, type CleanupOp } from "../lib/text/cleanup";
import {
  previewReplace,
  SCOPE_LABELS,
  type ReplaceRule,
  type ReplaceScope,
} from "../lib/text/find-replace";
import { Button, Dialog, Field, Checkbox, Segmented, cn } from "./ui/primitives";
import type { MusicMetadata } from "../lib/metadata/types";

/* --------------------------------------------------------- metadata cleanup */

export function CleanupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const files = useSelectedFiles();
  const applyEdits = useStore((s) => s.applyEdits);
  const toast = useStore((s) => s.toast);
  const [ops, setOps] = React.useState<CleanupOp[]>(CLEANUP_OPS);

  const preview = React.useMemo(
    () =>
      files.slice(0, 300).map((file) => {
        const { metadata, changes } = applyCleanupOps(file.metadata, ops);
        return { file, metadata, changes };
      }),
    [files, ops],
  );

  const totalChanges = preview.reduce((n, p) => n + p.changes.length, 0);

  const apply = () => {
    const edits = preview
      .filter((p) => p.changes.length)
      .map((p) => ({ fileId: p.file.id, changes: p.metadata as Partial<MusicMetadata> }));
    applyEdits(edits, `Cleanup: ${ops.filter((o) => o.enabled).length} operations`);
    toast({
      kind: "success",
      message: `Staged cleanup on ${edits.length} file(s)`,
      detail: totalChanges > edits.length ? `${totalChanges} field changes in total.` : undefined,
    });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Metadata cleanup"
      description="Every operation is previewed below before anything is staged."
      width={920}
      icon={<Brush size={14} />}
      footer={
        <>
          <span className="mr-auto text-label text-[var(--text-faint)]">
            {totalChanges} field change{totalChanges === 1 ? "" : "s"} across {preview.filter((p) => p.changes.length).length} files
            {files.length > 300 ? " (first 300 shown)" : ""}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply} disabled={!totalChanges}>
            Stage cleanup
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(300px,360px)_1fr]">
        <div className="max-h-[520px] overflow-y-auto border-r border-[var(--line)] px-3 py-2.5">
          <div className="mb-2 flex gap-1.5">
            <Button size="sm" onClick={() => setOps(CLEANUP_OPS.map((o) => ({ ...o, enabled: true })))}>
              Enable all
            </Button>
            <Button size="sm" onClick={() => setOps(CLEANUP_OPS.map((o) => ({ ...o, enabled: false })))}>
              Disable all
            </Button>
            <Button size="sm" onClick={() => setOps(CLEANUP_OPS)}>
              Reset
            </Button>
          </div>
          <ul className="space-y-1">
            {ops.map((op, i) => (
              <li key={op.id} className="rounded-[3px] border border-[var(--line)] px-2 py-1.5">
                <Checkbox
                  checked={op.enabled}
                  onChange={(checked) =>
                    setOps((list) => list.map((o, j) => (j === i ? { ...o, enabled: checked } : o)))
                  }
                  label={<span className="text-body text-[var(--text)]">{op.label}</span>}
                />
                <p className="mt-0.5 pl-[21px] text-label leading-snug text-[var(--text-faint)]">
                  {op.description}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="max-h-[520px] overflow-auto">
          <div className="grid grid-cols-[1fr_1fr] gap-3 border-b border-[var(--line)] bg-[var(--panel-2)] px-3 py-1.5 text-micro font-semibold uppercase tracking-[0.07em] text-[var(--text-faint)]">
            <span>File / Field</span>
            <span>After cleanup</span>
          </div>
          {preview.length === 0 ? (
            <p className="px-3 py-8 text-center text-body text-[var(--text-faint)]">Select files to preview.</p>
          ) : (
            preview.map((row) =>
              row.changes.map((change, i) => (
                <div
                  key={`${row.file.id}-${change.field}-${i}`}
                  className="grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-[color-mix(in_oklab,var(--line)_45%,transparent)] px-3 py-1"
                >
                  <div className="min-w-0">
                    <p className="mono truncate text-label text-[var(--text-dim)]" title={row.file.name}>
                      {row.file.name}
                    </p>
                    <p className="text-micro text-[var(--text-faint)]">{change.field}</p>
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 text-label">
                    <span className="mono truncate text-[var(--text-faint)]">{show(change.before)}</span>
                    <ArrowRight size={9} className="shrink-0" />
                    <span className="mono truncate text-[var(--accent)]">{show(change.after)}</span>
                  </div>
                </div>
              )),
            )
          )}
          {totalChanges === 0 && preview.length ? (
            <p className="px-3 py-6 text-center text-body text-[var(--text-faint)]">
              No operation would change anything in this selection.
            </p>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

function show(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (Array.isArray(value)) return value.length ? value.join(" & ") : "(empty)";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 60);
  const s = String(value);
  return s === "" ? "(empty)" : s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

/* --------------------------------------------------------- find & replace */

const ALL_SCOPES: ReplaceScope[] = [
  "filename", "title", "artists", "album", "albumArtists", "genres", "comment", "customFields", "allText",
];

export function FindReplaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const files = useSelectedFiles();
  const applyEdits = useStore((s) => s.applyEdits);
  const toast = useStore((s) => s.toast);

  const [rule, setRule] = React.useState<ReplaceRule>({
    id: "rule-1",
    find: "",
    replace: "",
    scopes: ["title", "artists", "album", "genres"],
    options: { caseSensitive: false, regex: false, unicode: true },
    enabled: true,
  });

  const preview = React.useMemo(
    () =>
      files.slice(0, 300).map((file) => {
        const result = previewReplace(file.metadata, file.name, rule);
        return { file, result };
      }),
    [files, rule],
  );

  const totalHits = preview.reduce((n, p) => n + p.result.hits, 0);
  const error = preview.find((p) => p.result.error)?.result.error;

  const apply = () => {
    const edits = preview
      .filter((p) => p.result.changes.length)
      .map((p) => ({ fileId: p.file.id, changes: p.result.metadata as Partial<MusicMetadata> }));
    applyEdits(edits, `Find & replace “${rule.find}” → “${rule.replace}”`);
    toast({ kind: "success", message: `Staged replacements on ${edits.length} file(s)` });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Find & replace"
      description="Preview first. Regular expressions are supported and validated before use."
      width={900}
      icon={<Search size={14} />}
      footer={
        <>
          <span className="mr-auto text-label text-[var(--text-faint)]">
            {error ? <span className="text-[var(--danger)]">{error}</span> : `${totalHits} replacement(s) in ${preview.filter((p) => p.result.changes.length).length} files`}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply} disabled={!totalHits || Boolean(error)}>
            Stage replacements
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5 border-b border-[var(--line)] px-4 py-3">
        <Field label="Find">
          <input
            value={rule.find}
            onChange={(e) => setRule({ ...rule, find: e.target.value })}
            className={cn("input mono", error && "border-[var(--danger)]")}
            placeholder="feat."
            spellCheck={false}
          />
        </Field>
        <Field label="Replace with">
          <input
            value={rule.replace}
            onChange={(e) => setRule({ ...rule, replace: e.target.value })}
            className="input mono"
            placeholder="feat"
            spellCheck={false}
          />
        </Field>

        <div className="col-span-2 flex flex-wrap items-center gap-3">
          <Field label="Scope" className="flex-1">
            <div className="flex flex-wrap gap-1.5">
              {ALL_SCOPES.map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() =>
                    setRule((r) => ({
                      ...r,
                      scopes: r.scopes.includes(scope)
                        ? r.scopes.filter((s) => s !== scope)
                        : [...r.scopes, scope],
                    }))
                  }
                  data-active={rule.scopes.includes(scope)}
                  className="btn h-[22px] border border-[var(--line-strong)] text-label data-[active=true]:border-[var(--accent)] data-[active=true]:bg-[var(--accent-soft)] data-[active=true]:text-[var(--accent)]"
                >
                  {SCOPE_LABELS[scope]}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="col-span-2 flex flex-wrap gap-4">
          <Checkbox
            checked={Boolean(rule.options.caseSensitive)}
            onChange={(v) => setRule({ ...rule, options: { ...rule.options, caseSensitive: v } })}
            label="Case sensitive"
          />
          <Checkbox
            checked={Boolean(rule.options.regex)}
            onChange={(v) => setRule({ ...rule, options: { ...rule.options, regex: v } })}
            label="Regular expression"
          />
          <Checkbox
            checked={Boolean(rule.options.unicode)}
            onChange={(v) => setRule({ ...rule, options: { ...rule.options, unicode: v } })}
            label="Unicode aware"
          />
          <Checkbox
            checked={Boolean(rule.options.wholeField)}
            onChange={(v) => setRule({ ...rule, options: { ...rule.options, wholeField: v } })}
            label="Whole field only"
          />
        </div>
      </div>

      <div className="grid grid-cols-[220px_1fr_1fr] gap-3 border-b border-[var(--line)] bg-[var(--panel-2)] px-4 py-1.5 text-micro font-semibold uppercase tracking-[0.07em] text-[var(--text-faint)]">
        <span>File / Field</span>
        <span>Before</span>
        <span>After</span>
      </div>
      <div className="max-h-[280px] overflow-auto">
        {preview.flatMap((row) =>
          row.result.changes.map((change, i) => (
            <div
              key={`${row.file.id}-${change.field}-${i}`}
              className="grid grid-cols-[220px_1fr_1fr] items-center gap-3 border-b border-[color-mix(in_oklab,var(--line)_45%,transparent)] px-4 py-1"
            >
              <div className="min-w-0">
                <p className="mono truncate text-label" title={row.file.name}>{row.file.name}</p>
                <p className="text-micro text-[var(--text-faint)]">{change.field}</p>
              </div>
              <span className="mono truncate text-label text-[var(--text-faint)]">{change.before}</span>
              <span className="mono truncate text-label text-[var(--accent)]">{change.after}</span>
            </div>
          )),
        )}
      </div>
    </Dialog>
  );
}

/* --------------------------------------------------------- converter view */

export function ConverterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const files = useSelectedFiles();
  const toast = useStore((s) => s.toast);
  const [pick, setPick] = React.useState("TPE1");
  const [map, setMap] = React.useState<Record<string, string>>({
    TPE1: "Artist",
    TPE2: "Album Artist",
    TALB: "Album",
    TIT2: "Title",
    TRCK: "Track",
    TDRC: "Year",
  });

  const applied = React.useMemo(() => {
    const byTarget = new Map<string, string[]>();
    for (const [source, target] of Object.entries(map)) {
      byTarget.set(target, [...(byTarget.get(target) ?? []), source]);
    }
    return byTarget;
  }, [map]);

  const previews = React.useMemo(
    () =>
      files.slice(0, 20).map((file) => {
        const rows: Array<{ target: string; sources: string[]; value: string }> = [];
        for (const [target, sources] of applied) {
          const value = sources
            .map((s) => file.raw.find((tag) => tag.key === s)?.values.join(" & ") ?? "")
            .filter(Boolean)
            .join(" / ");
          if (value) rows.push({ target, sources, value });
        }
        return { file, rows };
      }),
    [files, applied],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Tag mapping"
      description="Maps native frame names onto unified fields. Used when importing or exporting between formats."
      width={820}
      icon={<Repeat size={14} />}
      footer={
        <>
          <span className="mr-auto text-label text-[var(--text-faint)]">
            {applied.size} target field(s) mapped from {Object.keys(map).length} frame(s)
          </span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_1fr]">
        <div className="border-r border-[var(--line)] px-4 py-3">
          <h4 className="label-xs mb-2">Add a mapping</h4>
          <div className="flex gap-1.5">
            <input
              value={pick}
              onChange={(e) => setPick(e.target.value.toUpperCase())}
              className="input mono w-[110px]"
              placeholder="Source"
            />
            <input
              value={map[pick] ?? ""}
              onChange={(e) => setMap({ ...map, [pick]: e.target.value })}
              className="input flex-1"
              placeholder="Target field"
            />
            <Button
              size="sm"
              onClick={() => {
                if (map[pick]) toast({ kind: "info", message: `${pick} is already mapped` });
              }}
            >
              Add
            </Button>
          </div>
          <ul className="mt-3 space-y-1">
            {Object.entries(map).map(([source, target]) => (
              <li key={source} className="flex items-center gap-2 text-body">
                <span className="mono w-[110px] shrink-0 truncate text-[var(--accent)]">{source}</span>
                <ArrowRight size={10} className="text-[var(--text-faint)]" />
                <span className="flex-1 truncate">{target}</span>
                <button
                  type="button"
                  aria-label={`Remove ${source}`}
                  onClick={() => {
                    const next = { ...map };
                    delete next[source];
                    setMap(next);
                  }}
                  className="btn h-[20px] w-[20px] justify-center p-0"
                >
                  <Trash2 size={10} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="max-h-[460px] overflow-auto px-4 py-3">
          <h4 className="label-xs mb-2">Preview on selection</h4>
          {previews.length === 0 ? (
            <p className="text-body text-[var(--text-faint)]">Select files to preview the mapping.</p>
          ) : (
            previews.map((p) => (
              <div key={p.file.id} className="mb-2">
                <p className="mono truncate text-label text-[var(--text-faint)]">{p.file.name}</p>
                {p.rows.length === 0 ? (
                  <p className="text-label text-[var(--text-faint)]">no mapped frames present</p>
                ) : (
                  p.rows.map((row) => (
                    <div key={row.target} className="flex items-baseline gap-2 text-label">
                      <span className="mono w-[92px] shrink-0 truncate text-[var(--accent)]">{row.target}</span>
                      <span className="truncate text-[var(--text-dim)]" title={row.value}>
                        {row.value}
                      </span>
                    </div>
                  ))
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}

export { Eraser, Wand2, Copy, Segmented };