/**
 * APEv2 codec — used by Musepack, WavPack, Monkey's Audio, OptimFROG, TAK.
 *
 * APEv2 is a flat key/value block. Keys are case-sensitive ASCII and files in
 * the wild mix conventions, so reads match case-insensitively and writes use
 * the Monkey's Audio spelling. Unknown keys keep their original casing.
 */

import { ByteReader, ByteWriter, concatBytes, trimNul } from "../binary";
import type { Artwork, AudioProperties, MusicMetadata, RawTag, ReadResult } from "../types";
import { probeImage } from "../binary";

const APE_MAGIC = "APETAGEX";
export const APE_FOOTER_SIZE = 32;
const FLAG_HAS_HEADER = 1 << 31;
const FLAG_NO_FOOTER = 1 << 30;
const FLAG_IS_HEADER = 1 << 29;

export function isApeTagAt(b: Uint8Array, offset: number): boolean {
  if (offset + 8 > b.length) return false;
  for (let i = 0; i < 8; i++) if (b[offset + i] !== APE_MAGIC.charCodeAt(i)) return false;
  return true;
}

export interface ApeItem {
  key: string;
  value: string;
  flags: number;
  /** Byte offset of the item within the file (absolute). */
  offset: number;
  bytes: number;
}

export interface ApeParse extends ReadResult {
  items: ApeItem[];
  /** Absolute [start,end) of the tag, header included. */
  tagStart: number;
  tagEnd: number;
  atHeader: boolean;
  hasHeader: boolean;
  version: number;
}

/**
 * Parse an APE tag. `tagBytes` must be exactly the tag region (header +
 * items + footer, as laid out in the file); `absOffset` is where that region
 * starts in the file so preserved items can report absolute offsets.
 */
export function parseApeTag(tagBytes: Uint8Array, absOffset: number, atHeader: boolean): ApeParse | null {
  if (tagBytes.length < APE_FOOTER_SIZE) return null;
  const r = new ByteReader(tagBytes, tagBytes.length - APE_FOOTER_SIZE);
  r.ascii(8);
  const version = r.u32le();
  const tagSize = r.u32le();
  const itemCount = r.u32le();
  const flags = r.u32le();
  r.u64le();
  if (tagSize < APE_FOOTER_SIZE || tagSize > tagBytes.length) return null;

  const hasHeader = (flags & FLAG_HAS_HEADER) !== 0;
  const hasFooter = (flags & FLAG_NO_FOOTER) === 0;
  const itemStart = hasHeader ? APE_FOOTER_SIZE : 0;
  const itemEnd = tagSize - (hasFooter ? APE_FOOTER_SIZE : 0);

  const items: ApeItem[] = [];
  const metadata = {} as MusicMetadata;
  const raw: RawTag[] = [];
  const warnings: string[] = [];
  const artwork: Artwork[] = [];
  const custom: Record<string, string> = {};
  const ir = new ByteReader(tagBytes, itemStart);

  for (let i = 0; i < itemCount && ir.pos < itemEnd; i++) {
    const itemOffset = absOffset + ir.pos;
    const valueSize = ir.u32le();
    const itemFlags = ir.u32le();
    let key = "";
    while (!ir.eof) {
      const c = ir.u8();
      if (c === 0) break;
      key += String.fromCharCode(c);
    }
    if (valueSize > ir.remaining || ir.pos + valueSize > itemEnd) {
      warnings.push(`APE item "${key}" is truncated`);
      break;
    }
    const valueBytes = ir.slice(valueSize).slice();
    const isCover = key.toLowerCase().startsWith("cover art");
    items.push({
      key,
      value: isCover ? "" : trimNul(new TextDecoder("utf-8").decode(valueBytes)),
      flags: itemFlags,
      offset: itemOffset,
      bytes: valueSize + 8 + key.length + 1,
    });
    assignApeItem(key, valueBytes, metadata, artwork, custom);
    raw.push({ key, values: [describeValue(key, valueBytes)] });
  }

  metadata.artwork = artwork;
  if (Object.keys(custom).length) metadata.customFields = custom;

  return {
    items,
    tagStart: absOffset,
    tagEnd: absOffset + tagSize,
    atHeader,
    hasHeader,
    version,
    metadata,
    raw,
    audio: {} as AudioProperties,
    formatInfo: {
      tagScheme: "APEv2",
      tagVersion: version >= 2000 ? "APEv2" : "APEv1",
      preservedUnknown: true,
    },
    warnings,
    layout: {
      headStart: atHeader ? 0 : absOffset,
      headEnd: atHeader ? tagSize : absOffset,
      tailStart: atHeader ? absOffset : absOffset,
      tailEnd: atHeader ? absOffset : tagSize,
      variant: { container: "ape", version, atHeader },
    },
  };
}

