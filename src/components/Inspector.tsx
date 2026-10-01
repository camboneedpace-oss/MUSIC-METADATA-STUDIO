import * as React from "react";
import {
  AlertTriangle,
  ChevronDown,
  FileText,
  Music4,
  Plus,
  Trash2,
} from "lucide-react";
import { useStore, useSelectedFiles } from "../lib/store";
import {
  formatBitrate,
  formatBytes,
  formatDuration,
  formatSampleRate,
  type Artwork,
  type MusicMetadata,
} from "../lib/metadata/types";
import { validateFile } from "../lib/analysis/validation";
import { fullArtworkUrl } from "../lib/artwork";
import { Badge, cn } from "./ui/primitives";

type Section = "basic" | "music" | "identifiers" | "technical" | "artwork" | "advanced";

const MULTI: Array<[string, keyof MusicMetadata]> = [
  ["Artist", "artists"],
  ["Album Artist", "albumArtists"],
  ["Composer", "composers"],
  ["Genre", "genres"],
];

const SIMPLE: Array<[string, keyof MusicMetadata]> = [
  ["Title", "title"],
  ["Album", "album"],
  ["Conductor", "conductor"],
  ["Grouping", "grouping"],
  ["Comment", "comment"],
];

const NUMBERS: Array<[string, keyof MusicMetadata]> = [
  ["Track", "trackNumber"],
  ["Track Total", "trackTotal"],
  ["Disc", "discNumber"],
  ["Disc Total", "discTotal"],
  ["Year", "year"],
  ["BPM", "bpm"],
];

