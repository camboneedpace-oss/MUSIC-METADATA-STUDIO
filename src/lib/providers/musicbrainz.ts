/**
 * MusicBrainz provider.
 *
 * Two endpoints are used:
 *   `/ws/2/release`        search, with an optional release-group lookup
 *   `/ws/2/release/{mbid}` full release, including the media track list
 *
 * MusicBrainz asks for a meaningful User-Agent and rate-limits anonymous
 * clients to one request per second, which is exactly what `RateLimiter` does.
 */

import {
  ProviderError,
  RateLimiter,
  buildUserAgent,
  type ArtworkCandidate,
  type MetadataProvider,
  type MetadataQuery,
  type ProviderHealth,
  type ProviderSettings,
  type Release,
  type ReleaseTrack,
} from "./types";

const BASE = "https://musicbrainz.org/ws/2";
const COVER_ART_BASE = "https://coverartarchive.org/release";

export class MusicBrainzProvider implements MetadataProvider {
  readonly id = "musicbrainz";
  readonly label = "MusicBrainz";
  readonly requiresCredentials = false;
  readonly note = "Open metadata, no account required. Rate limited to 1 request/second.";

  private limiter: RateLimiter;
  private settings: ProviderSettings;

  constructor(settings: ProviderSettings = {}) {
    this.settings = settings;
    this.limiter = new RateLimiter(1100);
  }

  configure(settings: ProviderSettings) {
    this.settings = settings;
  }

