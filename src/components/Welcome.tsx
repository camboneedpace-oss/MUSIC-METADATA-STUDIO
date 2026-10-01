import {
  AudioWaveform,
  BadgeCheck,
  Binary,
  Braces,
  Cpu,
  FolderOpen,
  Gauge,
  Github,
  Globe,
  HardDrive,
  Layers,
  ListChecks,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useStore } from "../lib/store";
import { Button } from "./ui/primitives";
import { Scene3D } from "./Scene3D";
import { FORMAT_CAPABILITIES } from "../lib/metadata/types";
import type { ReactNode } from "react";

const CAPABILITIES: Array<{ icon: ReactNode; title: string; body: string }> = [
  {
    icon: <Binary size={16} />,
    title: "Real binary codecs",
    body: "ID3v2.2/3/4, Vorbis Comment, FLAC blocks, MP4 ilst atoms, RIFF INFO, AIFF, APEv2 and ASF — read and written by hand in this repo, no wrapper library.",
  },
  {
    icon: <ShieldCheck size={16} />,
    title: "Verified writes",
    body: "Every save is re-parsed in memory and compared against the intended metadata. A file is only replaced after the new bytes prove they parse.",
  },
  {
    icon: <Wand2 size={16} />,
    title: "Batch automation",
    body: "Chained action groups, cleanup pipelines, find & replace and smart renames. Each run lands as a single undo step.",
  },
  {
    icon: <Globe size={16} />,
    title: "Online lookup",
    body: "MusicBrainz and Discogs behind one provider interface, with automatic matching, cover art from the Cover Art Archive, and per-field preview before applying.",
  },
  {
    icon: <Gauge size={16} />,
    title: "Library analysis",
    body: "Duplicate detection by tag signature and audio fingerprint, health scoring, and a format matrix that states exactly what this build can do.",
  },
  {
    icon: <Cpu size={16} />,
    title: "Stays out of the way",
    body: "Parsing runs in a worker pool, the table virtualises, and the main thread is never asked to hold your library in memory.",
  },
];

const SHORTCUTS: Array<[string, string]> = [
  ["Ctrl+O", "Open a folder"],
  ["Ctrl+Shift+O", "Add individual files"],
  ["Ctrl+S", "Save pending changes"],
  ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
  ["Ctrl+F", "Focus search"],
  ["Ctrl+K", "Command palette"],
  ["Ctrl+I", "Toggle inspector"],
  ["Ctrl+H", "Toggle history"],
  ["Ctrl+A", "Select all visible"],
  ["Delete", "Discard selected edits"],
];

