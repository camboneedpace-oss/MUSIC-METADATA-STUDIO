import * as React from "react";
import { Disc3, Globe, Loader2, Music4, Search, WifiOff } from "lucide-react";
import { useStore, useSelectedFiles } from "../lib/store";
import { ProviderRegistry, matchFileToRelease, ProviderError } from "../lib/providers";
import type { ProviderSettings, Release } from "../lib/providers/types";
import { Button, Dialog, Field, Badge, cn } from "./ui/primitives";

const registry = new ProviderRegistry();

export function LookupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const files = useSelectedFiles();
  const settings = useStore((s) => s.settings);
  const applyEdits = useStore((s) => s.applyEdits);
  const toast = useStore((s) => s.toast);

  const [artist, setArtist] = React.useState("");
  const [album, setAlbum] = React.useState("");
  const [barcode, setBarcode] = React.useState("");
  const [catalogNumber, setCatalogNumber] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [results, setResults] = React.useState<Release[]>([]);
  const [errors, setErrors] = React.useState<Array<{ provider: string; message: string }>>([]);
  const [searched, setSearched] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const first = files[0];
    setArtist(first?.metadata.artists?.[0] ?? first?.metadata.artist ?? "");
    setAlbum(first?.metadata.album ?? "");
    setBarcode(first?.metadata.barcode ?? "");
    setCatalogNumber(first?.metadata.catalogNumber ?? "");
    setResults([]);
    setErrors([]);
    setSearched(false);
  }, [open, files]);

  const providerSettings: ProviderSettings = (settings.providers ?? {}) as ProviderSettings;
  registry.configure(providerSettings);

  const search = async () => {
    setLoading(true);
    setErrors([]);
    try {
      const outcome = await registry.searchAll(
        { artist: artist || undefined, album: album || undefined, barcode: barcode || undefined, catalogNumber: catalogNumber || undefined, limit: 25 },
        providerSettings,
      );
      setResults(outcome.results);
      setErrors(outcome.errors);
      setSearched(true);
      if (!outcome.results.length) {
        toast({ kind: "info", message: "No releases matched" });
      }
    } catch (err) {
      toast({ kind: "error", message: "Lookup failed", detail: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (release: Release) => {
    if (expanded === release.id) {
      setExpanded(null);
      return;
    }
    setExpanded(release.id);
    const provider = registry.get(release.source);
    if (!provider) return;
    try {
      const full = await provider.getRelease(release.id);
      if (full) {
        setResults((list) => list.map((r) => (r.id === full.id ? full : r)));
      }
    } catch (err) {
      toast({
        kind: "warning",
        message: "Could not load the full release",
        detail: err instanceof ProviderError ? err.message : (err as Error).message,
      });
    }
  };

  const importRelease = (release: Release, onlyMatching: boolean) => {
    const targets = onlyMatching
      ? files.filter((file) => matchFileToRelease(file, release).confidence >= 80)
      : files;
    if (!targets.length) {
      toast({ kind: "warning", message: "No file scored above 80% against this release" });
      return;
    }
    const edits = targets.map((file) => {
      const track = release.tracks.find((t) => t.position === file.metadata.trackNumber);
      const changes: Record<string, unknown> = {
        album: release.title,
        albumArtists: release.artists,
        artists: release.artists,
        year: release.year,
        label: release.label,
        catalogNumber: release.catalogNumber,
        barcode: release.barcode,
        musicBrainzReleaseId: release.source === "musicbrainz" ? release.id : undefined,
      };
      if (track?.title) changes.title = track.title;
      return { fileId: file.id, changes: changes as never };
    });
    applyEdits(edits, `Import from ${release.source}`);
    toast({
      kind: "success",
      message: `Staged ${targets.length} file(s) from ${release.source}`,
      detail: onlyMatching ? "Only files at 80% or above were updated." : undefined,
    });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Metadata lookup"
      description="Queries go to the provider only. Your audio files never leave this machine."
      width={900}
      icon={<Globe size={14} />}
      footer={
        <>
          <span className="mr-auto text-label text-[var(--text-faint)]">
            {results.length} result{results.length === 1 ? "" : "s"}
            {errors.length ? ` · ${errors.length} provider error(s)` : ""}
          </span>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5 border-b border-[var(--line)] px-4 py-3 md:grid-cols-4">
        <Field label="Artist">
          <input value={artist} onChange={(e) => setArtist(e.target.value)} className="input" />
        </Field>
        <Field label="Album / Release">
          <input value={album} onChange={(e) => setAlbum(e.target.value)} className="input" />
        </Field>
        <Field label="Barcode">
          <input value={barcode} onChange={(e) => setBarcode(e.target.value)} className="input mono" />
        </Field>
        <Field label="Catalog number">
          <input value={catalogNumber} onChange={(e) => setCatalogNumber(e.target.value)} className="input mono" />
        </Field>
        <div className="col-span-full flex items-center gap-2">
          <Button variant="primary" onClick={() => void search()} disabled={loading || (!artist && !album && !barcode && !catalogNumber)}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Search
          </Button>
          <div className="flex gap-1.5">
            {registry.all().map((p) => (
              <Badge
                key={p.id}
                tone={p.requiresCredentials && !providerSettings.discogsToken ? "warn" : "ok"}
                title={p.note}
              >
                {p.label}
                {p.requiresCredentials && !providerSettings.discogsToken ? " · token" : ""}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {errors.length ? (
        <div className="mx-4 mt-3 space-y-1 rounded-[4px] border border-[color-mix(in_oklab,var(--warn)_35%,transparent)] px-2.5 py-1.5">
          {errors.map((e) => (
            <p key={e.provider} className="flex items-start gap-1.5 text-label text-[var(--warn)]">
              <WifiOff size={11} className="mt-px shrink-0" />
              <span>
                <strong className="font-medium">{e.provider}:</strong> {e.message}
              </span>
            </p>
          ))}
        </div>
      ) : null}

      <div className="p-3">
        {searched && !results.length && !loading ? (
          <p className="py-8 text-center text-body text-[var(--text-faint)]">
            Nothing matched. Try fewer search terms, or search by barcode or catalog number.
          </p>
        ) : null}

        <div className="grid gap-2 md:grid-cols-2">
          {results.map((release) => {
            const best = files.length
              ? Math.max(...files.map((f) => matchFileToRelease(f, release).confidence))
              : 0;
            const isOpen = expanded === release.id;
            return (
              <article
                key={`${release.source}-${release.id}`}
                className="panel overflow-hidden rounded-[5px]"
              >
                <button
                  type="button"
                  onClick={() => void loadDetail(release)}
                  className="flex w-full items-start gap-2.5 p-2.5 text-left hover:bg-[var(--raised)]"
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] border border-[var(--line)] bg-[var(--chassis)] text-[var(--text-faint)]">
                    <Disc3 size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium">{release.title}</p>
                    <p className="truncate text-label text-[var(--text-dim)]">{release.artists.join(", ")}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge tone="accent">{release.source}</Badge>
                      {release.year ? <Badge>{release.year}</Badge> : null}
                      {release.country ? <Badge>{release.country}</Badge> : null}
                      {release.trackCount ? <Badge>{release.trackCount} tracks</Badge> : null}
                      {release.formats?.length ? <Badge>{release.formats.join(", ")}</Badge> : null}
                      {release.catalogNumber ? (
                        <Badge title="Catalog number">
                          <span className="mono normal-case">{release.catalogNumber}</span>
                        </Badge>
                      ) : null}
                      {release.barcode ? (
                        <Badge title="Barcode">
                          <span className="mono normal-case">{release.barcode}</span>
                        </Badge>
                      ) : null}
                      {release.artworkUrls.length ? <Badge tone="ok">Artwork</Badge> : <Badge tone="warn">No artwork</Badge>}
                    </div>
                  </div>
                  {files.length ? (
                    <div className="shrink-0 text-right">
                      <p
                        className={cn(
                          "tnum text-title font-semibold",
                          best >= 90 ? "text-[var(--ok)]" : best >= 75 ? "text-[var(--warn)]" : "text-[var(--text-faint)]",
                        )}
                      >
                        {best}%
                      </p>
                      <p className="text-micro uppercase tracking-[0.06em] text-[var(--text-faint)]">match</p>
                    </div>
                  ) : null}
                </button>

                {isOpen ? (
                  <div className="border-t border-[var(--line)] bg-[var(--chassis)] px-2.5 py-2">
                    {release.tracks.length ? (
                      <ol className="max-h-[160px] space-y-0.5 overflow-auto">
                        {release.tracks.map((t) => (
                          <li key={`${t.position}-${t.title}`} className="flex gap-2 text-label">
                            <span className="tnum w-5 shrink-0 text-[var(--text-faint)]">{t.position}</span>
                            <span className="flex-1 truncate">{t.title}</span>
                            <span className="tnum shrink-0 text-[var(--text-faint)]">
                              {t.length ? `${Math.floor(t.length / 60)}:${String(t.length % 60).padStart(2, "0")}` : ""}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-label text-[var(--text-faint)]">
                        Track list not loaded. Press again to fetch it from {release.source}.
                      </p>
                    )}
                    <div className="mt-2 flex gap-1.5">
                      <Button size="sm" variant="primary" onClick={() => importRelease(release, true)}>
                        <Music4 size={11} /> Apply to matching files
                      </Button>
                      <Button size="sm" onClick={() => importRelease(release, false)}>
                        Apply to all {files.length}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}