/** Locate and slice the APE tag region of a file, if present. */
export function findApeTag(file: Uint8Array): { tag: Uint8Array; offset: number; atHeader: boolean } | null {
  if (isApeTagAt(file, 0)) {
    const size = readTagSize(file, 0);
    if (size > 0 && size <= file.length) return { tag: file.subarray(0, size), offset: 0, atHeader: true };
  }
  const end = file.length;
  if (end < APE_FOOTER_SIZE || !isApeTagAt(file, end - APE_FOOTER_SIZE)) return null;
  const size = readTagSize(file, end - APE_FOOTER_SIZE);
  if (size <= 0 || size > file.length) return null;
  const offset = end - size;
  return { tag: file.subarray(offset, end), offset, atHeader: false };
}

function readTagSize(file: Uint8Array, footerAt: number): number {
  const dv = new DataView(file.buffer, file.byteOffset + footerAt + 12, 4);
  return dv.getUint32(0, true);
}

function describeValue(key: string, bytes: Uint8Array): string {
  const k = key.toLowerCase();
  if (k === "cover art (front)" || k.startsWith("cover art")) return `${bytes.length} image bytes`;
  return trimNul(new TextDecoder("utf-8").decode(bytes));
}

const MULTI = new Set(["artist", "album artist", "genre", "composer", "conductor", "label"]);

function assignApeItem(
  key: string,
  bytes: Uint8Array,
  metadata: MusicMetadata,
  artwork: Artwork[],
  custom: Record<string, string>,
) {
  const k = key.toLowerCase();
  if (k === "cover art (front)" || k === "cover art (back)" || k === "cover art") {
    const probed = probeImage(bytes);
    artwork.push({
      id: `ape-${Math.random().toString(36).slice(2, 10)}`,
      data: bytes,
      mime: probed.mime,
      role: k === "cover art (back)" ? "back" : "front",
      width: probed.width,
      height: probed.height,
      bytes: bytes.length,
    });
    return;
  }
  const text = trimNul(new TextDecoder("utf-8").decode(bytes));
  const push = (field: "artists" | "albumArtists" | "genres" | "composers") => {
    (metadata[field] ??= []).push(text);
  };

  switch (k) {
    case "title":
      metadata.title = text;
      break;
    case "artist":
      push("artists");
      break;
    case "album":
      metadata.album = text;
      break;
    case "album artist":
    case "albumartist":
      push("albumArtists");
      break;
    case "composer":
      push("composers");
      break;
    case "conductor":
      metadata.conductor = text;
      break;
    case "comment":
      metadata.comment = text;
      break;
    case "grouping":
      metadata.grouping = text;
      break;
    case "year":
    case "date": {
      const m = /(\d{4})/.exec(text);
      metadata.date = text;
      if (m) metadata.year = Number.parseInt(m[1], 10);
      break;
    }
    case "track": {
      const [n, t] = splitPair(text);
      if (n !== undefined) metadata.trackNumber = n;
      if (t !== undefined) metadata.trackTotal = t;
      break;
    }
    case "disc": {
      const [n, t] = splitPair(text);
      if (n !== undefined) metadata.discNumber = n;
      if (t !== undefined) metadata.discTotal = t;
      break;
    }
    case "genre":
      push("genres");
      break;
    case "copyright":
      metadata.copyright = text;
      break;
    case "publisher":
      metadata.publisher = text;
      break;
    case "label":
      metadata.label = text;
      break;
    case "isrc":
      metadata.isrc = text;
      break;
    case "barcode":
      metadata.barcode = text;
      break;
    case "catalognumber":
      metadata.catalogNumber = text;
      break;
    case "lyrics":
      metadata.lyrics = text;
      break;
    case "language":
      metadata.language = text;
      break;
    case "bpm": {
      const n = Math.round(Number.parseFloat(text));
      if (Number.isFinite(n)) metadata.bpm = n;
      break;
    }
    case "compilation":
      metadata.compilation = /^(1|yes|true)$/i.test(text);
      break;
    case "musicians credits":
    case "initial key":
    case "initialkey":
      metadata.key = text;
      break;
    case "musicbrainz track id":
    case "musicbrainz_trackid":
      metadata.musicBrainzRecordingId = text;
      break;
    case "musicbrainz album id":
    case "musicbrainz_albumid":
      metadata.musicBrainzReleaseId = text;
      break;
    case "replaygain_track_gain":
      metadata.replayGainTrackGain = text;
      break;
    case "replaygain_track_peak":
      metadata.replayGainTrackPeak = text;
      break;
    case "replaygain_album_gain":
      metadata.replayGainAlbumGain = text;
      break;
    case "replaygain_album_peak":
      metadata.replayGainAlbumPeak = text;
      break;
    default:
      if (MULTI.has(k) || key.length > 0) custom[key] = text;
      break;
  }
}

