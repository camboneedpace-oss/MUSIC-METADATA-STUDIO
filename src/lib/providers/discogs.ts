/**
 * Discogs provider.
 *
 * Discogs requires a personal access token for authenticated endpoints and
 * asks clients to stay at 60 requests/minute without one. Credentials are
 * entered by the user in Settings and kept in the browser only.
 */

import {
  ProviderError,
  RateLimiter,
  type ArtworkCandidate,
  type MetadataProvider,
  type MetadataQuery,
  type ProviderHealth,
  type ProviderSettings,
  type Release,
} from "./types";

const BASE = "https://api.discogs.com";
const WEB = "https://www.discogs.com";

export class DiscogsProvider implements MetadataProvider {
  readonly id = "discogs";
  readonly label = "Discogs";
  readonly requiresCredentials = true;
  readonly note = "Needs a personal access token from discogs.com/settings/developers. 60 requests/minute.";

  private limiter: RateLimiter;
  private settings: ProviderSettings;

  constructor(settings: ProviderSettings = {}) {
    this.settings = settings;
    this.limiter = new RateLimiter(settings.discogsRateLimit ? 60000 / settings.discogsRateLimit : 1100);
  }

  configure(settings: ProviderSettings) {
    this.settings = settings;
    this.limiter = new RateLimiter(settings.discogsRateLimit ? 60000 / settings.discogsRateLimit : 1100);
  }

  get configured(): boolean {
    return Boolean(this.settings.discogsToken);
  }

