import * as React from "react";
import { Disc3 } from "lucide-react";
import { useStore } from "../lib/store";
import { Dialog } from "./ui/primitives";
import { FORMAT_CAPABILITIES, type FormatId } from "../lib/metadata/types";

const CAPS = [
  { key: "read", label: "Read" },
  { key: "write", label: "Write" },
  { key: "artwork", label: "Art" },
  { key: "chapters", label: "Ch." },
  { key: "lyrics", label: "Lyr" },
  { key: "multiValue", label: "Multi" },
  { key: "lossless", label: "Lossless" },
] as const;

export function FormatsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const files = useStore((s) => s.files);
  const visibleIds = useStore((s) => s.visibleIds);

  const counts = React.useMemo(() => {
    const map = new Map<FormatId, number>();
    for (const id of visibleIds) {
      const file = files.get(id);
      if (!file) continue;
      map.set(file.format, (map.get(file.format) ?? 0) + 1);
    }
    return map;
  }, [files, visibleIds]);

  const rows = Object.keys(FORMAT_CAPABILITIES) as FormatId[];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Format support matrix"
      description="What this build reads and writes, per container. Counts come from the current library."
      width={820}
      icon={<Disc3 size={15} />}
      footer={<span className="mr-auto text-label text-[var(--text-faint)]">No container is silently approximated.</span>}
    >
      <div className="max-h-[62vh] overflow-auto">
        <table className="w-full border-collapse text-body">
          <thead className="sticky top-0 z-[1] bg-[var(--panel-2)]">
            <tr>
              <th className="border-b border-[var(--line)] px-3 py-1.5 text-left font-medium text-[var(--text-faint)]">
                Format
              </th>
              <th className="border-b border-[var(--line)] px-3 py-1.5 text-right font-medium text-[var(--text-faint)]">
                In library
              </th>
              {CAPS.map((cap) => (
                <th
                  key={cap.key}
                  title={cap.label}
                  className="border-b border-[var(--line)] px-2 py-1.5 text-center font-medium text-[var(--text-faint)]"
                >
                  {cap.label}
                </th>
              ))}
              <th className="border-b border-[var(--line)] px-3 py-1.5 text-left font-medium text-[var(--text-faint)]">
                Notes
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((format) => {
              const caps = FORMAT_CAPABILITIES[format];
              const count = counts.get(format) ?? 0;
              return (
                <tr
                  key={format}
                  className={
                    count
                      ? "row-hover border-b border-[var(--line)]"
                      : "border-b border-[var(--line)] opacity-45"
                  }
                >
                  <td className="mono px-3 py-1.5 uppercase tracking-tight">{format}</td>
                  <td className="tnum px-3 py-1.5 text-right text-[var(--text-dim)]">{count || "—"}</td>
                  {CAPS.map((cap) => (
                    <td key={cap.key} className="px-2 py-1.5 text-center">
                      <span className={caps[cap.key] ? "text-[var(--ok)]" : "text-[var(--text-faint)]"}>
                        {caps[cap.key] ? "●" : "·"}
                      </span>
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-[var(--text-dim)]">{caps.notes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}