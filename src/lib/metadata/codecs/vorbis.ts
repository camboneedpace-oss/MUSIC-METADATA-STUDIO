/**
 * Vorbis Comment codec — shared by FLAC, Ogg Vorbis, Opus, Speex and the
 * METADATA_BLOCK_PICTURE payload used to carry artwork.
 *
 * All integers are little-endian. Keys are case-insensitive ASCII; values
 * are UTF-8. We preserve every key we do not interpret, because libraries
 * routinely carry MusicBrainz IDs, AcoustID fingerprints and label IDs here.
 */

import { ByteReader, ByteWriter, probeImage, toBase64, fromBase64 } from "../binary";
import type { Artwork, ArtworkRole } from "../types";

export interface VorbisComment {
  vendor: string;
  comments: Array<[string, string]>;
}

export function parseVorbisComment(buf: Uint8Array): VorbisComment | null {
  const r = new ByteReader(buf, 0);
  const vLen = r.u32le();
  if (vLen > buf.length) return null;
  const vendor = new TextDecoder("utf-8").decode(r.slice(vLen));
  const n = r.u32le();
  const comments: Array<[string, string]> = [];
  for (let i = 0; i < n; i++) {
    const len = r.u32le();
    if (len > r.remaining) break;
    const entry = new TextDecoder("utf-8").decode(r.slice(len));
    const eq = entry.indexOf("=");
    if (eq > 0) comments.push([entry.slice(0, eq), entry.slice(eq + 1)]);
  }
  return { vendor, comments };
}

export function buildVorbisComment(vendor: string, comments: Array<[string, string]>): Uint8Array {
  const enc = new TextEncoder();
  const w = new ByteWriter(1024 + comments.length * 48);
  const v = enc.encode(vendor);
  w.u32le(v.length).bytes(v);
  w.u32le(comments.length);
  for (const [k, val] of comments) {
    const e = enc.encode(`${k}=${val}`);
    w.u32le(e.length).bytes(e);
  }
  return w.toBytes();
}

/* ---------- METADATA_BLOCK_PICTURE (base64 in comments) ---------- */

export function decodePictureBlock(b: Uint8Array): Artwork | null {
  const r = new ByteReader(b, 0);
  const type = r.u32();
  const mimeLen = r.u32();
  if (mimeLen > r.remaining) return null;
  const mime = new TextDecoder("ascii").decode(r.slice(mimeLen));
  const descLen = r.u32();
  if (descLen > r.remaining) return null;
  const description = new TextDecoder("utf-8").decode(r.slice(descLen));
  r.u32(); // width (informational)
  r.u32(); // height
  r.u32(); // colour depth
  r.u32(); // indexed colours
  const dataLen = r.u32();
  if (dataLen > r.remaining) return null;
  const data = r.slice(dataLen).slice();
  const probed = probeImage(data);
  return {
    id: `mbp-${Math.random().toString(36).slice(2, 10)}`,
    data,
    mime: mime || probed.mime,
    role: pictureRoleFromType(type),
    description: description || undefined,
    width: probed.width,
    height: probed.height,
    bytes: data.length,
  };
}

export function encodePictureBlock(art: {
  data: Uint8Array;
  mime: string;
  role: ArtworkRole;
  description?: string;
  width?: number;
  height?: number;
}): Uint8Array {
  const typeCode = { front: 3, back: 4, artist: 2, disc: 6, leaflet: 7, other: 0 }[art.role];
  const mime = new TextEncoder().encode(art.mime || "image/jpeg");
  const desc = new TextEncoder().encode(art.description ?? "");
  const w = new ByteWriter(art.data.length + 64);
  w.u32(typeCode);
  w.u32(mime.length).bytes(mime);
  w.u32(desc.length).bytes(desc);
  w.u32(art.width ?? 0).u32(art.height ?? 0).u32(0).u32(0);
  w.u32(art.data.length).bytes(art.data);
  return w.toBytes();
}

export function pictureTypeForRole(role: ArtworkRole): number {
  return { front: 3, back: 4, artist: 2, disc: 6, leaflet: 7, other: 0 }[role];
}

function pictureRoleFromType(t: number): ArtworkRole {
  switch (t) {
    case 3:
      return "front";
    case 4:
      return "back";
    case 2:
      return "artist";
    case 6:
      return "disc";
    case 7:
      return "leaflet";
    default:
      return "other";
  }
}

export function pictureToBase64Comment(art: Parameters<typeof encodePictureBlock>[0]): [string, string] {
  return ["METADATA_BLOCK_PICTURE", toBase64(encodePictureBlock(art))];
}

export function pictureFromBase64Comment(value: string): Artwork | null {
  try {
    return decodePictureBlock(fromBase64(value));
  } catch {
    return null;
  }
}

/* ---------- key mapping ---------- */

const MULTI_KEYS = new Set([
  "ARTIST",
  "ALBUMARTIST",
  "GENRE",
  "COMPOSER",
  "CONDUCTOR",
  "LABEL",
  "PERFORMER",
]);

export function isMultiKey(key: string): boolean {
  return MULTI_KEYS.has(key.toUpperCase());
}

const NUM_PAIR = /^(\d+)\s*\/\s*(\d+)/;

export function splitVorbisPair(v: string): [number | undefined, number | undefined] {
  const m = NUM_PAIR.exec(v.trim());
  if (!m) {
    const n = Number.parseInt(v.trim(), 10);
    return Number.isFinite(n) ? [n, undefined] : [undefined, undefined];
  }
  return [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10)];
}