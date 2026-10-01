/**
 * WAV codec — RIFF INFO (`LIST INFO`) plus an optional embedded `id3 ` chunk.
 *
 * RIFF INFO is the widely-supported native tag; it is ASCII by definition,
 * so non-Latin text is written through the `id3 ` chunk alongside it rather
 * than mangled into Latin-1.
 */

import { ByteReader, ByteWriter, concatBytes, trimNul } from "../binary";
import type { AudioProperties, MusicMetadata, RawTag, ReadResult, WriteResult } from "../types";
import {
  buildId3v2,
  extractId3,
  parseId3v2,
  type Id3Frame,
} from "./id3";

export function isWav(b: Uint8Array): boolean {
  return b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.subarray(8, 12)) === "WAVE";
}

const INFO_MAP: Record<string, keyof MusicMetadata> = {
  INAM: "title",
  IART: "artists",
  IPRD: "album",
  ICMT: "comment",
  ICRD: "date",
  IGNR: "genres",
  ITRK: "trackNumber",
  ICOP: "copyright",
  ISFT: "encoder",
  ILNG: "language",
  IMUS: "composers",
  IKEY: "key",
  IGRP: "grouping",
  IENG: "comment",
};

export interface WavParse extends ReadResult {
  /** Chunk layout, so a write can rebuild the RIFF spine. */
  chunks: Array<{ type: string; start: number; size: number; data: Uint8Array }>;
  preservedInfo: Array<[string, string]>;
  id3Frames: Id3Frame[];
  fileSize: number;
}

export function readWav(head: Uint8Array): WavParse | null {
  if (!isWav(head)) return null;
  const warnings: string[] = [];
  const r = new ByteReader(head, 12);
  const chunks: WavParse["chunks"] = [];
  let format: AudioProperties = {};
  let dataSize = 0;

  while (r.remaining > 8) {
    const type = r.ascii(4);
    const size = r.u32le();
    if (r.remaining < size) {
      warnings.push(`Chunk \`${type}\` claims ${size} bytes but only ${r.remaining} remain`);
      break;
    }
    const data = r.slice(size).slice();
    chunks.push({ type, start: r.pos - size, size, data });
    if (size % 2 === 1 && r.remaining > 0) r.u8(); // word alignment

    if (type === "fmt ") {
      const fr = new ByteReader(data, 0);
      const audioFormat = fr.u16le();
      const channels = fr.u16le();
      const sampleRate = fr.u32le();
      const byteRate = fr.u32le();
      const blockAlign = fr.u16le();
      const bits = fr.u16le();
      format = {
        container: "WAV",
        codec: codecName(audioFormat),
        lossless: audioFormat === 1 || audioFormat === 3,
        channels,
        sampleRate,
        bitDepth: bits,
        audioBytes: dataSize || undefined,
      };
      if (byteRate > 0) format.bitrate = byteRate * 8;
      void blockAlign;
    } else if (type === "data") {
      dataSize = size;
      format.audioBytes = size;
      if (format.sampleRate && format.channels) {
        format.duration = size / (format.sampleRate * format.channels * ((format.bitDepth ?? 16) / 8));
        if (format.bitrate) format.bitrateMode = "CBR";
      }
    }
  }

  const metadata = {} as MusicMetadata;
  const raw: RawTag[] = [];
  const preservedInfo: Array<[string, string]> = [];
  const custom: Record<string, string> = {};

  for (const c of chunks) {
    if (c.type === "LIST" && String.fromCharCode(...c.data.subarray(0, 4)) === "INFO") {
      const ir = new ByteReader(c.data, 4);
      while (ir.remaining > 8) {
        const key = ir.ascii(4);
        const size = ir.u32le();
        if (size > ir.remaining) break;
        const value = trimNul(new TextDecoder("latin1").decode(ir.slice(size)));
        if (size % 2 === 1 && ir.remaining > 0) ir.u8();
        const field = INFO_MAP[key];
        if (field) {
          if (field === "artists" || field === "genres" || field === "composers") {
            (metadata[field] as string[] | undefined) ??= [];
            (metadata[field] as string[]).push(value);
          } else if (field === "trackNumber") {
            const n = Number.parseInt(value, 10);
            if (Number.isFinite(n)) metadata.trackNumber = n;
          } else if (field === "date") {
            metadata.date = value;
            if (/^\d{4}/.test(value)) metadata.year = Number.parseInt(value.slice(0, 4), 10);
          } else {
            (metadata as Record<string, unknown>)[field] = value;
          }
        } else {
          preservedInfo.push([key, value]);
          custom[key] = value;
        }
        raw.push({ key, values: [value] });
      }
    }
  }

  let id3Frames: Id3Frame[] = [];
  const id3Chunk = chunks.find((c) => c.type === "id3 " || c.type === "ID3 ");
  if (id3Chunk) {
    const parsed = parseId3v2(id3Chunk.data);
    if (parsed) {
      const ex = extractId3(parsed.frames, warnings, "WAV id3 chunk");
      // RIFF INFO wins for basic fields; the ID3 chunk fills the gaps and
      // supplies everything RIFF cannot express (lyrics, artwork, MB ids).
      for (const [k, v] of Object.entries(ex.metadata)) {
        if (k === "artwork" || k === "customFields") continue;
        if ((metadata as Record<string, unknown>)[k] === undefined) {
          (metadata as Record<string, unknown>)[k] = v;
        }
      }
      metadata.lyrics ??= ex.metadata.lyrics;
      metadata.artwork = ex.metadata.artwork;
      Object.assign(custom, ex.metadata.customFields ?? {});
      raw.push(...ex.raw);
      id3Frames = parsed.frames;
    }
  }

  if (Object.keys(custom).length) metadata.customFields = custom;

  return {
    chunks,
    preservedInfo,
    id3Frames,
    fileSize: head.length,
    metadata,
    raw,
    audio: format,
    formatInfo: { tagScheme: "RIFF INFO + id3 chunk", preservedUnknown: true },
    warnings,
    layout: { headStart: 12, headEnd: head.length, tailStart: 0, tailEnd: 0, variant: { container: "wav" } },
  };
}

