import * as React from "react";
import { Download, Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { useStore, useSelectedFiles } from "../lib/store";
import { groupByAlbum, fullArtworkUrl, isArtworkMimeSupported, makeArtwork, transformArtwork } from "../lib/artwork";
import { ProviderRegistry } from "../lib/providers";
import { downloadFile } from "../lib/filesystem";
import { FORMAT_CAPABILITIES, type Artwork } from "../lib/metadata/types";
import { Button, Dialog, Field, Segmented, Badge } from "./ui/primitives";

const registry = new ProviderRegistry();

export function ArtworkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const files = useSelectedFiles();
  const applyEdits = useStore((s) => s.applyEdits);
  const toast = useStore((s) => s.toast);

  const [groups, setGroups] = React.useState<Array<{ key: string; files: typeof files; candidates: Artwork[]; loading: boolean }>>([]);
  const [maxSize, setMaxSize] = React.useState(1200);
  const [square, setSquare] = React.useState(true);
  const [format, setFormat] = React.useState<"image/jpeg" | "image/png">("image/jpeg");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setGroups(
      [...groupByAlbum(files)].map(([key, group]) => ({
        key,
        files: group,
        candidates: [],
        loading: false,
      })),
    );
  }, [open, files]);

  const searchAll = async () => {
    setBusy(true);
    const provider = registry.get("musicbrainz");
    const updated: typeof groups = [];
    for (const group of groups) {
      const first = group.files[0];
      if (!first) continue;
      updated.push({ ...group, loading: true });
    }
    setGroups(updated);

    for (const group of groups) {
      const first = group.files[0];
      if (!first) continue;
      const releaseId = first.metadata.musicBrainzReleaseId;
      if (!releaseId || !provider) continue;
      try {
        const candidates = await provider.getArtwork(releaseId);
        setGroups((list) =>
          list.map((g) =>
            g.key === group.key
              ? {
                  ...g,
                  loading: false,
                  candidates: candidates.map((c) => ({
                    id: c.id,
                    data: new Uint8Array(0),
                    mime: "image/jpeg",
                    role: c.type?.toLowerCase().includes("back") ? "back" : "front",
                    description: c.type,
                    width: c.width ?? 0,
                    height: c.height ?? 0,
                    bytes: 0,
                  })),
                }
              : g,
          ),
        );
      } catch {
        setGroups((list) => list.map((g) => (g.key === group.key ? { ...g, loading: false } : g)));
      }
    }
    setBusy(false);
  };

  const fetchCandidate = async (releaseId: string) => {
    const provider = registry.get("musicbrainz");
    if (!provider) return null;
    const candidates = await provider.getArtwork(releaseId);
    if (!candidates.length) return null;
    const url = candidates[0].url;
    const response = await fetch(url);
    const blob = await response.blob();
    const data = new Uint8Array(await blob.arrayBuffer());
    return makeArtwork(
      { data, mime: blob.type || "image/jpeg", width: candidates[0].width ?? 0, height: candidates[0].height ?? 0, bytes: data.length },
      "front",
      candidates[0].type,
    );
  };

  const importFromUrl = async (groupKey: string) => {
    const group = groups.find((g) => g.key === groupKey);
    const releaseId = group?.files[0]?.metadata.musicBrainzReleaseId;
    if (!releaseId) {
      toast({ kind: "warning", message: "These files have no MusicBrainz release ID", detail: "Run a metadata lookup first." });
      return;
    }
    try {
      const art = await fetchCandidate(releaseId);
      if (!art) {
        toast({ kind: "warning", message: "The Cover Art Archive has no image for this release" });
        return;
      }
      applyEdits(group!.files.map((f) => ({ fileId: f.id, changes: { artwork: [art] } })), "Embed artwork");
      toast({ kind: "success", message: `Staged artwork for ${group!.files.length} files` });
    } catch (err) {
      toast({ kind: "error", message: "Artwork download failed", detail: (err as Error).message });
    }
  };

  const uploadFiles = React.useCallback(
    async (inputList: FileList | null, groupKey?: string) => {
      if (!inputList?.length) return;
      setBusy(true);
      const targets = groupKey ? groups.find((g) => g.key === groupKey)?.files ?? [] : files;
      const edits: Array<{ fileId: string; changes: { artwork: Artwork[] } }> = [];
      const warnings: string[] = [];

      for (const image of Array.from(inputList)) {
        const raw = new Uint8Array(await image.arrayBuffer());
        const result = await transformArtwork(
          {
            id: "upload",
            data: raw,
            mime: image.type || "image/jpeg",
            role: "front",
            description: image.name,
            width: 0,
            height: 0,
            bytes: raw.length,
          },
          { maxSize, cropSquare: square, outputMime: format },
        );
        if (result.warning) warnings.push(`${image.name}: ${result.warning}`);
        const art = makeArtwork(result, "front", image.name);
        for (const file of targets) {
          if (!isArtworkMimeSupported(containerKind(file.format), art.mime)) {
            warnings.push(`${file.name}: ${file.format.toUpperCase()} cannot store ${art.mime}`);
            continue;
          }
          edits.push({ fileId: file.id, changes: { artwork: [art] } });
        }
      }

      if (edits.length) {
        applyEdits(edits, "Embed artwork from file");
        toast({
          kind: warnings.length ? "warning" : "success",
          message: `Staged artwork for ${edits.length} file(s)`,
          detail: warnings.slice(0, 3).join(" · ") || undefined,
        });
      } else {
        toast({ kind: "warning", message: "No file could take this image", detail: warnings[0] });
      }
      setBusy(false);
    },
    [groups, files, maxSize, square, format, applyEdits, toast],
  );

  const extractAll = async () => {
    let count = 0;
    for (const file of files) {
      const art = file.metadata.artwork?.[0];
      if (!art) continue;
      downloadFile(`${file.name.replace(/\.[^.]+$/, "")}.${art.mime === "image/png" ? "png" : "jpg"}`, art.data);
      count++;
    }
    toast({ kind: count ? "success" : "warning", message: count ? `Extracted ${count} cover(s)` : "No embedded artwork found" });
  };

  const resample = async () => {
    const edits = [];
    for (const file of files) {
      const art = file.metadata.artwork?.[0];
      if (!art) continue;
      const result = await transformArtwork(art, { maxSize, cropSquare: square, outputMime: format });
      if (result.warning) {
        toast({ kind: "warning", message: result.warning, detail: file.name });
        continue;
      }
      edits.push({ fileId: file.id, changes: { artwork: [makeArtwork(result, art.role, art.description)] } });
    }
    if (edits.length) {
      applyEdits(edits, "Resample artwork");
      toast({ kind: "success", message: `Staged ${edits.length} resized cover(s) at up to ${maxSize}px` });
    }
  };

  const removeAll = () => {
    applyEdits(files.map((f) => ({ fileId: f.id, changes: { artwork: [] } })), "Remove artwork");
    toast({ kind: "success", message: `Staged artwork removal on ${files.length} files` });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Artwork manager"
      description="Grouped by album artist + album. Nothing is embedded until you save."
      width={880}
      icon={<ImageIcon size={14} />}
      footer={
        <>
          <Button onClick={() => void extractAll()}>
            <Download size={12} /> Extract all
          </Button>
          <Button onClick={() => void resample()}>Resample selected</Button>
          <Button className="btn-danger" onClick={removeAll}>
            <Trash2 size={12} /> Remove
          </Button>
          <div className="flex-1" />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-3 border-b border-[var(--line)] px-4 py-2.5">
        <Field label="Max edge" className="w-[100px]">
          <select value={maxSize} onChange={(e) => setMaxSize(Number(e.target.value))} className="input h-[24px]">
            {[500, 800, 1200, 1600, 2400].map((n) => (
              <option key={n} value={n}>
                {n} px
              </option>
            ))}
          </select>
        </Field>
        <Field label="Shape" className="w-[150px]">
          <Segmented
            options={[
              { value: true, label: "Crop square" },
              { value: false, label: "Keep ratio" },
            ]}
            value={square}
            onChange={setSquare}
          />
        </Field>
        <Field label="Format" className="w-[180px]">
          <Segmented
            options={[
              { value: "image/jpeg" as const, label: "JPEG" },
              { value: "image/png" as const, label: "PNG" },
            ]}
            value={format}
            onChange={setFormat}
          />
        </Field>
        <div className="flex-1" />
        <Button onClick={() => void searchAll()} disabled={busy}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : null} Search by MusicBrainz ID
        </Button>
        <label className="btn btn-outline cursor-pointer">
          <Upload size={12} /> Load image…
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void uploadFiles(e.target.files)}
          />
        </label>
      </div>

      <div className="space-y-2 p-3">
        {groups.length === 0 ? (
          <p className="py-8 text-center text-body text-[var(--text-faint)]">
            Select files first — artwork is grouped per album.
          </p>
        ) : null}

        {groups.map((group) => {
          const first = group.files[0];
          const current = first?.metadata.artwork?.[0];
          const unsupported = first ? !FORMAT_CAPABILITIES[first.format].artwork : false;
          return (
            <div key={group.key} className="panel rounded-[5px] p-2.5">
              <div className="flex items-start gap-3">
                <div className="flex h-[88px] w-[88px] shrink-0 items-center justify-center overflow-hidden rounded-[3px] border border-[var(--line)] bg-[var(--chassis)]">
                  {current ? (
                    <img src={fullArtworkUrl(current)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImageIcon size={18} className="text-[var(--text-faint)]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">{first?.metadata.album || "Untitled album"}</p>
                  <p className="truncate text-label text-[var(--text-dim)]">
                    {first?.metadata.albumArtists?.[0] ?? first?.metadata.albumArtist ?? first?.metadata.artists?.[0] ?? "Unknown artist"}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge>{group.files.length} file(s)</Badge>
                    <Badge>{[...new Set(group.files.map((f) => f.format.toUpperCase()))].join(", ")}</Badge>
                    {current ? (
                      <Badge tone={current.width >= 600 ? "ok" : "warn"}>
                        {current.width} × {current.height}
                      </Badge>
                    ) : (
                      <Badge tone="warn">No artwork</Badge>
                    )}
                    {unsupported ? <Badge tone="danger">Container cannot store artwork</Badge> : null}
                    {first?.metadata.musicBrainzReleaseId ? (
                      <Badge tone="accent">MB {first.metadata.musicBrainzReleaseId.slice(0, 8)}</Badge>
                    ) : (
                      <Badge tone="warn">No MusicBrainz ID</Badge>
                    )}
                  </div>
                  {current ? (
                    <p className="mt-1 text-label text-[var(--text-faint)]">
                      {current.mime} · {(current.bytes / 1024).toFixed(0)} KB · {current.role}
                      {format !== current.mime && !isArtworkMimeSupported("mp4", format) && first?.format === "m4a"
                        ? " · MP4 only stores JPEG/PNG"
                        : ""}
                    </p>
                  ) : null}
                  <div className="mt-2 flex gap-1.5">
                    <Button size="sm" variant="primary" onClick={() => void importFromUrl(group.key)}>
                      <Download size={11} /> Download & embed
                    </Button>
                    <label className="btn btn-outline h-[22px] cursor-pointer text-label">
                      <Upload size={11} /> Image…
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void uploadFiles(e.target.files, group.key)}
                      />
                    </label>
                    {current ? (
                      <Button size="sm" onClick={() => downloadFile(`${group.key.replace(/\W+/g, "_")}.jpg`, current.data)}>
                        Export
                      </Button>
                    ) : null}
                    {group.loading ? <Loader2 size={12} className="ml-1 animate-spin text-[var(--accent)]" /> : null}
                  </div>
                </div>
              </div>
              <span className="sr-only">{group.key}</span>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

/** Which artwork rules apply to a container. */
function containerKind(format: string): "mp3" | "mp4" | "vorbis" | "flac" {
  if (format === "m4a" || format === "m4b" || format === "mp4" || format === "alac") return "mp4";
  if (format === "flac") return "flac";
  if (format === "ogg" || format === "opus" || format === "spx") return "vorbis";
  return "mp3";
}