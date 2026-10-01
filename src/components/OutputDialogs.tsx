import * as React from "react";
import { Copy, Download, FileDown, ListMusic, Trash2 } from "lucide-react";
import { useStore, useSelectedFiles } from "../lib/store";
import { bestMember, findDuplicates } from "../lib/analysis/duplicates";
import {
  BUILTIN_TEMPLATES,
  DEFAULT_EXPORT_OPTIONS,
  downloadText,
  EXPORT_FORMATS,
  MIME_BY_FORMAT,
  runExport,
  toCsv,
  type ExportTemplate,
} from "../lib/exports";
import {
  buildPlaylist,
  DEFAULT_PLAYLIST_OPTIONS,
  PLAYLIST_FORMATS,
  trackPath,
  type PlaylistFormat,
  type SmartPlaylist,
  type SmartPlaylistRule,
} from "../lib/playlists";
import { downloadFile } from "../lib/filesystem";
import { Button, Dialog, Field, Segmented, Badge } from "./ui/primitives";
import { formatBytes, formatDuration } from "../lib/metadata/types";

/* ------------------------------------------------------------- duplicates */

export function DuplicatesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const files = useSelectedFiles();
  const toast = useStore((s) => s.toast);

  const groups = React.useMemo(() => findDuplicates(files), [files]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Duplicate finder"
      description="Exact = byte-identical. Audio = matching fingerprint. Metadata = same artist, album, track and length."
      width={900}
      icon={<Copy size={14} />}
      footer={
        <>
          <span className="mr-auto text-label text-[var(--text-faint)]">
            {groups.length} group{groups.length === 1 ? "" : "s"} ·{" "}
            {formatBytes(groups.reduce((n, g) => n + g.reclaimable, 0))} reclaimable
          </span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {groups.length === 0 ? (
        <p className="py-12 text-center text-body text-[var(--text-faint)]">
          No duplicates found in the current selection.
        </p>
      ) : (
        <div className="space-y-2 p-3">
          {groups.map((group) => {
            const members = group.members
              .map((id) => files.find((f) => f.id === id))
              .filter(Boolean);
            const keeper = bestMember(members as NonNullable<(typeof members)[number]>[]);
            return (
              <div key={group.id} className="panel rounded-[5px]">
                <header className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-1.5">
                  <Badge tone={group.kind === "exact" ? "danger" : group.kind === "fingerprint" ? "ok" : "warn"}>
                    {group.kind === "exact" ? "exact" : group.kind === "fingerprint" ? "audio" : "metadata"}
                  </Badge>
                  <span className="text-body">{group.entries.length} copies</span>
                  <span className="text-label text-[var(--text-faint)]">
                    {formatBytes(group.totalBytes)} total · {formatBytes(group.reclaimable)} reclaimable
                  </span>
                  <div className="flex-1" />
                  <span className="mono text-label text-[var(--text-faint)]" title={group.key}>
                    {group.key}
                  </span>
                </header>
                <table className="w-full text-label">
                  <thead className="text-micro uppercase tracking-[0.06em] text-[var(--text-faint)]">
                    <tr>
                      <th className="px-3 py-1 text-left font-medium">File</th>
                      <th className="px-2 py-1 text-left font-medium">Quality</th>
                      <th className="px-2 py-1 text-right font-medium">Size</th>
                      <th className="px-2 py-1 text-right font-medium">Length</th>
                      <th className="px-3 py-1 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.entries.map((entry) => {
                      const isKeeper = entry.fileId === keeper?.id;
                      return (
                        <tr key={entry.fileId} className="border-t border-[color-mix(in_oklab,var(--line)_45%,transparent)]">
                          <td className="mono max-w-[320px] truncate px-3 py-1" title={`${entry.folder}/${entry.name}`}>
                            {isKeeper ? <span className="mr-1 text-[var(--ok)]">●</span> : null}
                            {entry.name}
                          </td>
                          <td className="px-2 py-1">
                            <span className="text-[var(--text-dim)]">
                              {entry.format.toUpperCase()} · {entry.lossless ? "lossless" : `${Math.round((entry.bitrate ?? 0) / 1000)}k`}
                            </span>
                          </td>
                          <td className="tnum px-2 py-1 text-right">{formatBytes(entry.size)}</td>
                          <td className="tnum px-2 py-1 text-right">{formatDuration(entry.duration)}</td>
                          <td className="px-3 py-1 text-right">
                            {isKeeper ? (
                              <Badge tone="ok">keep</Badge>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => toast({ kind: "warning", message: "Deleting is deliberately manual", detail: entry.name })}
                              >
                                <Trash2 size={10} /> Delete
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}

/* -------------------------------------------------------------- playlists */

export function PlaylistDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const files = useSelectedFiles();
  const toast = useStore((s) => s.toast);
  const [format, setFormat] = React.useState<PlaylistFormat>(DEFAULT_PLAYLIST_OPTIONS.format);
  const [paths, setPaths] = React.useState<"relative" | "absolute">("absolute");
  const [extended, setExtended] = React.useState(true);
  const [name, setName] = React.useState("playlist");
  const [smart, setSmart] = React.useState(false);
  const [rules, setRules] = React.useState<SmartPlaylistRule[]>([
    { field: "genre", op: "=", value: "Electronic" },
  ]);

  const content = React.useMemo(
    () => buildPlaylist(files, { format, paths, extended }),
    [files, format, paths, extended],
  );

  const totalDuration = files.reduce((n, f) => n + (f.audio.duration ?? 0), 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Playlist builder"
      description="Write an M3U, PLS or XSPF file. Paths can be relative so the playlist travels with the music."
      width={820}
      icon={<ListMusic size={14} />}
      footer={
        <>
          <span className="mr-auto text-label text-[var(--text-faint)]">
            {files.length} tracks · {formatDuration(totalDuration)}
          </span>
          <Button
            onClick={() => {
              const playlist: SmartPlaylist = { id: "now", name, mode: "all", rules, format, paths };
              void playlist;
              downloadText(`${name}${playlistExtension(format)}`, content, "text/plain;charset=utf-8");
              toast({ kind: "success", message: `Wrote ${name}${playlistExtension(format)}` });
            }}
            disabled={!files.length}
            variant="primary"
          >
            <Download size={12} /> Download playlist
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-3 border-b border-[var(--line)] px-4 py-2.5">
        <Field label="Playlist name" className="w-[200px]">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </Field>
        <Field label="Format" className="w-[300px]">
          <Segmented
            options={PLAYLIST_FORMATS.map((f) => ({ value: f.id, label: f.label }))}
            value={format}
            onChange={setFormat}
          />
        </Field>
        <Field label="Paths" className="w-[200px]">
          <Segmented
            options={[
              { value: "absolute" as const, label: "Absolute" },
              { value: "relative" as const, label: "Relative" },
            ]}
            value={paths}
            onChange={setPaths}
          />
        </Field>
        <label className="flex items-center gap-1.5 pb-1 text-label text-[var(--text-dim)]">
          <input type="checkbox" checked={extended} onChange={(e) => setExtended(e.target.checked)} className="accent-[var(--accent)]" />
          Extended headers
        </label>
      </div>

      {smart ? (
        <div className="border-b border-[var(--line)] px-4 py-2.5">
          <p className="label-xs mb-1.5">Smart rules — re-evaluated every time the library changes</p>
          {rules.map((rule, i) => (
            <div key={i} className="mb-1 flex items-center gap-1.5">
              <select
                value={rule.field}
                onChange={(e) =>
                  setRules((list) => list.map((r, j) => (j === i ? { ...r, field: e.target.value } : r)))
                }
                className="input h-[22px] w-[140px]"
              >
                {["genre", "artist", "albumartist", "album", "format", "year", "bitrate", "samplerate", "lossless", "hasartwork", "folder"].map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <select
                value={rule.op}
                onChange={(e) =>
                  setRules((list) => list.map((r, j) => (j === i ? { ...r, op: e.target.value as SmartPlaylistRule["op"] } : r)))
                }
                className="input h-[22px] w-[72px]"
              >
                {["=", "!=", ">", ">=", "<", "<="].map((op) => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>
              <input
                value={String(rule.value)}
                onChange={(e) =>
                  setRules((list) => list.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
                }
                className="input h-[22px] flex-1"
              />
              <button
                type="button"
                aria-label="Remove rule"
                onClick={() => setRules((list) => list.filter((_, j) => j !== i))}
                className="btn h-[22px] w-[22px] justify-center p-0"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          <Button size="sm" onClick={() => setRules((list) => [...list, { field: "genre", op: "=", value: "" }])}>
            Add rule
          </Button>
        </div>
      ) : null}

      <div className="max-h-[300px] overflow-auto px-4 py-2.5">
        <div className="mb-1 flex items-center justify-between">
          <h4 className="label-xs">Contents</h4>
          <button
            type="button"
            onClick={() => setSmart((v) => !v)}
            className="btn h-[20px] text-label"
          >
            {smart ? "Hide smart rules" : "Build from rules"}
          </button>
        </div>
        <pre className="mono max-h-[260px] overflow-auto rounded-[3px] border border-[var(--line)] bg-[var(--chassis)] p-2 text-label leading-relaxed">
          {content || "(empty playlist)"}
        </pre>
        <p className="mt-1 text-label text-[var(--text-faint)]">
          First path: {files[0] ? trackPath(files[0], { format, paths, extended }) : "—"}
        </p>
      </div>
    </Dialog>
  );
}

function playlistExtension(format: PlaylistFormat): string {
  return PLAYLIST_FORMATS.find((f) => f.id === format)?.extension ?? ".m3u";
}

/* ---------------------------------------------------------------- export */

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const files = useSelectedFiles();
  const visibleCount = useStore((s) => s.visibleIds.length);
  const toast = useStore((s) => s.toast);

  const [templates, setTemplates] = React.useState<ExportTemplate[]>(BUILTIN_TEMPLATES);
  const [activeId, setActiveId] = React.useState(BUILTIN_TEMPLATES[0].id);
  const [scope, setScope] = React.useState<"selection" | "filtered">(
    files.length ? "selection" : "filtered",
  );
  const [includeTechnical, setIncludeTechnical] = React.useState(true);
  const [preview, setPreview] = React.useState("");

  const active = templates.find((t) => t.id === activeId) ?? templates[0];
  const subject = scope === "selection" ? files : useStore.getState().visibleIds
    .map((id) => useStore.getState().files.get(id))
    .filter(Boolean);

  const generate = React.useMemo(() => {
    if (!active) return "";
    const list = subject as NonNullable<(typeof subject)[number]>[];
    return runExport(list, active, { ...DEFAULT_EXPORT_OPTIONS, scope, includeTechnical });
  }, [active, subject, scope, includeTechnical]);

  React.useEffect(() => {
    setPreview(generate.length > 200_000 ? `${generate.slice(0, 200_000)}\n… (truncated for preview)` : generate);
  }, [generate]);

  const doExport = () => {
    if (!active) return;
    const list = subject as NonNullable<(typeof subject)[number]>[];
    const content = runExport(list, active, { ...DEFAULT_EXPORT_OPTIONS, scope, includeTechnical });
    const base = `music-metadata-${new Date().toISOString().slice(0, 10)}`;
    downloadText(`${base}${extensionFor(active.format)}`, content, MIME_BY_FORMAT[active.format]);
    toast({
      kind: "success",
      message: `Exported ${list.length} file(s) as ${active.format.toUpperCase()}`,
      detail: `${formatBytes(new Blob([content]).size)}`,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Export Studio"
      description="Templates drive CSV, JSON, XML, HTML, Markdown, RTF and text from one engine."
      width={900}
      icon={<FileDown size={14} />}
      footer={
        <>
          <span className="mr-auto text-label text-[var(--text-faint)]">
            {(subject as unknown[]).length} file(s) · {formatBytes(new Blob([preview]).size)} preview
          </span>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={doExport} disabled={!active || !(subject as unknown[]).length}>
            <Download size={12} /> Export {active?.format.toUpperCase()}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-3 border-b border-[var(--line)] px-4 py-2.5">
        <Field label="Template" className="w-[230px]">
          <select
            value={activeId}
            onChange={(e) => {
              setActiveId(e.target.value);
              const found = templates.find((t) => t.id === e.target.value);
              if (found) setActiveId(found.id);
            }}
            className="input h-[24px]"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Scope" className="w-[220px]">
          <Segmented
            options={[
              { value: "selection" as const, label: `Selection (${files.length})` },
              { value: "filtered" as const, label: `Filtered (${visibleCount})` },
            ]}
            value={scope}
            onChange={setScope}
          />
        </Field>
        <label className="flex items-center gap-1.5 pb-1 text-label text-[var(--text-dim)]">
          <input
            type="checkbox"
            checked={includeTechnical}
            onChange={(e) => setIncludeTechnical(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          Include technical columns
        </label>
        <Button
          size="sm"
          onClick={() => {
            const csv = toCsv(subject as NonNullable<(typeof subject)[number]>[], {
              ...DEFAULT_EXPORT_OPTIONS,
              includeTechnical,
            });
            downloadText("metadata.csv", csv, "text/csv;charset=utf-8");
          }}
        >
          Quick CSV
        </Button>
        <Button size="sm" onClick={() => void downloadFile("metadata.json", new TextEncoder().encode(generate))}>
          Save raw
        </Button>
      </div>

      <div className="grid grid-cols-[1fr_1fr]">
        <div className="border-r border-[var(--line)] px-4 py-2.5">
          <h4 className="label-xs mb-1.5">Template</h4>
          <textarea
            value={active?.template ?? ""}
            onChange={(e) =>
              setTemplates((list) =>
                list.map((t) => (t.id === activeId ? { ...t, template: e.target.value, builtIn: false } : t)),
              )
            }
            className="mono h-[300px] w-full resize-none rounded-[3px] border border-[var(--line)] bg-[var(--chassis)] p-2 text-label leading-relaxed outline-none focus:border-[var(--accent)]"
            spellCheck={false}
          />
          <p className="mt-1 text-label text-[var(--text-faint)]">
            <code>{"{{field}}"}</code> value · <code>{"{{#tracks}}…{{/tracks}}"}</code> repeat ·{" "}
            <code>{"{{^field}}…{{/field}}"}</code> when empty
          </p>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => {
              const id = `tpl-${Date.now().toString(36)}`;
              setTemplates((list) => [
                ...list,
                { id, name: `Custom ${list.length}`, format: active?.format ?? "csv", template: active?.template ?? "" },
              ]);
              setActiveId(id);
            }}
          >
            Save as new template
          </Button>
        </div>

        <div className="px-4 py-2.5">
          <div className="mb-1.5 flex items-center gap-1.5">
            <h4 className="label-xs">Preview</h4>
            <div className="flex-1" />
            {EXPORT_FORMATS.map((f) => (
              <Badge key={f.id} tone={active?.format === f.id ? "accent" : "neutral"}>
                {f.label}
              </Badge>
            ))}
          </div>
          <pre className="mono h-[340px] w-full overflow-auto whitespace-pre-wrap rounded-[3px] border border-[var(--line)] bg-[var(--chassis)] p-2 text-label leading-relaxed">
            {preview || "(nothing to export)"}
          </pre>
        </div>
      </div>
    </Dialog>
  );
}

function extensionFor(format: string): string {
  return EXPORT_FORMATS.find((f) => f.id === format)?.extension ?? ".txt";
}
