import * as React from "react";
import { Check, Play, Wand2 } from "lucide-react";
import { useStore, useSelectedFiles } from "../lib/store";
import { Button, Checkbox, Dialog, Field, Segmented } from "./ui/primitives";
import { applyReplace } from "../lib/text/find-replace";
import { applyCleanupOps, CLEANUP_OPS, TEXT_FIELDS } from "../lib/text/cleanup";
import type { LibraryFile } from "../lib/library/types";
import type { MusicMetadata } from "../lib/metadata/types";

/**
 * A group is an ordered list of steps. Steps run in order over the current
 * selection and produce one combined edit per file, so the whole group is a
 * single undo step.
 */
interface Step {
  id: string;
  label: string;
  description: string;
  run: (file: LibraryFile, options: Record<string, string | number | boolean>) => Partial<MusicMetadata>;
}

const asText = (value: unknown): string =>
  Array.isArray(value) ? value.join(" & ") : value === undefined || value === null ? "" : String(value);

const STEPS: Step[] = [
  {
    id: "albumartist-from-artist",
    label: "Album artist = track artist",
    description: "Copies the first performer into the album artist field.",
    run: (file) => {
      const artist = file.metadata.artists?.[0] ?? file.metadata.artist;
      return artist ? { albumArtists: [artist], albumArtist: artist } : {};
    },
  },
  {
    id: "artist-from-albumartist",
    label: "Track artist = album artist",
    description: "Useful after a compilation pass where the album artist is authoritative.",
    run: (file) => {
      const value = file.metadata.albumArtists?.[0] ?? file.metadata.albumArtist;
      return value ? { artists: [value], artist: value } : {};
    },
  },
  {
    id: "year-from-date",
    label: "Year from release date",
    description: "Derives the year from the full date so year filters stay consistent.",
    run: (file) => {
      const date = file.metadata.date ?? "";
      const match = /^(\d{4})/.exec(date);
      return match ? { year: Number(match[1]) } : {};
    },
  },
  {
    id: "date-from-year",
    label: "Date from year",
    description: "Fills a January 1 date for files that only carry a year.",
    run: (file, options) => {
      const year = file.metadata.year;
      if (year === undefined || file.metadata.date) return {};
      const style = String(options.dateStyle ?? "year");
      const date =
        style === "full" ? `${year}-01-01` : style === "year-month" ? `${year}-01` : String(year);
      return { date };
    },
  },
  {
    id: "strip-featured",
    label: "Strip featured artists",
    description: "Removes trailing “feat.”, “ft.” and “ft” credits from the track artist.",
    run: (file) => {
      const current = file.metadata.artists ?? (file.metadata.artist ? [file.metadata.artist] : []);
      const trimmed = current
        .map((a) => a.replace(/\s*[([]?\s*(feat|ft|featuring|with)\.?\s.*$/i, "").trim())
        .filter(Boolean);
      return trimmed.length && trimmed.join("|") !== current.join("|")
        ? { artists: trimmed, artist: trimmed[0] }
        : {};
    },
  },
  {
    id: "split-artists",
    label: "Split multi-value artists",
    description: "Splits “A; B” or “A, B” inside a single artist string into real values.",
    run: (file) => {
      const raw = asText(file.metadata.artist);
      if (!raw.includes(";") && (raw.match(/,/g)?.length ?? 0) < 1) return {};
      const parts = raw
        .split(/\s*[;,]\s*/)
        .map((p) => p.trim())
        .filter(Boolean);
      return parts.length > 1 ? { artists: parts, artist: parts[0] } : {};
    },
  },
  {
    id: "track-number-from-filename",
    label: "Track number from filename",
    description: "Reads a leading 1–2 digit track number out of the filename.",
    run: (file) => {
      const m = /^(\d{1,2})[\s._-]/.exec(file.name);
      return m ? { trackNumber: Number(m[1]) } : {};
    },
  },
  {
    id: "compilation-flag",
    label: "Mark as compilation",
    description: "Sets the compilation flag on every selected file.",
    run: () => ({ compilation: true }),
  },
  {
    id: "clear-comment",
    label: "Clear comment",
    description: "Wipes the comment field — often used before a re-import.",
    run: () => ({ comment: "" }),
  },
  {
    id: "replace-text",
    label: "Find & replace across fields",
    description: "Replaces a literal substring in the selected text fields.",
    run: (file, options) => {
      const find = String(options.find ?? "");
      const replace = String(options.replace ?? "");
      const fields = String(options.fields ?? "artist,album,title")
        .split(",")
        .map((f) => f.trim())
        .filter((f) => (TEXT_FIELDS as readonly string[]).includes(f));
      if (!find || !fields.length) return {};
      const patch: Record<string, unknown> = {};
      for (const field of fields) {
        const before = asText(file.metadata[field as keyof MusicMetadata]);
        if (!before) continue;
        const result = applyReplace(before, find, replace);
        if ("error" in result) continue;
        if (result.value !== before) patch[field] = result.value;
      }
      return patch as Partial<MusicMetadata>;
    },
  },
  {
    id: "cleanup-text",
    label: "Text cleanup pass",
    description: "Trims, collapses whitespace and strips zero-width characters.",
    run: (file) => {
      const ops = CLEANUP_OPS.filter((op) => op.id === "trim" || op.id === "collapseSpaces" || op.id === "normalizeUnicode").map(
        (op) => ({ ...op, enabled: true, fields: [...TEXT_FIELDS] }),
      );
      const { metadata, changes } = applyCleanupOps(file.metadata, ops);
      if (!changes.length) return {};
      const patch: Record<string, unknown> = {};
      for (const change of changes) {
        if (typeof change.after === "string") patch[change.field] = change.after;
      }
      void metadata;
      return patch as Partial<MusicMetadata>;
    },
  },
];

const DEFAULT_ENABLED = new Set([
  "albumartist-from-artist",
  "year-from-date",
  "strip-featured",
  "track-number-from-filename",
]);

export function ActionsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const files = useSelectedFiles();
  const applyEdits = useStore((s) => s.applyEdits);
  const toast = useStore((s) => s.toast);

  const [enabled, setEnabled] = React.useState<Set<string>>(DEFAULT_ENABLED);
  const [dateStyle, setDateStyle] = React.useState<"year" | "year-month" | "full">("year");
  const [find, setFind] = React.useState("");
  const [replace, setReplace] = React.useState("");
  const [fields, setFields] = React.useState("artist,album,title");

  const activeSteps = STEPS.filter((s) => enabled.has(s.id));

  const plan = React.useMemo(() => {
    const options: Record<string, Record<string, string | number | boolean>> = {
      "date-from-year": { dateStyle },
      "replace-text": { find, replace, fields },
    };
    return files.map((file) => {
      const changes: Partial<MusicMetadata> = {};
      let touched = 0;
      for (const step of activeSteps) {
        const patch = step.run(file, options[step.id] ?? {});
        const keys = Object.keys(patch);
        if (!keys.length) continue;
        Object.assign(changes, patch);
        touched++;
      }
      return { file, changes, touched };
    });
  }, [files, activeSteps, dateStyle, find, replace, fields]);

  const affected = plan.filter((p) => Object.keys(p.changes).length > 0);

  const toggle = (id: string) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = () => {
    if (!affected.length) {
      toast({ kind: "info", message: "Nothing to do", detail: "No selected file changes under these steps." });
      return;
    }
    applyEdits(
      affected.map((p) => ({ fileId: p.file.id, changes: p.changes })),
      `Action group (${activeSteps.length} step${activeSteps.length === 1 ? "" : "s"})`,
    );
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Action groups"
      description="Chain repeatable transformations and apply them to the selection as one undo step."
      width={760}
      icon={<Wand2 size={15} />}
      footer={
        <>
          <span className="mr-auto text-label text-[var(--text-faint)]">
            {affected.length} of {files.length} selected file(s) would change
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={run} disabled={!activeSteps.length || !affected.length}>
            <Play size={12} /> Apply {activeSteps.length} step{activeSteps.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="divide-y divide-[var(--line)]">
        <section className="px-4 py-3">
          <h3 className="label-xs mb-2">Steps</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {STEPS.map((step) => (
              <label
                key={step.id}
                title={step.description}
                className="flex cursor-pointer items-start gap-2 rounded-[3px] px-1 py-1 hover:bg-[var(--raised)]"
              >
                <Checkbox checked={enabled.has(step.id)} onChange={() => toggle(step.id)} ariaLabel={step.label} />
                <span className="min-w-0">
                  <span className="block text-body leading-tight">{step.label}</span>
                  <span className="block text-label leading-tight text-[var(--text-faint)]">
                    {step.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4 px-4 py-3">
          <Field label="Date style for “Date from year”">
            <Segmented
              options={[
                { value: "year" as const, label: "1997" },
                { value: "year-month" as const, label: "1997-01" },
                { value: "full" as const, label: "1997-01-01" },
              ]}
              value={dateStyle}
              onChange={setDateStyle}
            />
          </Field>
          <Field label="Fields for find & replace" className="col-span-2">
            <input
              className="input h-[24px] mono"
              value={fields}
              onChange={(e) => setFields(e.target.value)}
              placeholder="artist,album,title"
            />
          </Field>
          <Field label="Find">
            <input className="input h-[24px]" value={find} onChange={(e) => setFind(e.target.value)} />
          </Field>
          <Field label="Replace with">
            <input className="input h-[24px]" value={replace} onChange={(e) => setReplace(e.target.value)} />
          </Field>
        </section>

        <section className="px-4 py-3">
          <h3 className="label-xs mb-2">Preview</h3>
          <div className="max-h-[260px] overflow-auto rounded-[3px] border border-[var(--line)]">
            <table className="w-full text-body">
              <thead className="sticky top-0 bg-[var(--panel-2)] text-left">
                <tr>
                  <th className="border-b border-[var(--line)] px-2 py-1 font-medium text-[var(--text-faint)]">File</th>
                  <th className="border-b border-[var(--line)] px-2 py-1 font-medium text-[var(--text-faint)]">Changes</th>
                </tr>
              </thead>
              <tbody>
                {affected.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-2 py-4 text-center text-[var(--text-faint)]">
                      No changes. Enable more steps or select more files.
                    </td>
                  </tr>
                ) : (
                  affected.slice(0, 300).map((row) => (
                    <tr key={row.file.id} className="row-hover border-b border-[var(--line)]">
                      <td className="mono max-w-[280px] truncate px-2 py-1 text-[var(--text-dim)]" title={row.file.name}>
                        {row.file.name}
                      </td>
                      <td className="px-2 py-1">
                        <span className="flex flex-wrap gap-1">
                          {Object.entries(row.changes).map(([field, value]) => (
                            <span
                              key={field}
                              className="rounded-[2px] border border-[var(--line-strong)] px-1 text-label text-[var(--text-dim)]"
                            >
                              {field}:{" "}
                              <span className="text-[var(--accent)]">
                                {Array.isArray(value) ? value.join(", ") : String(value ?? "")}
                              </span>
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {affected.length > 300 ? (
            <p className="mt-1.5 flex items-center gap-1 text-label text-[var(--text-faint)]">
              <Check size={11} /> Preview truncated to 300 rows; the full set will be applied.
            </p>
          ) : null}
        </section>
      </div>
    </Dialog>
  );
}
