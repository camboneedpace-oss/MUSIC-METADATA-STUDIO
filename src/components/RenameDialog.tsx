import * as React from "react";
import { AlertTriangle, ArrowRight, Sparkles } from "lucide-react";
import { useStore, useSelectedFiles } from "../lib/store";
import {
  PARSE_PATTERNS,
  RENAME_TEMPLATES,
  extensionOf,
  generateFilename,
  parseFilename,
  TOKEN_HELP,
  TOKENS,
  type Token,
} from "../lib/filename";
import { Button, Dialog, Field, Segmented, cn } from "./ui/primitives";
import type { RenamePlanItem } from "../lib/library/types";

export function RenameDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const files = useSelectedFiles();
  const queueRename = useStore((s) => s.queueRename);
  const updateSettings = useStore((s) => s.updateSettings);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);

  const [template, setTemplate] = React.useState(settings.renameTemplate);
  const [padding, setPadding] = React.useState(2);
  const [caseStyle, setCaseStyle] = React.useState<"keep" | "upper" | "lower" | "title">("keep");
  const [conflict, setConflict] = React.useState<"skip" | "rename" | "cancel">("rename");

  React.useEffect(() => {
    if (open) setTemplate(settings.renameTemplate);
  }, [open, settings.renameTemplate]);

  const plan = React.useMemo<RenamePlanItem[]>(() => {
    const taken = new Set<string>();
    const items: RenamePlanItem[] = [];
    for (const file of files) {
      const ext = extensionOf(file.name);
      const generated = generateFilename(template, file.metadata, file.name, {
        trackPadding: padding,
        caseStyle,
      });
      const folders = generated.segments.slice(0, -1).join("/");
      let base = generated.basename;
      let full = `${folders ? `${folders}/` : ""}${base}${ext ? `.${ext}` : ""}`;
      const key = full.toLowerCase();
      if (taken.has(key)) {
        if (conflict === "rename") {
          const dot = base.lastIndexOf(".");
          const stem = dot === -1 ? base : base.slice(0, dot);
          const suffix = dot === -1 ? "" : base.slice(dot);
          let n = 2;
          while (taken.has(`${folders ? `${folders}/` : ""}${stem} (${n})${suffix}${ext ? `.${ext}` : ""}`.toLowerCase())) {
            n++;
          }
          full = `${folders ? `${folders}/` : ""}${stem} (${n})${suffix}${ext ? `.${ext}` : ""}`;
          items.push({ fileId: file.id, from: file.name, to: full, collision: "renamed" });
          taken.add(full.toLowerCase());
          continue;
        }
        if (conflict === "skip") {
          items.push({ fileId: file.id, from: file.name, to: file.name, collision: "skipped" });
          continue;
        }
      }
      items.push({ fileId: file.id, from: file.name, to: full, collision: taken.has(key) ? "collision" : undefined });
      taken.add(full.toLowerCase());
    }
    return items;
  }, [files, template, padding, caseStyle, conflict]);

  const collisions = plan.filter((p) => p.collision === "collision").length;
  const renamed = plan.filter((p) => p.to !== p.from);
  const missingTokens = React.useMemo(() => {
    const set = new Set<Token>();
    for (const file of files) {
      for (const token of generateFilename(template, file.metadata, file.name, { trackPadding: padding }).missing) {
        set.add(token);
      }
    }
    return [...set];
  }, [files, template, padding]);

  const apply = () => {
    if (!renamed.length) {
      toast({ kind: "warning", message: "Nothing to rename" });
      return;
    }
    queueRename(renamed, `Rename ${renamed.length} file(s)`);
    void updateSettings({ renameTemplate: template });
    toast({
      kind: "success",
      message: `Staged ${renamed.length} rename(s)`,
      detail: "Preview and save to apply them to disk.",
    });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Rename files from metadata"
      description="Filenames are only staged here. Nothing moves until you save."
      width={860}
      icon={<Sparkles size={14} />}
      footer={
        <>
          <span className="mr-auto text-label text-[var(--text-faint)]">
            {renamed.length} of {plan.length} would change
            {collisions ? ` · ${collisions} collision${collisions === 1 ? "" : "s"}` : ""}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply} disabled={!renamed.length || collisions > 0}>
            Stage {renamed.length} rename{renamed.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 px-4 py-3">
        <Field label="Filename template" hint="Use / to create folders. A literal \ escapes the next character.">
          <div className="flex gap-1.5">
            <input
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="input mono h-[26px] flex-1"
              spellCheck={false}
            />
            <select
              value=""
              onChange={(e) => {
                const found = RENAME_TEMPLATES.find((t) => t.template === e.target.value);
                if (found) setTemplate(found.template);
              }}
              className="input h-[26px] w-[150px]"
              aria-label="Preset template"
            >
              <option value="">Preset…</option>
              {RENAME_TEMPLATES.map((t) => (
                <option key={t.template} value={t.template}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Field label="Track padding" className="w-[110px]">
            <input
              type="number"
              min={1}
              max={4}
              value={padding}
              onChange={(e) => setPadding(Math.max(1, Math.min(4, Number(e.target.value) || 1)))}
              className="input h-[24px] tnum"
            />
          </Field>
          <Field label="Letter case" className="w-[220px]">
            <Segmented
              options={[
                { value: "keep" as const, label: "Keep" },
                { value: "title" as const, label: "Title" },
                { value: "upper" as const, label: "UPPER" },
                { value: "lower" as const, label: "lower" },
              ]}
              value={caseStyle}
              onChange={setCaseStyle}
            />
          </Field>
          <Field label="On collision" className="w-[260px]">
            <Segmented
              options={[
                { value: "rename" as const, label: "Add (n)", title: "Append a counter to the second file" },
                { value: "skip" as const, label: "Skip" },
                { value: "cancel" as const, label: "Stop", title: "Abort if two files would collide" },
              ]}
              value={conflict}
              onChange={setConflict}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-1">
          {TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              title={TOKEN_HELP[token]}
              onClick={() => setTemplate((t) => `${t}%${token}%`)}
              className="mono rounded-[3px] border border-[var(--line)] bg-[var(--chassis)] px-1.5 py-px text-label text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              %{token}%
            </button>
          ))}
        </div>

        {missingTokens.length ? (
          <p className="flex items-center gap-1.5 text-label text-[var(--warn)]">
            <AlertTriangle size={11} />
            No value for {missingTokens.map((t) => `%${t}%`).join(", ")} in{" "}
            {missingTokens.length === 1 ? "this file" : "these files"}; those tokens collapse to nothing.
          </p>
        ) : null}
      </div>

      <div className="border-t border-[var(--line)]">
        <div className="grid grid-cols-2 gap-3 border-b border-[var(--line)] bg-[var(--panel-2)] px-4 py-1.5 text-micro font-semibold uppercase tracking-[0.07em] text-[var(--text-faint)]">
          <span>Current</span>
          <span>Proposed</span>
        </div>
        <div className="max-h-[300px] overflow-auto">
          {plan.slice(0, 500).map((item) => (
            <div
              key={item.fileId}
              className="grid grid-cols-2 items-center gap-3 border-b border-[color-mix(in_oklab,var(--line)_45%,transparent)] px-4 py-1"
            >
              <span className="mono truncate text-label text-[var(--text-faint)]" title={item.from}>
                {item.from}
              </span>
              <span
                className={cn(
                  "mono flex items-center gap-2 truncate text-label",
                  item.to === item.from
                    ? "text-[var(--text-faint)]"
                    : item.collision === "collision"
                      ? "text-[var(--danger)]"
                      : "text-[var(--accent)]",
                )}
                title={item.to}
              >
                <ArrowRight size={10} className="shrink-0" />
                <span className="truncate">{item.to}</span>
                {item.collision === "collision" ? (
                  <span className="shrink-0 text-micro">collision</span>
                ) : item.collision === "renamed" ? (
                  <span className="shrink-0 text-micro text-[var(--text-faint)]">renamed</span>
                ) : null}
              </span>
            </div>
          ))}
          {plan.length > 500 ? (
            <p className="px-4 py-2 text-label text-[var(--text-faint)]">
              Showing the first 500 of {plan.length} files.
            </p>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------- filename parser */

export function ParseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const files = useSelectedFiles();
  const applyEdits = useStore((s) => s.applyEdits);
  const updateSettings = useStore((s) => s.updateSettings);
  const settings = useStore((s) => s.settings);
  const toast = useStore((s) => s.toast);

  const [template, setTemplate] = React.useState(settings.parseTemplate);

  React.useEffect(() => {
    if (open) setTemplate(settings.parseTemplate);
  }, [open, settings.parseTemplate]);

  const NUMERIC_TOKENS = new Set<Token>(["track", "tracktotal", "disc", "disctotal", "year"]);

  const results = React.useMemo(
    () =>
      files.map((file) => {
        const parsed = parseFilename(file.name, template, { greedy: true });
        const changes: Record<string, unknown> = {};
        for (const [token, value] of Object.entries(parsed.values)) {
          const typed = token as Token;
          if (!typed) continue;
          if (NUMERIC_TOKENS.has(typed)) {
            const n = Number.parseInt(value, 10);
            if (!Number.isFinite(n)) continue;
            const field =
              typed === "track" ? "trackNumber"
              : typed === "tracktotal" ? "trackTotal"
              : typed === "disc" ? "discNumber"
              : typed === "disctotal" ? "discTotal"
              : "year";
            changes[field] = n;
          } else {
            const field =
              typed === "artist" ? "artists"
              : typed === "albumartist" ? "albumArtists"
              : typed === "genre" ? "genres"
              : typed;
            if (field in changes) continue;
            (changes as Record<string, unknown>)[field] =
              field === "artists" || field === "genres" || field === "albumArtists"
                ? [value]
                : value;
          }
        }
        return { file, changes, coverage: parsed.coverage, error: parsed.error };
      }),
    [files, template],
  );

  const matched = results.filter((r) => Object.keys(r.changes).length > 0);

  const apply = () => {
    applyEdits(
      matched.map((r) => ({ fileId: r.file.id, changes: r.changes as never })),
      `Parse filenames (${matched.length})`,
    );
    void updateSettings({ parseTemplate: template });
    toast({
      kind: "success",
      message: `Staged ${matched.length} filename parse${matched.length === 1 ? "" : "s"}`,
      detail: "Review the table before saving.",
    });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Generate tags from filenames"
      description="Match each filename against a pattern and stage the tags it implies."
      width={860}
      icon={<Sparkles size={14} />}
      footer={
        <>
          <span className="mr-auto text-label text-[var(--text-faint)]">
            {matched.length} of {results.length} filenames match
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply} disabled={!matched.length}>
            Stage {matched.length}
          </Button>
        </>
      }
    >
      <div className="space-y-3 px-4 py-3">
        <Field label="Pattern" hint="The same %token% syntax as the rename tool, read left to right.">
          <div className="flex gap-1.5">
            <input
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="input mono h-[26px] flex-1"
              spellCheck={false}
            />
            <select
              value=""
              onChange={(e) => {
                const found = PARSE_PATTERNS.find((t) => t.template === e.target.value);
                if (found) setTemplate(found.template);
              }}
              className="input h-[26px] w-[190px]"
              aria-label="Preset pattern"
            >
              <option value="">Preset…</option>
              {PARSE_PATTERNS.map((t) => (
                <option key={t.template} value={t.template}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </Field>
      </div>

      <div className="border-t border-[var(--line)]">
        <div className="grid grid-cols-[1.1fr_1fr_auto] gap-3 border-b border-[var(--line)] bg-[var(--panel-2)] px-4 py-1.5 text-micro font-semibold uppercase tracking-[0.07em] text-[var(--text-faint)]">
          <span>Filename</span>
          <span>Extracted</span>
          <span className="w-[70px] text-right">Match</span>
        </div>
        <div className="max-h-[320px] overflow-auto">
          {results.slice(0, 500).map((r) => (
            <div
              key={r.file.id}
              className="grid grid-cols-[1.1fr_1fr_auto] items-center gap-3 border-b border-[color-mix(in_oklab,var(--line)_45%,transparent)] px-4 py-1"
            >
              <span className="mono truncate text-label" title={r.file.name}>
                {r.file.name}
              </span>
              <span className="truncate text-label text-[var(--text-dim)]">
                {Object.keys(r.changes).length
                  ? Object.entries(r.changes)
                      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(" & ") : v}`)
                      .join("  ")
                  : r.error ?? "no match"}
              </span>
              <span
                className={cn(
                  "tnum w-[70px] text-right text-label",
                  r.coverage > 0.8 ? "text-[var(--ok)]" : r.coverage > 0.4 ? "text-[var(--warn)]" : "text-[var(--text-faint)]",
                )}
              >
                {Math.round(r.coverage * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}