export function Welcome() {
  const openFolder = useStore((s) => s.openFolder);
  const pickFiles = useStore((s) => s.pickFiles);
  const openDialog = useStore((s) => s.openDialog);
  const capabilities = useStore((s) => s.capabilities);
  const agent = useStore((s) => s.agent);

  const formats = Object.entries(FORMAT_CAPABILITIES);
  const readable = formats.filter(([, c]) => c.read).length;
  const writable = formats.filter(([, c]) => c.write).length;

  return (
    <div className="h-full overflow-auto">
      {/* ---------------- hero ---------------- */}
      <section className="relative overflow-hidden border-b border-[var(--line)]">
        <Scene3D />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 130% at 15% -20%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 62%), radial-gradient(50% 100% at 95% -10%, color-mix(in oklab, var(--accent) 9%, transparent), transparent 60%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(65% 70% at 35% 0%, black, transparent)",
          }}
        />
        {/* Keeps the copy legible over the stage regardless of pointer tilt. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(100deg, var(--chassis) 4%, color-mix(in oklab, var(--chassis) 82%, transparent) 42%, transparent 72%)",
          }}
        />

        <div className="relative mx-auto max-w-[1080px] px-10 py-16">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2.5 py-1 text-micro font-semibold uppercase tracking-[0.1em] text-[var(--accent)]">
            <HardDrive size={10} />
            Local-first · nothing leaves this machine
          </span>

          <h1 className="mt-5 text-hero font-semibold leading-[1.02] tracking-[-0.03em]">
            Universal Music
            <br />
            <span className="bg-[linear-gradient(92deg,var(--accent),color-mix(in_oklab,var(--accent)_60%,var(--info)))] bg-clip-text text-transparent">
              Metadata Studio
            </span>
          </h1>

          <p className="mt-5 max-w-[64ch] text-lead leading-relaxed text-[var(--text-dim)]">
            A professional tag editor and library manager that runs entirely in your browser. Point it at
            a folder and it parses every container from scratch, gives you a spreadsheet-grade editing
            surface, and writes changes back safely — with verification, backups and a full undo history.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <Button variant="primary" size="lg" onClick={() => void openFolder()} disabled={!capabilities.directoryPicker}>
              <FolderOpen size={14} /> Open a folder
            </Button>
            <Button variant="outline" size="lg" onClick={() => void pickFiles()}>
              <ListChecks size={14} /> Add files
            </Button>
            <span className="ml-1 text-label text-[var(--text-faint)]">
              …or drop files and folders anywhere on this window
            </span>
          </div>

          <dl className="mt-10 grid max-w-[680px] grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--line)]">
            <Metric label="Containers detected" value={String(formats.length)} />
            <Metric label="Readable" value={String(readable)} />
            <Metric label="Writable in place" value={String(writable)} />
          </dl>
        </div>
      </section>

      {/* ---------------- capabilities ---------------- */}
      <section className="mx-auto max-w-[1080px] px-10 py-12">
        <h2 className="label-xs mb-4 flex items-center gap-1.5">
          <Layers size={11} /> What it does
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {CAPABILITIES.map((item) => (
            <article
              key={item.title}
              className="surface px-4 py-4 transition-colors duration-200 hover:border-[var(--line-strong)]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent)]">
                {item.icon}
              </span>
              <h3 className="mt-3 text-lead font-semibold tracking-tight">{item.title}</h3>
              <p className="mt-1.5 text-body leading-relaxed text-[var(--text-dim)]">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---------------- formats + shortcuts ---------------- */}
      <section className="mx-auto grid max-w-[1080px] grid-cols-[1.35fr_1fr] gap-8 px-10 pb-14">
        <div>
          <h2 className="label-xs mb-3 flex items-center gap-1.5">
            <AudioWaveform size={11} /> Container coverage
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {formats.map(([id, caps]) => (
              <button
                key={id}
                type="button"
                onClick={() => openDialog("formats")}
                title={`${id} — ${caps.notes}`}
                className="group mono flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--panel-2)] px-2 py-1 text-label uppercase tracking-tight text-[var(--text-dim)] transition-all duration-150 hover:-translate-y-px hover:border-[var(--accent-line)] hover:text-[var(--accent)]"
              >
                {caps.read ? (
                  <BadgeCheck size={10} className="text-[var(--ok)]" />
                ) : (
                  <span className="w-[10px]" />
                )}
                {id}
                <span
                  className={
                    caps.write
                      ? "rounded-[2px] bg-[color-mix(in_oklab,var(--ok)_18%,transparent)] px-1 text-micro text-[var(--ok)]"
                      : "rounded-[2px] bg-[var(--raised)] px-1 text-micro text-[var(--text-faint)]"
                  }
                >
                  {caps.write ? "rw" : "r"}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-label text-[var(--text-faint)]">
            Formats with no writer are never silently re-encoded — you get an export instead.
          </p>
        </div>

        <div>
          <h2 className="label-xs mb-3 flex items-center gap-1.5">
            <Braces size={11} /> Keyboard
          </h2>
          <dl className="space-y-1.5">
            {SHORTCUTS.map(([keys, label]) => (
              <div key={keys} className="flex items-baseline gap-3">
                <dt className="kbd w-[132px] shrink-0 justify-start">{keys}</dt>
                <dd className="text-body text-[var(--text-dim)]">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ---------------- footer strip ---------------- */}
      <section className="hairline-t flex flex-wrap items-center gap-x-6 gap-y-2 bg-[var(--panel)] px-10 py-3.5 text-label text-[var(--text-faint)]">
        <span className="flex items-center gap-1.5">
          <Sparkles size={11} /> MusicBrainz · Discogs · Cover Art Archive
        </span>
        <span className="flex items-center gap-1.5">
          <HardDrive size={11} /> Metadata never leaves this machine unless you run a lookup
        </span>
        <span className="flex items-center gap-1.5">
          <Github size={11} /> AGPL-3.0
        </span>
        <span className="flex-1" />
        <span className={agent.state === "connected" ? "text-[var(--ok)]" : ""}>
          local agent: {agent.state}
        </span>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--panel-2)] px-4 py-3.5">
      <dt className="label-xs">{label}</dt>
      <dd className="tnum mt-1 text-display font-semibold tracking-tight">{value}</dd>
    </div>
  );
}