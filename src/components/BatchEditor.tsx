import * as React from "react";
import { Check, Layers, Trash2, Wand2 } from "lucide-react";
import { useStore, useSelectedFiles } from "../lib/store";
import type { LibraryFile } from "../lib/library/types";
import type { MusicMetadata } from "../lib/metadata/types";
import { Button, Dialog, Segmented, cn } from "./ui/primitives";

type Scope = "keep" | "clear" | "set";

interface FieldState {
  scope: Scope;
  value: string;
}

const MULTI_FIELDS = new Set(["artists", "albumArtists", "genres", "composers"]);
const BOOLEAN_FIELDS = new Set(["compilation"]);

const FIELD_GROUPS: Array<{ label: string; fields: Array<[string, keyof MusicMetadata]> }> = [
  {
    label: "Core",
    fields: [
      ["Artist", "artists"],
      ["Album", "album"],
      ["Album Artist", "albumArtists"],
      ["Genre", "genres"],
      ["Year", "year"],
    ],
  },
  {
    label: "People",
    fields: [
      ["Composer", "composers"],
      ["Conductor", "conductor"],
      ["Label", "label"],
      ["Publisher", "publisher"],
    ],
  },
  {
    label: "Extras",
    fields: [
      ["Comment", "comment"],
      ["Grouping", "grouping"],
      ["Copyright", "copyright"],
      ["Compilation", "compilation"],
    ],
  },
];

