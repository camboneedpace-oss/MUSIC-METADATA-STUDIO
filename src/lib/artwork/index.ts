/**
 * Artwork handling: transform, encode, resize and object URLs.
 *
 * Full-resolution covers are never held in component state. Everything the
 * grid renders goes through a thumbnail cache keyed by a cheap hash, and the
 * object URLs are revoked when the library unloads.
 */

import { probeImage } from "../metadata/binary";
import type { Artwork, ArtworkRole } from "../metadata/types";

export const ARTWORK_ROLES: ArtworkRole[] = ["front", "back", "disc", "artist", "leaflet", "other"];

export const THUMBNAIL_SIZES = [32, 48, 96, 240] as const;

const urlCache = new Map<string, string>();
const thumbCache = new Map<string, string>();

/** A stable, cheap key for cache lookups. */
export function artworkKey(art: Artwork): string {
  return `${art.bytes}-${art.mime}-${art.role}-${art.width}x${art.height}-${hashBytes(art.data, 24)}`;
}

function hashBytes(data: Uint8Array, sample: number): string {
  // FNV-1a over a strided sample: enough to distinguish images without hashing
  // megabytes on every render.
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(data.length / sample));
  for (let i = 0; i < data.length; i += step) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function toBlobUrl(cacheKey: string, data: Uint8Array, mime: string): string {
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  urlCache.set(cacheKey, url);
  return url;
}

/** Full-size object URL for previewing or exporting. */
export function fullArtworkUrl(art: Artwork): string {
  const k = artworkKey(art);
  const existing = urlCache.get(k);
  if (existing) return existing;
  // The cache must be written under the same key it is read with, or every
  // render allocates a fresh object URL and leaks the previous one.
  return toBlobUrl(k, art.data, art.mime);
}

const thumbPromises = new Map<string, Promise<string>>();

/**
 * Thumbnail object URL, resolved asynchronously. Callers get a placeholder
 * first and swap in the URL when the promise settles, so the grid never
 * blocks on image decoding.
 */
export function loadThumbnail(art: Artwork, size = 48): Promise<string> {
  const k = `${artworkKey(art)}@${size}`;
  const cached = thumbCache.get(k);
  if (cached) return Promise.resolve(cached);
  const pending = thumbPromises.get(k);
  if (pending) return pending;

  const promise = makeThumbnail(art, size).then((url) => {
    thumbCache.set(k, url);
    thumbPromises.delete(k);
    return url;
  });
  thumbPromises.set(k, promise);
  return promise;
}

async function makeThumbnail(art: Artwork, size: number): Promise<string> {
  const full = fullArtworkUrl(art);
  if (typeof createImageBitmap !== "function" || art.bytes < 4096) return full;
  try {
    const bitmap = await createImageBitmap(new Blob([toArrayBuffer(art.data)], { type: art.mime }));
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return full;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    return blob ? URL.createObjectURL(blob) : full;
  } catch {
    return full;
  }
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

export function releaseArtworkCache() {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  for (const url of thumbCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
  thumbCache.clear();
  thumbPromises.clear();
}

export function thumbnailCacheSize(): number {
  return thumbCache.size;
}

/* ---------- transforms ---------- */

export interface TransformOptions {
  /** Longest edge in pixels. */
  maxSize?: number;
  cropSquare?: boolean;
  outputMime?: "image/jpeg" | "image/png" | "image/webp";
  quality?: number;
  /** JPEG/WebP have no alpha; this is the matte colour. */
  background?: string;
}

export interface TransformResult {
  data: Uint8Array;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  warning?: string;
}

const MIME_TO_FORMAT: Record<string, "jpeg" | "png" | "webp"> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Reject image types a container cannot legally store. MP4 `covr` accepts
 * JPEG and PNG only; ID3 and Vorbis accept anything.
 */
export function isArtworkMimeSupported(container: "mp3" | "mp4" | "vorbis" | "flac", mime: string): boolean {
  const kind = MIME_TO_FORMAT[mime];
  if (!kind) return false;
  if (container === "mp4") return kind === "jpeg" || kind === "png";
  return true;
}

export async function transformArtwork(
  art: Artwork,
  options: TransformOptions = {},
): Promise<TransformResult> {
  const outMime = options.outputMime ?? "image/jpeg";
  const quality = options.quality ?? 0.9;
  const original = probeImage(art.data);

  if (typeof createImageBitmap !== "function") {
    return {
      data: art.data,
      mime: art.mime,
      width: original.width,
      height: original.height,
      bytes: art.bytes,
      warning: "Image processing is unavailable in this browser; the original bytes were kept",
    };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([toArrayBuffer(art.data)], { type: art.mime }));
  } catch {
    return {
      data: art.data,
      mime: art.mime,
      width: original.width,
      height: original.height,
      bytes: art.bytes,
      warning: "The embedded image could not be decoded; the original bytes were kept",
    };
  }

  let sx = 0;
  let sy = 0;
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (options.cropSquare) {
    const side = Math.min(bitmap.width, bitmap.height);
    sx = (bitmap.width - side) / 2;
    sy = (bitmap.height - side) / 2;
    sw = side;
    sh = side;
  }

  let scale = 1;
  if (options.maxSize && Math.max(sw, sh) > options.maxSize) {
    scale = options.maxSize / Math.max(sw, sh);
  }
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return {
      data: art.data,
      mime: art.mime,
      width: original.width,
      height: original.height,
      bytes: art.bytes,
      warning: "Canvas is unavailable; the original bytes were kept",
    };
  }
  if (outMime === "image/jpeg") {
    ctx.fillStyle = options.background ?? "#000000";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outMime, quality));
  if (!blob) {
    return {
      data: art.data,
      mime: art.mime,
      width: original.width,
      height: original.height,
      bytes: art.bytes,
      warning: "Encoding failed; the original bytes were kept",
    };
  }
  const buf = new Uint8Array(await blob.arrayBuffer());
  return { data: buf, mime: outMime, width: w, height: h, bytes: buf.length };
}

export function makeArtwork(
  result: TransformResult,
  role: ArtworkRole,
  description?: string,
): Artwork {
  return {
    id: `art-${Math.random().toString(36).slice(2, 10)}`,
    data: result.data,
    mime: result.mime,
    role,
    description,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
  };
}

/** Average colour of the artwork, used as a placeholder tint. */
export async function dominantColour(art: Artwork): Promise<string | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(new Blob([toArrayBuffer(art.data)], { type: art.mime }));
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, 8, 8);
    bitmap.close();
    const { data } = ctx.getImageData(0, 0, 8, 8);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
    if (!n) return null;
    return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
  } catch {
    return null;
  }
}

/* ---------- grouping for batch artwork ---------- */

export function albumGroupKey(name: string, album: string): string {
  return `${name.trim().toLowerCase()} ${album.trim().toLowerCase()}`;
}

export function groupByAlbum<T extends { metadata: { album?: string; albumArtists?: string[]; artists?: string[]; albumArtist?: string; artist?: string } }>(
  files: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const file of files) {
    const artist =
      file.metadata.albumArtists?.[0] ??
      file.metadata.albumArtist ??
      file.metadata.artists?.[0] ??
      file.metadata.artist ??
      "";
    const key = albumGroupKey(artist, file.metadata.album ?? "");
    const list = map.get(key);
    if (list) list.push(file);
    else map.set(key, [file]);
  }
  return map;
}