/**
 * Provider interfaces.
 *
 * Every online source implements the same shapes, so the UI never knows which
 * service produced a result and adding a source is a single file.
 */

import type { Artwork } from "../metadata/types";

export interface MetadataQuery {
  artist?: string;
  album?: string;
  title?: string;
  trackNumber?: number;
  barcode?: string;
  catalogNumber?: string;
  label?: string;
  musicBrainzId?: string;
  /** Free text across all fields. */
  text?: string;
  limit?: number;
  offset?: number;
}

export interface TrackCredit {
  name: string;
  role?: string;
  /** "artist", "composer", "producer", … */
  type?: string;
  joinPhrase?: string;
}

export interface ReleaseTrack {
  position: number;
  title: string;
  length?: number;
  artist?: string;
  recordingId?: string;
  discNumber?: number;
}

export interface Release {
  id: string;
  /** Which provider produced this. */
  source: string;
  title: string;
  artists: string[];
  albumArtist?: string;
  date?: string;
  year?: number;
  country?: string;
  label?: string;
  catalogNumber?: string;
  barcode?: string;
  trackCount?: number;
  discCount?: number;
  formats?: string[];
  /** Score the provider assigned to its own result. */
  score?: number;
  artworkUrls: string[];
  tracks: ReleaseTrack[];
  /** ISO currency / media type detail the provider returned. */
  media?: string;
  status?: string;
  url?: string;
}

export interface ArtworkCandidate {
  id: string;
  url: string;
  /** Small version, for the grid. */
  thumbUrl: string;
  width?: number;
  height?: number;
  /** "Front", "Back", "Booklet", … */
  type?: string;
  comment?: string;
  /** True when the provider is happy for us to rehost it. */
  approved?: boolean;
}

export interface MetadataProvider {
  readonly id: string;
  readonly label: string;
  /** Does this provider need user-supplied credentials? */
  readonly requiresCredentials: boolean;
  /** Short note shown in Settings. */
  readonly note?: string;
  search(query: MetadataQuery): Promise<Release[]>;
  getRelease(id: string): Promise<Release | null>;
  getArtwork(id: string): Promise<ArtworkCandidate[]>;
  /** Non-fatal provider health, shown in the status bar. */
  health?(): Promise<ProviderHealth>;
}

export interface ProviderHealth {
  ok: boolean;
  detail: string;
  /** Seconds the caller should wait before retrying. */
  retryAfter?: number;
}

export interface ProviderSettings {
  /** Discogs requires a personal access token for most endpoints. */
  discogsToken?: string;
  musicBrainzEmail?: string;
  userAgentApp?: string;
  /** Requests per minute, per provider. */
  discogsRateLimit?: number;
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  userAgentApp: "UniversalMusicMetadataStudio/1.0 ( local-first tagging tool )",
};

export class ProviderError extends Error {
  provider: string;
  status?: number;
  retryAfter?: number;

  constructor(message: string, provider: string, status?: number, retryAfter?: number) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Providers must identify themselves; MusicBrainz requires contact details. */
export function buildUserAgent(settings: ProviderSettings, contact = ""): string {
  const app = settings.userAgentApp ?? DEFAULT_PROVIDER_SETTINGS.userAgentApp!;
  return contact ? `${app} ${contact}` : app;
}

/** Minimal exponential backoff helper shared by every provider. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  onRetry?: (waitMs: number) => void,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (err instanceof ProviderError && err.status && err.status < 500 && err.status !== 429) break;
      if (i === attempts - 1) break;
      const wait = Math.min(4000, 400 * 2 ** i);
      onRetry?.(wait);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastError;
}

/** Sequential fetches with a minimum interval, to respect rate limits. */
export class RateLimiter {
  private last = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private minIntervalMs: number;

  constructor(minIntervalMs: number) {
    this.minIntervalMs = minIntervalMs;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const wait = this.minIntervalMs - (Date.now() - this.last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}

export function toArtwork(candidates: ArtworkCandidate[]): Artwork[] {
  return candidates.map((c) => ({
    id: c.id,
    data: new Uint8Array(0),
    mime: "image/jpeg",
    role: "front",
    description: c.type,
    width: c.width ?? 0,
    height: c.height ?? 0,
    bytes: 0,
  }));
}