export function BatchEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const files = useSelectedFiles();
  const applyEdits = useStore((s) => s.applyEdits);
  const toast = useStore((s) => s.toast);
  const [states, setStates] = React.useState<Record<string, FieldState>>({});

  React.useEffect(() => {
    if (!open) setStates({});
  }, [open]);

  const setField = (field: string, patch: Partial<FieldState>) =>
    setStates((s) => {
      const base: FieldState = s[field] ? { ...s[field] } : { scope: "keep", value: "" };
      return { ...s, [field]: { ...base, ...patch } };
    });

  const commonValue = (field: keyof MusicMetadata): { mixed: boolean; value: string } => {
    const seen = new Map<string, number>();
    for (const file of files) {
      const raw = file.metadata[field];
      const text = Array.isArray(raw) ? raw.join(" & ") : raw === undefined ? "" : String(raw);
      seen.set(text, (seen.get(text) ?? 0) + 1);
    }
    const entries = [...seen.entries()];
    if (!entries.length) return { mixed: false, value: "" };
    const top = entries.sort((a, b) => b[1] - a[1])[0];
    return { mixed: entries.length > 1, value: top[0] };
  };

  const affected = React.useMemo(() => {
    const edits = new Map<string, Partial<MusicMetadata> & { cleared?: string[] }>();
    for (const [field, state] of Object.entries(states)) {
      if (state.scope === "keep") continue;
      if (state.scope === "clear") {
        for (const file of files) {
          const entry = edits.get(file.id) ?? {};
          entry.cleared = [...(entry.cleared ?? []), field];
          edits.set(file.id, entry);
        }
        continue;
      }
      const value = MULTI_FIELDS.has(field)
        ? state.value.split(/\s*[;/]\s*/).filter(Boolean)
        : BOOLEAN_FIELDS.has(field)
          ? state.value === "true"
          : NUMERIC.has(field)
            ? Number.parseInt(state.value, 10)
            : state.value;
      if (typeof value === "number" && !Number.isFinite(value)) continue;
      for (const file of files) {
        const entry = edits.get(file.id) ?? {};
        (entry as Record<string, unknown>)[field] = value;
        edits.set(file.id, entry);
      }
    }
    return [...edits.entries()].map(([fileId, change]) => ({ fileId, changes: change as Partial<MusicMetadata>, cleared: change.cleared }));
  }, [states, files]);

  const fieldCount = Object.values(states).filter((s) => s.scope !== "keep").length;
  const changeCount = affected.reduce(
    (n, e) => n + Object.keys(e.changes).length + (e.cleared?.length ?? 0),
    0,
  );

  const apply = () => {
    applyEdits(affected, `Batch edit ${fieldCount} field(s)`);
    toast({ kind: "success", message: `Staged ${changeCount} change(s) on ${affected.length} files` });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={`Batch Editor — ${files.length} file${files.length === 1 ? "" : "s"} selected`}
      description="Fields left as Keep are untouched. Clear empties the field on every selected file."
      width={780}
      icon={<Layers size={14} />}
      footer={
        <>
          <span className="mr-auto text-label text-[var(--text-faint)]">
            {fieldCount
              ? `${changeCount} change${changeCount === 1 ? "" : "s"} across ${affected.length} files`
              : "Nothing staged yet"}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply} disabled={!affected.length}>
            Apply to {affected.length}
          </Button>
        </>
      }
    >
      <div className="divide-y divide-[var(--line)]">
        {FIELD_GROUPS.map((group) => (
          <div key={group.label} className="px-4 py-2.5">
            <h4 className="label-xs mb-1.5">{group.label}</h4>
            <div className="space-y-1.5">
              {group.fields.map(([label, field]) => {
                const key = String(field);
                const state = states[key] ?? { scope: "keep" as Scope, value: "" };
                const { mixed, value } = commonValue(field);
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-[104px] shrink-0 text-body text-[var(--text-dim)]">{label}</span>
                    <Segmented
                      options={[
                        { value: "keep" as Scope, label: mixed ? "Mixed" : value ? "Same" : "Keep", title: "Leave every file as it is" },
                        { value: "set" as Scope, label: "Set", title: "Set this value on every selected file" },
                        { value: "clear" as Scope, label: "Clear", title: "Empty this field on every selected file" },
                      ]}
                      value={state.scope}
                      onChange={(scope) => setField(key, { scope, value: scope === "set" ? "" : state.value })}
                    />
                    <input
                      value={state.value}
                      disabled={state.scope !== "set"}
                      onChange={(e) => setField(key, { value: e.target.value })}
                      placeholder={mixed ? "Mixed values — type to replace them all" : value || "Value"}
                      className={cn(
                        "input h-[22px] flex-1",
                        state.scope === "set" && "border-[var(--accent)]",
                        state.scope !== "set" && "opacity-45",
                        MULTI_FIELDS.has(key) && "mono text-label",
                      )}
                    />
                    {state.scope !== "keep" ? (
                      <button
                        type="button"
                        aria-label={`Reset ${label}`}
                        onClick={() => setStates((s) => { const next = { ...s }; delete next[key]; return next; })}
                        className="btn h-[22px] w-[22px] justify-center p-0"
                      >
                        <Trash2 size={11} />
                      </button>
                    ) : (
                      <span className="w-[22px]" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

const NUMERIC = new Set(["year", "bpm", "trackNumber", "discNumber"]);

/** Compact summary shown under the toolbar when a selection exists. */
export function SelectionToolbar({ onOpen }: { onOpen: (name: string) => void }) {
  const files = useSelectedFiles();
  const openDialog = useStore((s) => s.openDialog);
  const save = useStore((s) => s.save);
  const pending = useStore((s) => s.pending);
  if (!files.length) return null;

  return (
    <div className="flex h-[32px] shrink-0 items-center gap-1.5 border-b border-[var(--line)] bg-[var(--panel-2)] px-2">
      <span className="tnum text-body font-semibold text-[var(--accent)]">
        {files.length} SELECTED
      </span>
      <div className="divider-v mx-1" />
      <Button onClick={() => onOpen("batch")}>Edit Tags</Button>
      <Button onClick={() => onOpen("lookup")}>Lookup</Button>
      <Button onClick={() => onOpen("artwork")}>Artwork</Button>
      <Button onClick={() => onOpen("rename")}>Rename</Button>
      <Button onClick={() => onOpen("actions")}>Actions</Button>
      <Button onClick={() => onOpen("export")}>Export</Button>
      <div className="flex-1" />
      {files.some((f: LibraryFile) => f.dirty) ? (
        <Button variant="primary" onClick={() => void save()}>
          <Check size={12} /> Save changes ({[...pending.keys()].length})
        </Button>
      ) : (
        <Button onClick={() => openDialog("preview")}>
          <Wand2 size={12} /> Preview
        </Button>
      )}
    </div>
  );
}