  private async getJson<T>(url: string): Promise<T> {
    return this.limiter.run(async () => {
      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            "User-Agent": buildUserAgent(this.settings, this.settings.musicBrainzEmail ?? ""),
            Accept: "application/json",
          },
        });
      } catch (err) {
        throw new ProviderError(
          `Could not reach MusicBrainz. Check your connection and the page's Content-Security-Policy. (${
            (err as Error).message
          })`,
          this.id,
        );
      }
      if (response.status === 503 || response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After") ?? 5);
        throw new ProviderError(
          "MusicBrainz is rate-limiting this client. Try again in a moment.",
          this.id,
          response.status,
          retryAfter,
        );
      }
      if (!response.ok) {
        throw new ProviderError(
          `MusicBrainz returned ${response.status} ${response.statusText}`,
          this.id,
          response.status,
        );
      }
      return (await response.json()) as T;
    });
  }

  async search(query: MetadataQuery): Promise<Release[]> {
    const lucene = buildLucene(query);
    if (!lucene) return [];
    const limit = Math.min(query.limit ?? 25, 100);
    const offset = query.offset ?? 0;
    const url =
      `${BASE}/release?query=${encodeURIComponent(lucene)}` +
      `&fmt=json&limit=${limit}&offset=${offset}`;

    const data = await this.getJson<MbReleaseSearch>(url);
    return data.releases.map(toRelease);
  }

  async getRelease(id: string): Promise<Release | null> {
    const url = `${BASE}/release/${encodeURIComponent(id)}?fmt=json&inc=recordings+artist-credits+labels`;
    try {
      const data = await this.getJson<MbRelease>(url);
      return toFullRelease(data);
    } catch (err) {
      if (err instanceof ProviderError && err.status === 404) return null;
      throw err;
    }
  }

  async getArtwork(id: string): Promise<ArtworkCandidate[]> {
    const url = `${COVER_ART_BASE}/${encodeURIComponent(id)}`;
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: "application/json" } });
    } catch (err) {
      throw new ProviderError(`Could not reach the Cover Art Archive (${(err as Error).message})`, "coverartarchive");
    }
    if (response.status === 404) return [];
    if (!response.ok) {
      throw new ProviderError(`Cover Art Archive returned ${response.status}`, "coverartarchive", response.status);
    }
    const data = (await response.json()) as MbCoverArt;
    return (data.images ?? []).map((image, i) => ({
      id: `${id}:${image.id ?? i}`,
      url: image.image ?? "",
      thumbUrl: image.thumbnails?.large ?? image.thumbnails?.small ?? image.image ?? "",
      width: image.width,
      height: image.height,
      type: image.types?.join(", ") || "Front",
      comment: image.comment,
      approved: image.approved,
    }));
  }

  async health(): Promise<ProviderHealth> {
    try {
      const started = Date.now();
      await this.getJson<{ "query-count": number }>(`${BASE}/release?query=release:%22nothing%22&fmt=json&limit=0`);
      return { ok: true, detail: `Responded in ${Date.now() - started} ms` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}

/* ---------- Lucene query construction ---------- */

function escapeLucene(value: string): string {
  return value.replace(/["\\]/g, " ").replace(/\b(AND|OR|NOT)\b/gi, " ").trim();
}

function quote(value: string): string {
  return `"${escapeLucene(value)}"`;
}

export function buildLucene(query: MetadataQuery): string {
  const parts: string[] = [];
  if (query.barcode) parts.push(`barcode:${quote(query.barcode)}`);
  if (query.catalogNumber) parts.push(`catno:${quote(query.catalogNumber)}`);
  if (query.musicBrainzId) return `rid:${query.musicBrainzId}`;

  const artist = query.artist ? quote(query.artist) : undefined;
  const album = query.album ? quote(query.album) : undefined;
  const title = query.title ? quote(query.title) : undefined;

  if (artist && album) parts.push(`artist:${artist} AND release:${album}`);
  else if (artist && title) parts.push(`artist:${artist} AND recording:${title}`);
  else if (album) parts.push(`release:${album}`);
  else if (artist) parts.push(`artist:${artist}`);
  else if (query.text) parts.push(quote(query.text));

  if (query.label) parts.push(`label:${quote(query.label)}`);
  return parts.join(" AND ");
}

/* ---------- response mapping ---------- */

interface MbArtistCredit {
  name: string;
  artist?: { id: string; name: string };
  joinphrase?: string;
}

interface MbRelease {
  id: string;
  title: string;
  date?: string;
  country?: string;
  status?: string;
  barcode?: string;
  "release-group"?: { id: string; "primary-type"?: string; "secondary-types"?: string[] };
  "artist-credit"?: MbArtistCredit[];
  media?: Array<{
    format?: string;
    position?: number;
    "track-count"?: number;
    track?: Array<{
      id: string;
      number?: string;
      position: number;
      title: string;
      length?: number;
      recording?: { id: string; title: string; length?: number };
    }>;
  }>;
  "label-info"?: Array<{
    "catalog-number"?: string;
    label?: { name?: string; id?: string };
  }>;
}

interface MbCoverArt {
  images?: Array<{
    id?: number;
    image?: string;
    thumbnails?: { small?: string; large?: string };
    width?: number;
    height?: number;
    types?: string[];
    comment?: string;
    approved?: boolean;
  }>;
}

interface MbReleaseSearch {
  releases: Array<{
    id: string;
    title: string;
    date?: string;
    country?: string;
    status?: string;
    barcode?: string;
    "artist-credit"?: MbArtistCredit[];
    media?: Array<{ format?: string; "track-count"?: number }>;
    "label-info"?: Array<{ "catalog-number"?: string; label?: { name?: string } }>;
  }>;
}

function creditNames(credits?: MbArtistCredit[]): string {
  if (!credits) return "";
  return credits.map((c) => `${c.name}${c.joinphrase ?? ""}`).join("").trim();
}

function yearOf(date?: string): number | undefined {
  if (!date) return undefined;
  const y = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(y) ? y : undefined;
}

export function coverArtUrls(releaseId: string): string[] {
  return [`${COVER_ART_BASE}/${releaseId}/front-500`, `${COVER_ART_BASE}/${releaseId}/front-1200`];
}

export function toRelease(r: MbReleaseSearch["releases"][number]): Release {
  const labelInfo = r["label-info"]?.[0];
  const totalTracks = r.media?.reduce((n, m) => n + (m["track-count"] ?? 0), 0);
  return {
    id: r.id,
    source: "musicbrainz",
    title: r.title,
    artists: [creditNames(r["artist-credit"]) || "Unknown Artist"],
    date: r.date,
    year: yearOf(r.date),
    country: r.country,
    label: labelInfo?.label?.name,
    catalogNumber: labelInfo?.["catalog-number"],
    barcode: r.barcode,
    trackCount: totalTracks,
    discCount: r.media?.length,
    formats: [...new Set(r.media?.map((m) => m.format).filter(Boolean) as string[] | undefined ?? [])],
    artworkUrls: coverArtUrls(r.id),
    tracks: [],
    media: r.media?.[0]?.format,
    status: r.status,
    url: `https://musicbrainz.org/release/${r.id}`,
  };
}

export function toFullRelease(r: MbRelease): Release {
  const tracks: ReleaseTrack[] = [];
  r.media?.forEach((medium, discIndex) => {
    medium.track?.forEach((t) => {
      tracks.push({
        position: Number.parseInt(t.number ?? String(t.position), 10) || t.position,
        title: t.title,
        length: t.recording?.length ?? t.length,
        recordingId: t.recording?.id ?? t.id,
        discNumber: discIndex + 1,
      });
    });
  });
  const labelInfo = r["label-info"]?.[0];
  return {
    id: r.id,
    source: "musicbrainz",
    title: r.title,
    artists: [creditNames(r["artist-credit"]) || "Unknown Artist"],
    albumArtist: creditNames(r["artist-credit"]) || undefined,
    date: r.date,
    year: yearOf(r.date),
    country: r.country,
    label: labelInfo?.label?.name,
    catalogNumber: labelInfo?.["catalog-number"],
    barcode: r.barcode,
    trackCount: tracks.length,
    discCount: r.media?.length,
    formats: [...new Set(r.media?.map((m) => m.format).filter(Boolean) as string[] | undefined ?? [])],
    artworkUrls: coverArtUrls(r.id),
    tracks,
    media: r.media?.[0]?.format,
    status: r.status,
    url: `https://musicbrainz.org/release/${r.id}`,
  };
}