export function Inspector() {
  const selected = useSelectedFiles();
  const applyEdits = useStore((s) => s.applyEdits);
  const openDialog = useStore((s) => s.openDialog);
  const [open, setOpen] = React.useState<Record<Section, boolean>>({
    basic: true,
    music: true,
    identifiers: false,
    technical: true,
    artwork: true,
    advanced: false,
  });

  const file = selected[0];

  if (!file) {
    return (
      <aside className="flex w-[320px] shrink-0 flex-col border-l border-[var(--line)] bg-[var(--panel)]">
        <Header count={0} />
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-body text-[var(--text-faint)]">
            Select a file to inspect its tags.
          </p>
        </div>
      </aside>
    );
  }

  const issues = validateFile(file);
  const set = (field: keyof MusicMetadata, value: unknown) =>
    applyEdits([{ fileId: file.id, changes: { [field]: value } }], `Set ${String(field)}`);
  const clear = (field: keyof MusicMetadata) =>
    applyEdits([{ fileId: file.id, changes: {}, cleared: [String(field)] }], `Clear ${String(field)}`);

  const values = (field: keyof MusicMetadata): string[] => {
    const v = file.metadata[field];
    if (Array.isArray(v)) return v as string[];
    if (v === undefined || v === null) return [];
    return [String(v)];
  };

  return (
    <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-[var(--line)] bg-[var(--panel)]">
      <Header count={selected.length} file={file} />

      {issues.length > 0 ? (
        <div className="mx-2 mt-2 rounded-[4px] border border-[color-mix(in_oklab,var(--warn)_35%,transparent)] bg-[color-mix(in_oklab,var(--warn)_8%,transparent)] px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-label font-medium text-[var(--warn)]">
            <AlertTriangle size={11} /> {issues.length} issue{issues.length === 1 ? "" : "s"}
          </div>
          <ul className="mt-1 space-y-0.5">
            {issues.slice(0, 4).map((issue) => (
              <li key={issue.id} className="flex items-start gap-1 text-label leading-snug text-[var(--text-dim)]">
                <span className={cn("mt-[5px] h-[4px] w-[4px] shrink-0 rounded-full", issue.severity === "error" ? "bg-[var(--danger)]" : issue.severity === "warning" ? "bg-[var(--warn)]" : "bg-[var(--text-faint)]")} />
                <span className="flex-1">{issue.message}</span>
                {issue.fix ? (
                  <button
                    type="button"
                    className="shrink-0 text-label text-[var(--accent)] hover:underline"
                    onClick={() => {
                      const fix = issue.fix!;
                      if (fix.kind === "clear" && fix.field) clear(fix.field as keyof MusicMetadata);
                      else if (fix.kind === "set" && fix.field) {
                        const multi = MULTI.find(([, f]) => f === fix.field);
                        set(fix.field as keyof MusicMetadata, multi && fix.value ? [fix.value] : fix.value ?? "");
                      } else if (fix.kind === "delete-artwork") {
                        set("artwork", []);
                      }
                    }}
                  >
                    Fix
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Section title="Basic" open={open.basic} onToggle={() => setOpen({ ...open, basic: !open.basic })}>
        {SIMPLE.slice(0, 2).map(([label, field]) => (
          <Row
            key={label}
            label={label}
            value={values(field)}
            dirty={file.pending?.cleared.includes(String(field))}
            onCommit={(v) => (v ? set(field, v) : clear(field))}
          />
        ))}
        {MULTI.slice(0, 2).map(([label, field]) => (
          <MultiRow
            key={label}
            label={label}
            values={values(field)}
            dirty={file.pending?.cleared.includes(String(field))}
            onChange={(v) => (v.length ? set(field, v) : clear(field))}
          />
        ))}
        {NUMBERS.slice(0, 4).map(([label, field]) => (
          <Row
            key={label}
            label={label}
            value={values(field)}
            numeric
            dirty={file.pending?.cleared.includes(String(field))}
            onCommit={(v) => {
              if (!v) return clear(field);
              const n = Number.parseInt(v, 10);
              if (Number.isFinite(n)) set(field, n);
            }}
          />
        ))}
        <Row label="Genre" value={values("genres")} dirty={false} onCommit={(v) => set("genres", v ? [v] : [])} />
      </Section>

      <Section title="Music" open={open.music} onToggle={() => setOpen({ ...open, music: !open.music })}>
        <Row label="Composer" value={values("composer")} onCommit={(v) => set("composer", v)} />
        <Row label="Conductor" value={values("conductor")} onCommit={(v) => set("conductor", v)} />
        <Row label="Grouping" value={values("grouping")} onCommit={(v) => set("grouping", v)} />
        <Row label="BPM" value={values("bpm")} numeric onCommit={(v) => { const n = Number.parseInt(v, 10); if (Number.isFinite(n)) set("bpm", n); }} />
        <Row label="Key" value={values("key")} onCommit={(v) => set("key", v)} />
        <Row label="Comment" value={values("comment")} multiline onCommit={(v) => set("comment", v)} />
        <Row label="Copyright" value={values("copyright")} onCommit={(v) => set("copyright", v)} />
        <Row label="Label" value={values("label")} onCommit={(v) => set("label", v)} />
      </Section>

      <Section title="Identifiers" open={open.identifiers} onToggle={() => setOpen({ ...open, identifiers: !open.identifiers })}>
        <Row label="ISRC" value={values("isrc")} mono onCommit={(v) => set("isrc", v)} />
        <Row label="Barcode" value={values("barcode")} mono onCommit={(v) => set("barcode", v)} />
        <Row label="Catalog Number" value={values("catalogNumber")} mono onCommit={(v) => set("catalogNumber", v)} />
        <Row label="MB Recording" value={values("musicBrainzRecordingId")} mono onCommit={(v) => set("musicBrainzRecordingId", v)} />
        <Row label="MB Release" value={values("musicBrainzReleaseId")} mono onCommit={(v) => set("musicBrainzReleaseId", v)} />
        <Row label="MB Release Group" value={values("musicBrainzReleaseGroupId")} mono onCommit={(v) => set("musicBrainzReleaseGroupId", v)} />
        <Row label="MB Work" value={values("musicBrainzWorkId")} mono onCommit={(v) => set("musicBrainzWorkId", v)} />
      </Section>

      <Section title="Technical" open={open.technical} onToggle={() => setOpen({ ...open, technical: !open.technical })}>
        <ReadRow label="Codec" value={file.audio.codec} />
        <ReadRow label="Container" value={file.audio.container} />
        <ReadRow label="Duration" value={formatDuration(file.audio.duration)} />
        <ReadRow label="Bitrate" value={`${formatBitrate(file.audio.bitrate)}${file.audio.bitrateMode ? ` · ${file.audio.bitrateMode}` : ""}`} />
        <ReadRow label="Sample rate" value={formatSampleRate(file.audio.sampleRate)} />
        <ReadRow label="Channels" value={file.audio.channels ? (file.audio.channels === 1 ? "Mono" : file.audio.channels === 2 ? "Stereo" : `${file.audio.channels} ch`) : undefined} />
        <ReadRow label="Bit depth" value={file.audio.bitDepth ? `${file.audio.bitDepth}-bit` : undefined} />
        <ReadRow label="File size" value={formatBytes(file.size)} />
        <ReadRow label="Lossless" value={file.audio.lossless ? "Yes" : "No"} />
        <ReadRow label="ReplayGain" value={[file.metadata.replayGainTrackGain, file.metadata.replayGainTrackPeak].filter(Boolean).join(" / ") || undefined} />
        <ReadRow label="Encoder" value={[file.metadata.encoder, file.metadata.encoderSettings].filter(Boolean).join(" · ") || undefined} />
        <ReadRow label="Tag scheme" value={file.tagScheme} />
      </Section>

      <Section title="Artwork" open={open.artwork} onToggle={() => setOpen({ ...open, artwork: !open.artwork })}>
        <ArtworkSection file={file} onManage={() => openDialog("artwork")} onClear={() => set("artwork", [])} />
      </Section>

      <Section title="Advanced" open={open.advanced} onToggle={() => setOpen({ ...open, advanced: !open.advanced })}>
        <div className="px-2.5 pb-2">
          <p className="label-xs mb-1">Custom fields</p>
          {Object.entries(file.metadata.customFields ?? {}).length === 0 ? (
            <p className="text-label text-[var(--text-faint)]">No custom fields.</p>
          ) : (
            <ul className="space-y-1">
              {Object.entries(file.metadata.customFields ?? {}).map(([key, value]) => (
                <li key={key} className="flex items-baseline gap-2 text-label">
                  <span className="mono w-[38%] shrink-0 truncate text-[var(--text-faint)]" title={key}>{key}</span>
                  <span className="mono flex-1 truncate" title={value}>{value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-2.5 pb-2">
          <p className="label-xs mb-1 flex items-center gap-1"><FileText size={10} /> Raw tags ({file.raw.length})</p>
          <div className="max-h-[220px] overflow-auto rounded-[3px] border border-[var(--line)] bg-[var(--chassis)] p-1.5">
            {file.raw.map((tag, i) => (
              <div key={`${tag.key}-${i}`} className="mono flex gap-1.5 border-b border-[color-mix(in_oklab,var(--line)_50%,transparent)] py-0.5 text-label last:border-0">
                <span className="w-[34%] shrink-0 truncate text-[var(--accent)]" title={tag.key}>{tag.key}</span>
                <span className="flex-1 truncate text-[var(--text-dim)]" title={tag.values.join("\n")}>
                  {tag.values.join(" · ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Section>
    </aside>
  );
}

function Header({ count, file }: { count: number; file?: { name: string; folder: string; format: string } }) {
  return (
    <div className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--panel)] px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <Music4 size={12} className="text-[var(--accent)]" />
        <span className="text-label font-semibold uppercase tracking-[0.07em] text-[var(--text-dim)]">
          {count > 1 ? `${count} files selected` : "Inspector"}
        </span>
      </div>
      {file ? (
        <p className="mono mt-0.5 truncate text-label text-[var(--text-faint)]" title={file.name}>
          {file.folder ? `${file.folder}/` : ""}{file.name}
        </p>
      ) : null}
    </div>
  );
}

function Section({
  title,
  children,
  open,
  onToggle,
}: {
  title: string;
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="border-b border-[var(--line)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1 px-2.5 py-1.5 text-left hover:bg-[var(--raised)]"
      >
        <ChevronDown size={11} className={cn("text-[var(--text-faint)] transition-transform", !open && "-rotate-90")} />
        <span className="label-xs">{title}</span>
      </button>
      {open ? <div className="pb-2">{children}</div> : null}
    </section>
  );
}

function Row({
  label,
  value,
  onCommit,
  dirty,
  numeric,
  mono,
  multiline,
}: {
  label: string;
  value: string[];
  onCommit: (value: string) => void;
  dirty?: boolean;
  numeric?: boolean;
  mono?: boolean;
  multiline?: boolean;
}) {
  const [draft, setDraft] = React.useState(value[0] ?? "");
  React.useEffect(() => setDraft(value[0] ?? ""), [value[0]]);
  return (
    <div className="flex items-center gap-2 px-2.5 py-[2px]">
      <label className="w-[86px] shrink-0 truncate text-label text-[var(--text-faint)]" title={label}>
        {label}
      </label>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== (value[0] ?? "") && onCommit(draft.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        inputMode={numeric ? "numeric" : undefined}
        placeholder={multiline ? "" : "—"}
        className={cn(
          "input h-[22px] flex-1",
          mono && "mono text-label",
          dirty && "border-[var(--accent)] text-[var(--accent)]",
        )}
      />
      {dirty ? <span className="h-[4px] w-[4px] shrink-0 rounded-full bg-[var(--accent)]" title="Unsaved change" /> : null}
    </div>
  );
}

function MultiRow({
  label,
  values,
  onChange,
  dirty,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  dirty?: boolean;
}) {
  const add = () => onChange([...values, ""]);
  const remove = (index: number) => onChange(values.filter((_, i) => i !== index));
  const update = (index: number, v: string) => {
    const next = [...values];
    next[index] = v;
    onChange(next);
  };

  return (
    <div className="px-2.5 py-[2px]">
      <div className="flex items-center gap-2">
        <span className="w-[86px] shrink-0 truncate text-label text-[var(--text-faint)]">{label}</span>
        <div className="flex flex-1 flex-col gap-1">
          {values.length === 0 ? (
            <span className="text-label text-[var(--text-faint)]">—</span>
          ) : (
            values.map((v, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  value={v}
                  onChange={(e) => update(i, e.target.value)}
                  onBlur={() => onChange(values.filter((x) => x.trim()))}
                  className={cn("input h-[22px] flex-1", dirty && "border-[var(--accent)]")}
                />
                <button
                  type="button"
                  aria-label={`Remove ${label} value ${i + 1}`}
                  onClick={() => remove(i)}
                  className="btn h-[22px] w-[22px] justify-center p-0"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))
          )}
          <button type="button" onClick={add} className="btn btn-outline h-[20px] self-start text-label">
            <Plus size={10} /> Add value
          </button>
        </div>
      </div>
    </div>
  );
}

function ReadRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline gap-2 px-2.5 py-[1.5px]">
      <span className="w-[86px] shrink-0 truncate text-label text-[var(--text-faint)]">{label}</span>
      <span className="mono flex-1 truncate text-label text-[var(--text-dim)]" title={value}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function ArtworkSection({
  file,
  onManage,
  onClear,
}: {
  file: { metadata: { artwork?: Artwork[] } };
  onManage: () => void;
  onClear: () => void;
}) {
  const art = file.metadata.artwork ?? [];
  return (
    <div className="px-2.5">
      {art.length === 0 ? (
        <p className="text-label text-[var(--text-faint)]">No embedded artwork.</p>
      ) : (
        <div className="flex gap-2">
          <img
            src={fullArtworkUrl(art[0])}
            alt="Embedded cover"
            className="h-[112px] w-[112px] rounded-[3px] border border-[var(--line)] object-cover"
          />
          <div className="min-w-0 flex-1 space-y-1 text-label">
            <p className="tnum text-[var(--text)]">
              {art[0].width} × {art[0].height}
            </p>
            <p className="text-[var(--text-faint)]">
              {art[0].mime.replace("image/", "").toUpperCase()} · {(art[0].bytes / 1024).toFixed(0)} KB
            </p>
            {art[0].width < 500 ? <Badge tone="warn">Low resolution</Badge> : null}
            {art.length > 1 ? <p className="text-[var(--text-faint)]">+{art.length - 1} more image(s)</p> : null}
          </div>
        </div>
      )}
      <div className="mt-2 flex gap-1">
        <button type="button" className="btn btn-outline h-[22px] text-label" onClick={onManage}>
          Manage
        </button>
        {art.length ? (
          <button type="button" className="btn btn-danger h-[22px] text-label" onClick={onClear}>
            <Trash2 size={11} /> Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}