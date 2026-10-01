import * as React from "react";
import { Gauge, TriangleAlert } from "lucide-react";
import { useStore, useSelectedFiles } from "../lib/store";
import { Badge, Button, Dialog, Segmented } from "./ui/primitives";
import { validateFile, type ValidationIssue } from "../lib/analysis/validation";
import { isLossless, type AudioProperties } from "../lib/metadata/types";

const SEVERITY_TONE: Record<string, "danger" | "warn" | "neutral"> = {
  error: "danger",
  warning: "warn",
  info: "neutral",
};

export function AnalyzerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const selected = useSelectedFiles();
  const visibleIds = useStore((s) => s.visibleIds);
  const files = useStore((s) => s.files);
  const select = useStore((s) => s.select);
  const applyEdits = useStore((s) => s.applyEdits);
  const [scope, setScope] = React.useState<"selection" | "library">("library");

  const targetIds = scope === "selection" && selected.length ? selected.map((f) => f.id) : visibleIds;
  const rows = React.useMemo(() => {
    const out: Array<{ id: string; name: string; audio: AudioProperties; format: string; size: number; issues: ValidationIssue[] }> = [];
    for (const id of targetIds) {
      const file = files.get(id);
      if (!file) continue;
      out.push({
        id,
        name: file.name,
        audio: file.audio,
        format: file.format,
        size: file.size,
        issues: validateFile(file),
      });
    }
    return out;
  }, [targetIds, files]);

  const stats = React.useMemo(() => {
    const withIssues = rows.filter((r) => r.issues.some((i) => i.severity !== "info"));
    const totalBytes = rows.reduce((n, r) => n + r.size, 0);
    const lossless = rows.filter((r) => isLossless(r.format as never)).length;
    const noArtwork = rows.filter((r) => !files.get(r.id)?.metadata.artwork?.length).length;
    const noTitle = rows.filter((r) => !files.get(r.id)?.metadata.title).length;
    const lowBitrate = rows.filter((r) => r.audio.bitrate !== undefined && r.audio.bitrate < 128).length;
    const issues = new Map<string, number>();
    for (const row of rows) {
      for (const issue of row.issues) {
        if (issue.severity === "info") continue;
        issues.set(issue.message, (issues.get(issue.message) ?? 0) + 1);
      }
    }
    return {
      totalBytes,
      lossless,
      noArtwork,
      noTitle,
      lowBitrate,
      withIssues: withIssues.length,
      issues: [...issues.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [rows, files]);

  const applyFix = (issue: ValidationIssue) => {
    const fix = issue.fix;
    if (!fix) return;
    if (fix.kind === "delete-artwork") {
      applyEdits([{ fileId: issue.fileId, changes: { artwork: [] }, cleared: ["artwork"] }], `Remove artwork: ${issue.fileName}`);
      return;
    }
    if (fix.kind === "clear" && fix.field) {
      applyEdits([{ fileId: issue.fileId, changes: {}, cleared: [fix.field] }], `${fix.label}: ${issue.fileName}`);
      return;
    }
    if (fix.kind === "set" && fix.field) {
      const numeric = ["year", "trackNumber", "trackTotal", "discNumber", "discTotal", "bpm"];
      const value = numeric.includes(fix.field) ? Number(fix.value) : (fix.value ?? "");
      applyEdits(
        [{ fileId: issue.fileId, changes: { [fix.field]: value } }],
        `${fix.label}: ${issue.fileName}`,
      );
    }
  };

  /** Drop the fields that carry no information from the whole selection. */
  const clearEmptyFields = () => {
    const edits: Array<{ fileId: string; changes: Record<string, unknown>; cleared: string[] }> = [];
    for (const id of targetIds) {
      const file = files.get(id);
      if (!file) continue;
      const cleared: string[] = [];
      for (const field of ["title", "album", "comment", "isrc", "barcode", "catalogNumber"] as const) {
        const value = file.metadata[field];
        if (typeof value === "string" && value.trim() === "") cleared.push(field);
      }
      if (cleared.length) edits.push({ fileId: id, changes: {}, cleared });
    }
    if (!edits.length) return;
    applyEdits(edits, `Clear ${edits.length} empty field(s)`);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Audio analyzer"
      description="Technical properties and consistency checks across the library."
      width={780}
      icon={<Gauge size={15} />}
      footer={
        <>
          <div className="mr-auto flex items-center gap-2">
            <Segmented
              options={[
                { value: "library" as const, label: "Library" },
                { value: "selection" as const, label: `Selection (${selected.length})` },
              ]}
              value={scope}
              onChange={setScope}
            />
          </div>
          <Button onClick={clearEmptyFields} disabled={!rows.length}>
            Clear empty fields
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="divide-y divide-[var(--line)]">
        <section className="grid grid-cols-4 gap-px bg-[var(--line)]">
          <Stat label="Files" value={rows.length} />
          <Stat label="Lossless" value={stats.lossless} />
          <Stat label="Missing artwork" value={stats.noArtwork} tone={stats.noArtwork ? "warn" : undefined} />
          <Stat label="With issues" value={stats.withIssues} tone={stats.withIssues ? "danger" : undefined} />
          <Stat label="Missing title" value={stats.noTitle} />
          <Stat label="Below 128 kbps" value={stats.lowBitrate} />
          <Stat label="Total size" value={stats.totalBytes} format="bytes" />
          <Stat label="Issues found" value={rows.reduce((n, r) => n + r.issues.length, 0)} />
        </section>

        {stats.issues.length ? (
          <section className="px-4 py-3">
            <h3 className="label-xs mb-2">Most common problems</h3>
            <div className="flex flex-wrap gap-1.5">
              {stats.issues.slice(0, 14).map(([message, count]) => (
                <span
                  key={message}
                  className="flex items-center gap-1.5 rounded-[3px] border border-[var(--line-strong)] px-1.5 py-0.5 text-label text-[var(--text-dim)]"
                >
                  <TriangleAlert size={10} className="text-[var(--warn)]" />
                  {message}
                  <span className="tnum text-[var(--text-faint)]">{count}</span>
                </span>
              ))}
            </div>
          </section>
        ) : null}

        <section className="max-h-[42vh] overflow-auto">
          <table className="w-full text-body">
            <thead className="sticky top-0 bg-[var(--panel-2)] text-left">
              <tr>
                {["File", "Format", "Length", "Bitrate", "Sample rate", "Channels", "Depth", "Flags"].map((h) => (
                  <th
                    key={h}
                    className="border-b border-[var(--line)] px-2.5 py-1.5 font-medium text-[var(--text-faint)]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const problems = row.issues.filter((i) => i.severity !== "info");
                return (
                  <tr
                    key={row.id}
                    onClick={() => {
                      select([row.id], "replace");
                      onClose();
                    }}
                    className="row-hover cursor-pointer border-b border-[var(--line)]"
                  >
                    <td className="mono max-w-[280px] truncate px-2.5 py-1" title={row.name}>
                      {row.name}
                    </td>
                    <td className="mono px-2.5 py-1 uppercase text-[var(--text-dim)]">{row.format}</td>
                    <td className="tnum px-2.5 py-1 text-[var(--text-dim)]">
                      {row.audio.duration !== undefined ? `${Math.round(row.audio.duration)}s` : "—"}
                    </td>
                    <td className="tnum px-2.5 py-1 text-[var(--text-dim)]">
                      {row.audio.bitrate ? `${row.audio.bitrate}k` : "—"}
                    </td>
                    <td className="tnum px-2.5 py-1 text-[var(--text-dim)]">
                      {row.audio.sampleRate ? `${(row.audio.sampleRate / 1000).toFixed(1)}k` : "—"}
                    </td>
                    <td className="tnum px-2.5 py-1 text-[var(--text-dim)]">{row.audio.channels ?? "—"}</td>
                    <td className="tnum px-2.5 py-1 text-[var(--text-dim)]">
                      {row.audio.bitDepth ? `${row.audio.bitDepth}b` : "—"}
                    </td>
                    <td className="px-2.5 py-1">
                      <span className="flex flex-wrap items-center gap-1">
                        {isLossless(row.format as never) ? <Badge tone="ok">lossless</Badge> : null}
                        {problems.length ? (
                          <Badge
                            tone={SEVERITY_TONE[problems[0].severity]}
                            title={problems.map((p) => p.message).join("\n")}
                          >
                            {problems.length}
                          </Badge>
                        ) : (
                          <Badge tone="ok">ok</Badge>
                        )}
                        {problems.find((p) => p.fix) ? (
                          <button
                            type="button"
                            className="btn h-[18px] px-1 text-micro"
                            onClick={(e) => {
                              e.stopPropagation();
                              const fixable = problems.find((p) => p.fix);
                              if (fixable) applyFix(fixable);
                            }}
                          >
                            Fix
                          </button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  tone,
  format,
}: {
  label: string;
  value: number;
  tone?: "warn" | "danger";
  format?: "bytes";
}) {
  const display =
    format === "bytes"
      ? value > 1024 * 1024 * 1024
        ? `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
        : `${(value / 1024 / 1024).toFixed(1)} MB`
      : value.toLocaleString();
  return (
    <div className="bg-[var(--panel)] px-3 py-2">
      <p className="label-xs">{label}</p>
      <p
        className={
          tone === "danger"
            ? "tnum text-title font-semibold text-[var(--danger)]"
            : tone === "warn"
              ? "tnum text-title font-semibold text-[var(--warn)]"
              : "tnum text-title font-semibold"
        }
      >
        {display}
      </p>
    </div>
  );
}