function splitPair(v: string): [number | undefined, number | undefined] {
  const m = /^(\d+)\s*\/\s*(\d+)/.exec(v.trim());
  if (m) return [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10)];
  const n = Number.parseInt(v.trim(), 10);
  return Number.isFinite(n) ? [n, undefined] : [undefined, undefined];
}

/* ---------------- writing ---------------- */

const APE_KEY_CASE: Record<string, string> = {
  TITLE: "Title",
  ARTIST: "Artist",
  ALBUM: "Album",
  ALBUMARTIST: "Album Artist",
  COMPOSER: "Composer",
  CONDUCTOR: "Conductor",
  COMMENT: "Comment",
  GROUPING: "Grouping",
  GENRE: "Genre",
  DATE: "Date",
  YEAR: "Year",
  TRACKNUMBER: "Track",
  DISCNUMBER: "Disc",
  COPYRIGHT: "Copyright",
  PUBLISHER: "Publisher",
  LABEL: "Label",
  ISRC: "ISRC",
  BARCODE: "Barcode",
  CATALOGNUMBER: "CatalogNumber",
  LYRICS: "Lyrics",
  LANGUAGE: "Language",
  BPM: "BPM",
  COMPILATION: "Compilation",
  ENCODER: "EncodedBy",
  REPLAYGAIN_TRACK_GAIN: "REPLAYGAIN_TRACK_GAIN",
  REPLAYGAIN_TRACK_PEAK: "REPLAYGAIN_TRACK_PEAK",
  REPLAYGAIN_ALBUM_GAIN: "REPLAYGAIN_ALBUM_GAIN",
  REPLAYGAIN_ALBUM_PEAK: "REPLAYGAIN_ALBUM_PEAK",
  MUSICBRAINZ_TRACKID: "MUSICBRAINZ_TRACKID",
  MUSICBRAINZ_ALBUMID: "MUSICBRAINZ_ALBUMID",
  MUSICBRAINZ_RELEASEGROUPID: "MUSICBRAINZ_RELEASEGROUPID",
  MUSICBRAINZ_WORKID: "MUSICBRAINZ_WORKID",
};

const MANAGED = new Set(Object.keys(APE_KEY_CASE));

