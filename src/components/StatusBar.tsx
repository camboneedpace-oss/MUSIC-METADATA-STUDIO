import { useMemo } from "react";
import { HardDriveDownload, Radio, TriangleAlert } from "lucide-react";
import { useStore } from "../lib/store";
import { formatBytes } from "../lib/metadata/types";

const WRITE_MODE_LABEL: Record<string, string> = {
  handle: "In-place write (granted folder)",
  file: "Download a rewritten copy",
  agent: "Local agent write",
  none: "Read only",
};

export function StatusBar() {
  const files = useStore((s) => s.files);
  const visibleIds = useStore((s) => s.visibleIds);
  const selection = useStore((s) => s.selection);
  const pending = useStore((s) => s.pending);
  const writeMode = useStore((s) => s.writeMode);
  const agent = useStore((s) => s.agent);
  const scan = useStore((s) => s.scan);

  const totals = useMemo(() => {
    let bytes = 0;
    let unsaved = 0;
    let errors = 0;
    let locked = 0;
    const byFormat = new Map<string, number>();
    for (const id of visibleIds) {
      const file = files.get(id);
      if (!file) continue;
      bytes += file.size;
      if (file.dirty) unsaved++;
      if (file.tagStatus === "error") errors++;
      if (!file.writable) locked++;
      byFormat.set(file.format, (byFormat.get(file.format) ?? 0) + 1);
    }
    const top = [...byFormat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { bytes, unsaved, errors, locked, top };
  }, [files, visibleIds]);

  const selected = selection.set.size;

  return (
    <footer className="flex h-[26px] shrink-0 items-center gap-3 border-t border-[var(--line)] bg-[var(--panel-2)] px-3 text-label text-[var(--text-faint)]">
      <span className="tnum">
        <span className="font-medium text-[var(--text-dim)]">{visibleIds.length}</span>
        {visibleIds.length !== files.size ? ` of ${files.size}` : ""} files
      </span>
      <span className="tnum">{formatBytes(totals.bytes)}</span>

      <span className="divider-v my-[7px]" />

      {totals.top.map(([format, count]) => (
        <span key={format} className="mono uppercase tracking-tight">
          {format} <span className="tnum text-[var(--text-dim)]">{count}</span>
        </span>
      ))}

      {selected ? (
        <>
          <span className="divider-v my-[7px]" />
          <span className="text-[var(--accent)] tnum">{selected} selected</span>
        </>
      ) : null}

      {totals.unsaved ? (
        <span className="flex items-center gap-1 text-[var(--warn)]">
          <Radio size={10} />
          {pending.size} unsaved
        </span>
      ) : null}
      {totals.errors ? (
        <span className="flex items-center gap-1 text-[var(--danger)]">
          <TriangleAlert size={10} />
          {totals.errors} unreadable
        </span>
      ) : null}

      <span className="flex-1" />

      {scan.active ? (
        <span className="tnum text-[var(--accent)]">
          scanning {scan.done}/{scan.total}
        </span>
      ) : null}

      {totals.locked ? (
        <span className="flex items-center gap-1">
          <HardDriveDownload size={10} />
          {totals.locked} read-only
        </span>
      ) : null}

      <span className="hidden sm:inline" title={WRITE_MODE_LABEL[writeMode] ?? writeMode}>
        {WRITE_MODE_LABEL[writeMode] ?? writeMode}
      </span>
      <span
        className={
          agent.state === "connected" ? "text-[var(--ok)]" : "text-[var(--text-faint)]"
        }
      >
        agent {agent.state}
      </span>
    </footer>
  );
}
