import * as React from "react";
import { Cpu, Database, HardDrive, Palette, Plug, ShieldCheck, Trash2 } from "lucide-react";
import { useStore } from "../lib/store";
import { Button, Dialog, Field, Segmented, Switch } from "./ui/primitives";
import { clearEverything, estimateUsage } from "../lib/db/idb";
import { DEFAULT_PROVIDER_SETTINGS, type ProviderSettings } from "../lib/providers/types";

const THEMES = [
  { value: "dark", label: "Dark" },
  { value: "oled", label: "OLED" },
  { value: "light", label: "Light" },
  { value: "contrast", label: "Contrast" },
];

const ACCENTS = ["#f0a53c", "#4ec97f", "#5aa9e6", "#e0616d", "#b98ce0", "#e0c341"];

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const toast = useStore((s) => s.toast);
  const detectAgent = useStore((s) => s.detectAgent);
  const agent = useStore((s) => s.agent);
  const capabilities = useStore((s) => s.capabilities);
  const [storage, setStorage] = React.useState<{ usage: number; quota: number } | null>(null);

  const providers = React.useMemo(
    () => ({ ...DEFAULT_PROVIDER_SETTINGS, ...(settings.providers as ProviderSettings) }),
    [settings.providers],
  );

  React.useEffect(() => {
    if (!open) return;
    void estimateUsage().then(setStorage);
  }, [open]);

  const patchProviders = (patch: Partial<ProviderSettings>) =>
    void update({ providers: { ...providers, ...patch } });

  const mb = storage ? storage.usage / 1024 / 1024 : 0;
  const quota = storage ? storage.quota / 1024 / 1024 : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Settings"
      description="Everything is stored in this browser. Nothing is uploaded unless you run a metadata lookup."
      width={640}
      icon={<Palette size={15} />}
      footer={
        <>
          <span className="mr-auto text-label text-[var(--text-faint)]">
            Settings persist in IndexedDB and apply immediately.
          </span>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <div className="divide-y divide-[var(--line)]">
        <section className="px-4 py-3.5">
          <h3 className="label-xs mb-2.5 flex items-center gap-1.5">
            <Palette size={11} /> Appearance
          </h3>
          <div className="flex flex-wrap items-end gap-5">
            <Field label="Theme">
              <Segmented options={THEMES} value={settings.theme} onChange={(theme) => void update({ theme })} />
            </Field>
            <Field label="Accent">
              <div className="flex items-center gap-1.5">
                {ACCENTS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Accent ${hex}`}
                    onClick={() => void update({ accent: hex })}
                    style={{ background: hex }}
                    className={
                      settings.accent.toLowerCase() === hex
                        ? "h-[20px] w-[20px] rounded-[3px] ring-2 ring-[var(--text)] ring-offset-2 ring-offset-[var(--panel)]"
                        : "h-[18px] w-[18px] rounded-[3px] opacity-70 hover:opacity-100"
                    }
                  />
                ))}
              </div>
            </Field>
          </div>
        </section>

        <section className="px-4 py-3.5">
          <h3 className="label-xs mb-2.5 flex items-center gap-1.5">
            <ShieldCheck size={11} /> Write safety
          </h3>
          <div className="space-y-2.5">
            <Switch
              checked={settings.backups}
              onChange={(backups) => void update({ backups })}
              label="Keep a pre-write copy of every file before the first change"
            />
            <Switch
              checked={settings.writeId3v1}
              onChange={(writeId3v1) => void update({ writeId3v1 })}
              label="Also write the legacy ID3v1 tag on MP3s (adds a 128-byte footer)"
            />
            <Field label="ID3v2 version for MP3 writes" className="max-w-[220px]">
              <Segmented
                options={[
                  { value: "3", label: "v2.3" },
                  { value: "4", label: "v2.4" },
                ]}
                value={String(settings.id3Version)}
                onChange={(v) => void update({ id3Version: Number(v) === 3 ? 3 : 4 })}
              />
            </Field>
            <p className="max-w-[60ch] text-label leading-relaxed text-[var(--text-faint)]">
              Every write is verified by re-parsing the bytes we produced before the original file is
              replaced. A write that fails verification is discarded and the file is left untouched.
            </p>
          </div>
        </section>

        <section className="px-4 py-3.5">
          <h3 className="label-xs mb-2.5 flex items-center gap-1.5">
            <Plug size={11} /> Online providers
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="MusicBrainz contact email" hint="Raises the anonymous rate limit.">
              <input
                className="input h-[24px]"
                value={providers.musicBrainzEmail ?? ""}
                onChange={(e) => patchProviders({ musicBrainzEmail: e.target.value })}
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Discogs token" hint="Required for Discogs search.">
              <input
                className="input h-[24px]"
                type="password"
                value={providers.discogsToken ?? ""}
                onChange={(e) => patchProviders({ discogsToken: e.target.value })}
                placeholder="Personal access token"
              />
            </Field>
            <Field label="User agent app" className="col-span-2">
              <input
                className="input h-[24px]"
                value={providers.userAgentApp ?? ""}
                onChange={(e) => patchProviders({ userAgentApp: e.target.value })}
              />
            </Field>
          </div>
        </section>

        <section className="px-4 py-3.5">
          <h3 className="label-xs mb-2.5 flex items-center gap-1.5">
            <Cpu size={11} /> Performance
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Scan workers">
              <input
                type="number"
                min={1}
                max={8}
                className="input h-[24px] tnum"
                value={settings.workerCount}
                onChange={(e) =>
                  void update({ workerCount: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })
                }
              />
            </Field>
            <Field label="Thumbnail cache">
              <input
                type="number"
                min={0}
                max={4000}
                step={50}
                className="input h-[24px] tnum"
                value={settings.thumbnailCacheSize}
                onChange={(e) =>
                  void update({
                    thumbnailCacheSize: Math.max(0, Math.min(4000, Number(e.target.value) || 0)),
                  })
                }
              />
            </Field>
            <Field label="Agent port">
              <input
                type="number"
                min={1024}
                max={65535}
                className="input h-[24px] tnum"
                value={settings.agentPort}
                onChange={(e) =>
                  void update({ agentPort: Math.max(1024, Math.min(65535, Number(e.target.value) || 7331)) })
                }
              />
            </Field>
          </div>
        </section>

        <section className="px-4 py-3.5">
          <h3 className="label-xs mb-2.5 flex items-center gap-1.5">
            <HardDrive size={11} /> Storage & platform
          </h3>
          <div className="space-y-2 text-body text-[var(--text-dim)]">
            <p className="tnum">
              IndexedDB usage: {mb.toFixed(1)} MB
              {quota ? ` of ${quota.toFixed(0)} MB available` : ""}
            </p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[var(--text-faint)]">
              <li>Directory picker: {capabilities.directoryPicker ? "yes" : "no"}</li>
              <li>File handles: {capabilities.fileHandles ? "yes" : "no"}</li>
              <li>Save file picker: {capabilities.showSaveFilePicker ? "yes" : "no"}</li>
              <li>Drag & drop: {capabilities.dragDrop ? "yes" : "no"}</li>
              <li>OPFS: {capabilities.opfs ? "yes" : "no"}</li>
              <li>
                Local agent:{" "}
                <span className={agent.state === "connected" ? "text-[var(--ok)]" : ""}>
                  {agent.state}
                </span>
              </li>
            </ul>
            <div className="flex gap-2 pt-1">
              <Button
                onClick={() => {
                  void detectAgent();
                  toast({ kind: "info", message: "Looking for a local agent on 127.0.0.1" });
                }}
              >
                Re-detect agent
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  void clearEverything().then(() => {
                    setStorage(null);
                    toast({ kind: "success", message: "Local database cleared", detail: "Reload to re-apply defaults." });
                  });
                }}
              >
                <Database size={12} /> Clear local database
              </Button>
            </div>
          </div>
        </section>

        <section className="px-4 py-3.5">
          <h3 className="label-xs mb-2.5 flex items-center gap-1.5">
            <Trash2 size={11} /> Danger zone
          </h3>
          <div className="flex items-center gap-3">
            <Button
              variant="danger"
              onClick={() => {
                useStore.getState().clearLibrary();
                onClose();
              }}
            >
              Clear library
            </Button>
            <p className="text-label text-[var(--text-faint)]">
              Removes imported files and pending edits from this session. Files on disk are untouched.
            </p>
          </div>
        </section>
      </div>
    </Dialog>
  );
}