  private async getJson<T>(url: string): Promise<T> {
    if (!this.configured) {
      throw new ProviderError(
        "Discogs needs a personal access token. Add it in Settings → Providers.",
        this.id,
        401,
      );
    }
    return this.limiter.run(async () => {
      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            Authorization: `Discogs token=${this.settings.discogsToken}`,
            Accept: "application/json",
          },
        });
      } catch (err) {
        throw new ProviderError(`Could not reach Discogs (${(err as Error).message})`, this.id);
      }
      const remaining = response.headers.get("X-Discogs-Ratelimit-Remaining");
      void remaining;
      if (response.status === 429) {
        throw new ProviderError(
          "Discogs rate limit reached. Wait a minute before retrying.",
          this.id,
          429,
          60,
        );
      }
      if (response.status === 401) {
        throw new ProviderError("The Discogs token was rejected.", this.id, 401);
      }
      if (!response.ok) {
        throw new ProviderError(`Discogs returned ${response.status} ${response.statusText}`, this.id, response.status);
      }
      return (await response.json()) as T;
    });
  }

  async search(query: MetadataQuery): Promise<Release[]> {
    const params = new URLSearchParams();
    if (query.barcode) params.set("barcode", query.barcode);
    if (query.catalogNumber) params.set("catno", query.catalogNumber);
    if (query.label) params.set("label", query.label);
    if (query.artist && query.album) {
      params.set("artist", query.artist);
      params.set("release_title", query.album);
    } else if (query.album) {
      params.set("release_title", query.album);
    } else if (query.artist) {
      params.set("q", query.artist);
    } else if (query.text) {
      params.set("q", query.text);
    }
    params.set("type", "release");
    params.set("per_page", String(Math.min(query.limit ?? 25, 100)));
    if (query.offset) params.set("page", String(Math.floor(query.offset / 25) + 1));

    const data = await this.getJson<{ results: DiscogsSearchResult[] }>(
      `${BASE}/database/search?${params.toString()}`,
    );
    return data.results.map((r) => toRelease(r, query.artist));
  }

  async getRelease(id: string): Promise<Release | null> {
    try {
      const data = await this.getJson<DiscogsRelease>(`${BASE}/releases/${encodeURIComponent(id)}`);
      return toFullRelease(data);
    } catch (err) {
      if (err instanceof ProviderError && err.status === 404) return null;
      throw err;
    }
  }

  async getArtwork(id: string): Promise<ArtworkCandidate[]> {
    const data = await this.getJson<{ images?: DiscogsImage[]; title?: string }>(
      `${BASE}/releases/${encodeURIComponent(id)}`,
    );
    return (data.images ?? []).map((image, i) => ({
      id: `${id}:${i}`,
      url: image.uri,
      thumbUrl: image.uri150 ?? image.uri,
      width: image.width,
      height: image.height,
      type: image.type,
      approved: true,
    }));
  }

  async health(): Promise<ProviderHealth> {
    if (!this.configured) return { ok: false, detail: "No token configured" };
    try {
      await this.getJson<{ user?: { username?: string } }>(`${BASE}/oauth/identity`);
      return { ok: true, detail: "Token accepted" };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}

/* ---------- response mapping ---------- */

interface DiscogsSearchResult {
  id: number;
  type: string;
  title: string;
  year?: number;
  country?: string;
  format?: string[];
  label?: string[];
  catno?: string;
  barcode?: string[];
  cover_image?: string;
  thumb?: string;
}

interface DiscogsImage {
  type: string;
  uri: string;
  uri150?: string;
  width?: number;
  height?: number;
}

interface DiscogsRelease extends DiscogsSearchResult {
  released?: string;
  genres?: string[];
  styles?: string[];
  artists?: Array<{ name: string; join?: string }>;
  tracklist?: Array<{
    position: string;
    title: string;
    type_: string;
    duration?: string;
    extraartists?: Array<{ name: string; role?: string }>;
  }>;
  images?: DiscogsImage[];
  notes?: string;
}

export function splitDiscogsTitle(title: string, artist?: string): { artists: string; album: string } {
  // Discogs encodes the artist into the release title for non-compilations.
  const dash = title.split(" - ");
  if (dash.length >= 2) {
    return { artists: dash.slice(0, -1).join(" - "), album: dash[dash.length - 1] };
  }
  return { artists: artist ?? "", album: title };
}

export function toRelease(r: DiscogsSearchResult, artistHint?: string): Release {
  const split = splitDiscogsTitle(r.title, artistHint);
  return {
    id: String(r.id),
    source: "discogs",
    title: split.album,
    artists: split.artists ? [split.artists] : ["Unknown Artist"],
    albumArtist: split.artists || undefined,
    year: r.year,
    date: r.year ? String(r.year) : undefined,
    country: r.country,
    label: r.label?.[0],
    catalogNumber: r.catno,
    barcode: r.barcode?.[0],
    formats: r.format ?? [],
    artworkUrls: r.cover_image ? [r.cover_image] : [],
    tracks: [],
    media: r.format?.join(", "),
    url: `${WEB}/release/${r.id}`,
  };
}

export function toFullRelease(r: DiscogsRelease): Release {
  const split = splitDiscogsTitle(r.title);
  const tracks = (r.tracklist ?? [])
    .filter((t) => t.type_ === "track")
    .map((t) => ({
      position: Number.parseInt(t.position, 10) || 0,
      title: t.title,
      length: parseDuration(t.duration),
      artist: t.extraartists?.find((a) => /written|music/i.test(a.role ?? ""))?.name,
    }));

  return {
    id: String(r.id),
    source: "discogs",
    title: split.album,
    artists: r.artists?.map((a) => `${a.name}${a.join ?? ""}`) ?? split.artists
      ? [r.artists?.map((a) => `${a.name}${a.join ?? ""}`).join("") || split.artists]
      : ["Unknown Artist"],
    albumArtist: split.artists || undefined,
    year: r.year,
    date: r.released ?? (r.year ? String(r.year) : undefined),
    country: r.country,
    label: r.label?.[0],
    catalogNumber: r.catno,
    barcode: r.barcode?.[0],
    trackCount: tracks.length,
    discCount: 1,
    formats: r.format ?? [],
    artworkUrls: r.images?.map((i) => i.uri) ?? (r.cover_image ? [r.cover_image] : []),
    tracks,
    media: r.format?.join(", "),
    url: `${WEB}/release/${r.id}`,
  };
}

/** Discogs durations arrive as `3:45` or `3:45.123`. */
export function parseDuration(value?: string): number | undefined {
  if (!value) return undefined;
  const parts = value.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}