function codecName(format: number): string {
  switch (format) {
    case 1:
      return "PCM";
    case 3:
      return "IEEE Float";
    case 6:
    case 7:
      return "A-law / µ-law";
    case 0x11:
      return "IMA ADPCM";
    case 0x55:
      return "MPEG Layer-3";
    case 0xfffe:
      return "Extensible";
    default:
      return `WAVE 0x${format.toString(16)}`;
  }
}

function infoValue(field: keyof MusicMetadata, m: MusicMetadata): string | undefined {
  const v = m[field];
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) {
    // Only the multi-value *text* fields land here; artwork is skipped above.
    const first = v[0];
    return typeof first === "string" ? first : undefined;
  }
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean"
    ? String(v)
    : undefined;
}

export function writeWav(original: Uint8Array, metadata: MusicMetadata, parsed: WavParse): WriteResult {
  const warnings: string[] = [];
  const fields: Array<[string, string]> = [];
  const set = (key: string, v: string | undefined) => {
    if (typeof v === "string" && v !== "") fields.push([key, v]);
  };

  set("INAM", infoValue("title", metadata));
  set("IART", infoValue("artists", metadata) ?? metadata.artist);
  set("IPRD", metadata.album);
  set("ICMT", metadata.comment);
  set("IGRP", metadata.grouping);
  set("ICRD", metadata.date ?? (metadata.year ? String(metadata.year) : undefined));
  set("IGNR", infoValue("genres", metadata) ?? metadata.genre);
  set("ITRK", metadata.trackNumber !== undefined ? String(metadata.trackNumber) : undefined);
  set("ICOP", metadata.copyright);
  set("ISFT", metadata.encoder);
  set("IMUS", infoValue("composers", metadata) ?? metadata.composer);
  set("ILNG", metadata.language);
  set("IKEY", metadata.key);
  for (const [k, v] of parsed.preservedInfo) set(k, v);
  for (const [k, v] of Object.entries(metadata.customFields ?? {})) {
    if (k.startsWith("_")) continue;
    set(k, v);
  }

  const info = buildListInfo(fields);
  // Non-Latin text and lyrics only survive through the ID3 chunk.
  const id3 = buildId3v2(id3FramesFromMetadata(metadata, parsed.id3Frames), parsed.id3Frames);

  const parts: Uint8Array[] = [];
  let total = 4; // "WAVE"
  let wroteInfo = false;
  let wroteId3 = false;

  for (const c of parsed.chunks) {
    if (c.type === "LIST" && String.fromCharCode(...c.data.subarray(0, 4)) === "INFO") {
      parts.push(info);
      total += info.length;
      wroteInfo = true;
      continue;
    }
    if (c.type === "id3 " || c.type === "ID3 ") {
      if (id3.length > 10) {
        parts.push(new ByteWriter(id3.length + 8).ascii("id3 ").u32le(id3.length).bytes(id3).toBytes());
        total += id3.length + 8 + (id3.length % 2);
        wroteId3 = true;
      }
      continue;
    }
    const chunk = new ByteWriter(c.size + 9).ascii(c.type).u32le(c.size).bytes(c.data).toBytes();
    parts.push(chunk);
    total += chunk.length;
  }

  if (!wroteInfo) {
    parts.push(info);
    total += info.length;
  }
  if (!wroteId3 && id3.length > 10) {
    const c = new ByteWriter(id3.length + 9).ascii("id3 ").u32le(id3.length).bytes(id3).toBytes();
    parts.push(c);
    total += c.length;
    warnings.push("An `id3 ` chunk was added to carry non-Latin text");
  }

  const header = new ByteWriter(8).ascii("RIFF").u32le(total).ascii("WAVE").toBytes();
  void original;
  return { bytes: concatBytes(header, ...parts), bytesWritten: total, warnings };
}

function buildListInfo(fields: Array<[string, string]>): Uint8Array {
  const body = new ByteWriter(64 + fields.length * 32);
  body.ascii("INFO");
  for (const [k, v] of fields) {
    const bytes = new TextEncoder().encode(v);
    body.ascii(k).u32le(bytes.length).bytes(bytes);
    if (bytes.length % 2 === 1) body.u8(0);
  }
  return new ByteWriter(body.length + 8).ascii("LIST").u32le(body.length).bytes(body.toBytes()).toBytes();
}

/** Build the managed ID3 frames we embed alongside RIFF INFO. */
function id3FramesFromMetadata(metadata: MusicMetadata, preserved: Id3Frame[]): Id3Frame[] {
  const frames: Id3Frame[] = [];
  const text = (key: string, value: string | undefined) => {
    if (!value) return;
    frames.push({ key, payload: new ByteWriter().u8(3).utf8(value).toBytes(), encoding: 3 });
  };
  text("TIT2", metadata.title);
  text("TPE1", metadata.artists?.[0] ?? metadata.artist);
  text("TALB", metadata.album);
  text("TPE2", metadata.albumArtists?.[0] ?? metadata.albumArtist);
  text("TDRC", metadata.date);
  text("TCON", metadata.genres?.[0] ?? metadata.genre);
  text("TIT1", metadata.grouping);
  text("TCOM", metadata.composers?.[0] ?? metadata.composer);
  text("TCOP", metadata.copyright);
  text("TLAN", metadata.language);
  void preserved;
  return frames;
}