export function buildApeTag(metadata: MusicMetadata, preserved: ApeItem[]): Uint8Array {
  const entries: Array<[string, Uint8Array, boolean]> = []; // key, value, utf8

  const pushText = (upperKey: string, value: string | undefined) => {
    if (value === undefined || value === "") return;
    entries.push([APE_KEY_CASE[upperKey] ?? upperKey, new TextEncoder().encode(value), true]);
  };

  pushText("TITLE", metadata.title);
  for (const v of metadata.artists ?? []) pushText("ARTIST", v);
  pushText("ALBUM", metadata.album);
  for (const v of metadata.albumArtists ?? []) pushText("ALBUMARTIST", v);
  for (const v of metadata.composers ?? []) pushText("COMPOSER", v);
  pushText("CONDUCTOR", metadata.conductor);
  pushText("COMMENT", metadata.comment);
  pushText("GROUPING", metadata.grouping);
  for (const v of metadata.genres ?? []) pushText("GENRE", v);
  if (metadata.date) pushText("DATE", metadata.date);
  else if (metadata.year !== undefined) pushText("YEAR", String(metadata.year));
  if (metadata.trackNumber !== undefined) {
    pushText("TRACKNUMBER", metadata.trackTotal ? `${metadata.trackNumber}/${metadata.trackTotal}` : String(metadata.trackNumber));
  }
  if (metadata.discNumber !== undefined) {
    pushText("DISCNUMBER", metadata.discTotal ? `${metadata.discNumber}/${metadata.discTotal}` : String(metadata.discNumber));
  }
  pushText("COPYRIGHT", metadata.copyright);
  pushText("PUBLISHER", metadata.publisher);
  pushText("LABEL", metadata.label);
  pushText("ISRC", metadata.isrc);
  pushText("BARCODE", metadata.barcode);
  pushText("CATALOGNUMBER", metadata.catalogNumber);
  pushText("LYRICS", metadata.lyrics);
  pushText("LANGUAGE", metadata.language);
  if (metadata.bpm !== undefined) pushText("BPM", String(metadata.bpm));
  if (metadata.compilation !== undefined) pushText("COMPILATION", metadata.compilation ? "1" : "0");
  pushText("KEY", metadata.key);
  pushText("REPLAYGAIN_TRACK_GAIN", metadata.replayGainTrackGain);
  pushText("REPLAYGAIN_TRACK_PEAK", metadata.replayGainTrackPeak);
  pushText("REPLAYGAIN_ALBUM_GAIN", metadata.replayGainAlbumGain);
  pushText("REPLAYGAIN_ALBUM_PEAK", metadata.replayGainAlbumPeak);
  pushText("MUSICBRAINZ_TRACKID", metadata.musicBrainzRecordingId);
  pushText("MUSICBRAINZ_ALBUMID", metadata.musicBrainzReleaseId);
  pushText("MUSICBRAINZ_RELEASEGROUPID", metadata.musicBrainzReleaseGroupId);
  pushText("MUSICBRAINZ_WORKID", metadata.musicBrainzWorkId);

  const front = metadata.artwork?.[0];
  if (front) entries.push(["Cover Art (Front)", front.data, false]);

  for (const [k, v] of Object.entries(metadata.customFields ?? {})) {
    if (k.startsWith("_")) continue;
    entries.push([k, new TextEncoder().encode(v), true]);
  }

  for (const item of preserved) {
    if (MANAGED.has(item.key.toUpperCase())) continue;
    if (item.key.toLowerCase().startsWith("cover art")) continue;
    entries.push([item.key, new TextEncoder().encode(item.value), true]);
  }

  const body = new ByteWriter(2048);
  for (const [key, value, utf8] of entries) {
    body.u32le(value.length);
    // bit 0 = read-only text, bit 1 = binary; bit 2 marks UTF-8 text.
    body.u32le(utf8 ? 0x0000 : 0x0002);
    body.ascii(key).u8(0).bytes(value);
  }

  const bodyLen = body.length;
  const tagSize = bodyLen + APE_FOOTER_SIZE * 2;
  const flags = FLAG_HAS_HEADER | FLAG_IS_HEADER;
  const footerFlags = FLAG_HAS_HEADER;
  const mk = (isHeader: boolean) => {
    const w = new ByteWriter(APE_FOOTER_SIZE);
    w.ascii(APE_MAGIC).u32le(2000).u32le(tagSize).u32le(entries.length);
    w.u32le(isHeader ? flags : footerFlags).u64le(0);
    return w.toBytes();
  };
  return concatBytes(mk(true), body.toBytes(), mk(false));
}