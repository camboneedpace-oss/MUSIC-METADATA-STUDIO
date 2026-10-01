/**
 * Format dispatcher — the only module that knows how a file becomes a
 * `ReadResult` and how a `MusicMetadata` becomes new file bytes.
 *
 * Detection is by magic bytes first and extension second: files in the wild
 * are routinely mis-named, and writing tags with the wrong codec is the one
 * mistake that damages a collection.
 */

import { concatBytes, probeImage } from "./binary";
import {
  readDsfStream,
  readMp3Audio,
  readMusepackStream,
  readOptimFrogStream,
  readTakStream,
  readTtAStream,
  readWavPackStream,
} from "./audio-props";
import { buildApeTag, findApeTag, isApeTagAt, parseApeTag, type ApeParse } from "./codecs/ape";
import { readAsf } from "./codecs/asf";
import { readAiff } from "./codecs/aiff";
import { readFlac, writeFlac } from "./codecs/flac";
import {
  buildId3v2,
  extractId3,
  hasId3Header,
  parseId3v1,
  parseId3v2,
  buildId3v1,
  ID3V1_SIZE,
  ID3V1_GENRES,
  type Id3Frame,
  type Id3ParseResult,
} from "./codecs/id3";
import { readMp4, writeMp4 } from "./codecs/mp4";
import { readOgg, writeOgg, type OggCodec, type OggParse } from "./codecs/ogg";
import { readWav, writeWav, type WavParse } from "./codecs/wav";
import {
  FORMAT_CAPABILITIES,
  formatFromPath,
  isLossless,
  type FormatId,
  type MusicMetadata,
  type RawTag,
  type ReadResult,
  type WriteResult,
} from "./types";

export * from "./types";
export { FORMAT_CAPABILITIES } from "./types";

/** Formats whose native tag is the ID3 family. */
const ID3_FAMILY = new Set<FormatId>(["mp3", "aac", "dsf", "tta"]);

/** Formats whose native tag is APEv2. */
const APE_FAMILY = new Set<FormatId>(["ape", "mpc", "wv", "wvp", "tta", "ofr", "ofs", "tak"]);

export function detectFormat(head: Uint8Array, path = ""): FormatId | null {
  const startsWith = (s: string, offset = 0) => {
    if (head.length < offset + s.length) return false;
    for (let i = 0; i < s.length; i++) if (head[offset + i] !== s.charCodeAt(i)) return false;
    return true;
  };

  if (startsWith("fLaC")) return "flac";
  if (startsWith("OggS")) return "ogg";
  if (startsWith("RIFF") && startsWith("WAVE", 8)) return "wav";
  if (startsWith("FORM") && startsWith("AIFF", 8)) return "aiff";
  if (startsWith("FORM") && startsWith("AIFC", 8)) return "aifc";
  if (startsWith("MAC ")) return "ape";
  if (startsWith("wvpk")) return "wv";
  if (startsWith("MPCK")) return "mpc";
  if (startsWith("MP+")) return "mpc";
  if (startsWith("OFR ") || startsWith("OFRM")) return "ofr";
  if (startsWith("tBaK")) return "tak";
  if (startsWith("TTA1")) return "tta";
  if (startsWith("DSD ")) return "dsf";
  if (startsWith("\x30\x26\xb2\x75")) return "wma"; // ASF header GUID, little-endian
  if (head.length >= 12 && String.fromCharCode(...head.subarray(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...head.subarray(8, 12));
    if (brand.startsWith("M4A")) return "m4a";
    if (brand.startsWith("M4B")) return "m4b";
    return "mp4";
  }
  if (hasId3Header(head)) {
    const ext = formatFromPath(path);
    if (ext && ID3_FAMILY.has(ext)) return ext;
    // ID3 covers MP3 and raw AAC; decide by the first MPEG frame.
    return firstMpegFrameIsLayer3(head) ? "mp3" : "aac";
  }
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "mp3";
  if (head[0] === 0xff && head[1] === 0xf1) return "aac";
  if (head[0] === 0xff && head[1] === 0xf9) return "aac";

  return formatFromPath(path);
}

function firstMpegFrameIsLayer3(head: Uint8Array): boolean {
  for (let i = 0; i + 4 <= Math.min(head.length, 8192); i++) {
    if (head[i] !== 0xff || (head[i + 1] & 0xe0) !== 0xe0) continue;
    const layer = (head[i + 1] >> 1) & 0x03;
    const bitrateIndex = (head[i + 2] >> 4) & 0x0f;
    const rateIndex = (head[i + 2] >> 2) & 0x03;
    if (layer === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) continue;
    return layer === 1; // 1 means Layer III
  }
  return true;
}

export interface ScannedFile extends ReadResult {
  format: FormatId;
  /** Bytes actually consumed by tags — used to compute "audio size". */
  tagBytes: number;
}

export function readMetadata(
  file: Uint8Array,
  path: string,
  formatHint?: FormatId,
): ScannedFile {
  const head = file.subarray(0, Math.min(file.length, 4 * 1024 * 1024));
  let format = formatHint ?? detectFormat(head, path) ?? "mp3";
  // APEv2 is an overlay tag, not a container: Musepack, WavPack, Monkey's
  // Audio and OptimFROG files all carry it, and their magic bytes differ.
  // When the extension names one of those containers, trust it.
  const extFormat = formatFromPath(path);
  if (!formatHint && extFormat && APE_FAMILY.has(extFormat)) format = extFormat;
  const warnings: string[] = [];
  const tailSize = Math.min(file.length, 256 * 1024);
  const tail = file.subarray(file.length - tailSize);

  let result: ReadResult | null = null;
  let tagBytes = 0;
  let oggCodec: OggCodec | null = null;

  switch (format) {
    case "flac": {
      result = readFlac(head);
      tagBytes = result?.layout.headEnd ?? 0;
      break;
    }
    case "ogg":
    case "opus":
    case "spx": {
      const ogg = readOgg(head);
      if (ogg) {
        result = ogg;
        oggCodec = ogg.codec;
        tagBytes = ogg.layout.headEnd;
      }
      break;
    }
    case "m4a":
    case "m4b":
    case "mp4":
    case "alac": {
      result = readMp4(head);
      tagBytes = result ? result.layout.headEnd : 0;
      break;
    }
    case "wav": {
      const wav = readWav(head);
      result = wav;
      tagBytes = 0;
      break;
    }
    case "aiff":
    case "aif":
    case "aifc": {
      result = readAiff(head);
      break;
    }
    case "wma": {
      result = readAsf(head);
      break;
    }
    default: {
      const id3 = parseId3v2(head);
      if (id3) tagBytes += id3.totalSize;
      const ape = findApeTag(file);
      let apeParse: ApeParse | null = null;
      if (ape) {
        apeParse = parseApeTag(ape.tag, ape.offset, ape.atHeader);
        tagBytes += ape.tag.length;
      }
      const v1 = parseId3v1(tail);
      if (v1) tagBytes += ID3V1_SIZE;

      const metadata = {} as MusicMetadata;
      const raw: RawTag[] = [];
      const artwork: MusicMetadata["artwork"] = [];
      const schemes: string[] = [];

      if (id3) {
        schemes.push(`ID3v2.${id3.majorVersion}`);
        const ex = extractId3(id3.frames, warnings, "ID3v2");
        Object.assign(metadata, ex.metadata);
        raw.push(...ex.raw);
        artwork.push(...ex.artwork);
        warnings.push(...id3.warnings);
      } else if (v1) {
        schemes.push("ID3v1");
        if (v1.title) metadata.title = v1.title;
        if (v1.artist) metadata.artists = [v1.artist];
        if (v1.album) metadata.album = v1.album;
        if (v1.comment) metadata.comment = v1.comment;
        if (v1.year) {
          metadata.date = v1.year;
          const y = Number.parseInt(v1.year.slice(0, 4), 10);
          if (Number.isFinite(y)) metadata.year = y;
        }
        if (v1.track) metadata.trackNumber = v1.track;
        if (v1.genreIndex !== undefined && v1.genreIndex < 192) {
          const name = ID3V1_GENRES[v1.genreIndex];
          if (name) metadata.genres = [name];
        }
      }

      if (apeParse) {
        schemes.push(apeParse.formatInfo.tagVersion ?? "APEv2");
        // ID3 wins on conflicts: it is the more expressive of the two.
        for (const [k, v] of Object.entries(apeParse.metadata)) {
          if (k === "customFields") {
            Object.assign(metadata.customFields ?? (metadata.customFields = {}), v as Record<string, string>);
          } else if ((metadata as Record<string, unknown>)[k] === undefined) {
            (metadata as Record<string, unknown>)[k] = v;
          }
        }
        raw.push(...apeParse.raw.map((t) => ({ ...t, key: `${apeParse.formatInfo.tagScheme}:${t.key}` })));
        artwork.push(...(apeParse.metadata.artwork ?? []));
      }

      metadata.artwork = artwork;
      const streamProps =
        format === "mp3" || format === "aac"
          ? readMp3Audio(head, tagBytes, file.length - (v1 ? ID3V1_SIZE : 0), file.length)
          : {
              ...readWavPackStream(head),
              ...readMusepackStream(head),
              ...readOptimFrogStream(head),
              ...readTakStream(head),
              ...readTtAStream(head),
              ...readDsfStream(head),
            };

      result = {
        metadata,
        raw,
        audio: { ...streamProps, audioBytes: file.length - tagBytes },
        formatInfo: {
          tagScheme: schemes.length ? schemes.join(" + ") : "None",
          preservedUnknown: true,
        },
        warnings,
        layout: {
          headStart: 0,
          headEnd: id3 ? id3.totalSize : 0,
          tailStart: ape ? ape.offset : file.length,
          tailEnd: ape ? ape.offset + ape.tag.length : file.length,
          variant: {
            hasId3v2: Boolean(id3),
            hasId3v1: Boolean(v1),
            apeAt: ape ? (ape.atHeader ? "head" : "tail") : "none",
          },
        },
      };
      break;
    }
  }

  if (!result) {
    return {
      format,
      tagBytes: 0,
      metadata: {},
      raw: [],
      audio: { container: format.toUpperCase() },
      formatInfo: { tagScheme: "Unsupported", preservedUnknown: false },
      warnings: [`No metadata reader for ${format.toUpperCase()}`],
      layout: { headStart: 0, headEnd: 0, tailStart: 0, tailEnd: 0, variant: {} },
    };
  }

  // Distinguish Opus/Speex from plain Vorbis: the container is the same, the
  // codec inside it decides which capability rules apply.
  if (format === "ogg" && oggCodec && oggCodec !== "flac" && oggCodec !== "unknown") {
    format = oggCodec === "vorbis" ? "ogg" : oggCodec === "speex" ? "spx" : oggCodec;
  }

  if (!result.audio.lossless) result.audio.lossless = isLossless(format);
  if (!result.audio.container) result.audio.container = format.toUpperCase();

  return { ...result, format, tagBytes };
}

/* ---------------- writing ---------------- */

export interface WriteOptions {
  /** Write an ID3v1 trailer for MP3-family files. Default false. */
  id3v1?: boolean;
  /** Target ID3 major version for MP3-family files. Default 4. */
  id3Version?: 3 | 4;
}

export function writeMetadata(
  original: Uint8Array,
  path: string,
  current: ScannedFile,
  metadata: MusicMetadata,
  options: WriteOptions = {},
): WriteResult {
  const format = current.format;
  void path;
  if (!FORMAT_CAPABILITIES[format]?.write) {
    return {
      bytes: original,
      bytesWritten: 0,
      warnings: [`${format.toUpperCase()} tags cannot be written by this build — the file is unchanged`],
    };
  }

  switch (format) {
    case "flac": {
      const flac = readFlac(original.subarray(0, current.layout.headEnd));
      const preservedBlocks = collectFlacBlocks(original, current);
      return writeFlac(
        original,
        metadata,
        current.layout,
        flac?.preservedComments ?? [],
        preservedBlocks,
        original.length,
        flac?.formatInfo.tagVersion?.match(/vendor "(.*)"$/)?.[1] ?? "Music Metadata Studio",
      );
    }
    case "ogg":
    case "opus":
    case "spx": {
      const ogg = reparseOgg(original, current);
      return writeOgg(original, metadata, ogg, ogg.vendor);
    }
    case "m4a":
    case "m4b":
    case "mp4":
    case "alac":
      return writeMp4(original, metadata, current.raw);
    case "wav": {
      const wav = reparseWav(original, current);
      return writeWav(original, metadata, wav);
    }
    case "mp3":
    case "aac":
    case "dsf":
      return writeId3Family(original, current, metadata, options);
    default:
      if (APE_FAMILY.has(format)) return writeApeFamily(original, current, metadata, options);
      return {
        bytes: original,
        bytesWritten: 0,
        warnings: [`No writer for ${format.toUpperCase()} — the file is unchanged`],
      };
  }
}

/* --- FLAC helpers --- */

function collectFlacBlocks(file: Uint8Array, current: ScannedFile): Uint8Array[] {
  const head = file.subarray(0, current.layout.headEnd);
  const out: Uint8Array[] = [];
  let at = 4;
  let first = true;
  while (at + 4 <= head.length) {
    const header = head[at];
    const last = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const len = (head[at + 1] << 16) | (head[at + 2] << 8) | head[at + 3];
    const end = at + 4 + len;
    if (end > head.length) break;
    if (first) {
      first = false;
    } else if (type !== 1 && type !== 4 && type !== 6) {
      out.push(head.slice(at, end));
    }
    at = end;
    if (last) break;
  }
  return out;
}

/* --- re-parse helpers: the write path needs the codec's private state --- */

function reparseOgg(file: Uint8Array, current: ScannedFile): OggParse {
  const parsed = readOgg(file.subarray(0, Math.max(current.layout.headEnd + 1024 * 64, 512 * 1024)));
  if (!parsed) {
    return {
      codec: "unknown",
      serial: 0,
      vendor: "",
      headPacket: new Uint8Array(0),
      preservedComments: [],
      preservedPackets: [],
      preservedBlocks: [],
      audioPages: [],
      headerPageCount: 0,
      metadata: current.metadata,
      raw: current.raw,
      audio: current.audio,
      formatInfo: current.formatInfo,
      warnings: current.warnings,
      layout: current.layout,
    };
  }
  return parsed;
}

function reparseWav(file: Uint8Array, current: ScannedFile): WavParse {
  const parsed = readWav(file.subarray(0, Math.min(file.length, 8 * 1024 * 1024)));
  if (!parsed) {
    return {
      chunks: [],
      preservedInfo: [],
      id3Frames: [],
      fileSize: file.length,
      metadata: current.metadata,
      raw: current.raw,
      audio: current.audio,
      formatInfo: current.formatInfo,
      warnings: current.warnings,
      layout: current.layout,
    };
  }
  return parsed;
}

/* --- ID3 family (MP3 / AAC / DSF) --- */

const ID3_FIELD_MAP: Array<
  [keyof MusicMetadata, string, "single" | "multi" | "pair" | "pairAlt" | "txxx"]
> = [
  ["title", "TIT2", "single"],
  ["artists", "TPE1", "multi"],
  ["album", "TALB", "single"],
  ["albumArtists", "TPE2", "multi"],
  ["composers", "TCOM", "multi"],
  ["conductor", "TPE3", "single"],
  ["genres", "TCON", "multi"],
  ["grouping", "TIT1", "single"],
  // `comment` (COMM) and `lyrics` (USLT) are deliberately absent: both frames
  // need a language code and a terminated descriptor before their text, so
  // they cannot use the bare "single" layout and are written separately below.
  ["date", "TDRC", "single"],
  ["trackNumber", "TRCK", "pair"],
  ["trackTotal", "TRCK", "pairAlt"],
  ["discNumber", "TPOS", "pair"],
  ["discTotal", "TPOS", "pairAlt"],
  ["bpm", "TBPM", "single"],
  ["key", "TKEY", "single"],
  ["copyright", "TCOP", "single"],
  ["publisher", "TPUB", "single"],
  ["label", "TXXX:LABEL", "txxx"],
  ["language", "TLAN", "single"],
  ["isrc", "TSRC", "single"],
  ["barcode", "TXXX:BARCODE", "txxx"],
  ["catalogNumber", "TXXX:CATALOGNUMBER", "txxx"],
  ["compilation", "TCMP", "single"],
  ["musicBrainzRecordingId", "TXXX:MusicBrainz Track Id", "txxx"],
  ["musicBrainzReleaseId", "TXXX:MusicBrainz Album Id", "txxx"],
  ["musicBrainzReleaseGroupId", "TXXX:MusicBrainz Release Group Id", "txxx"],
  ["musicBrainzWorkId", "TXXX:MusicBrainz Work Id", "txxx"],
  ["replayGainTrackGain", "TXXX:REPLAYGAIN_TRACK_GAIN", "txxx"],
  ["replayGainTrackPeak", "TXXX:REPLAYGAIN_TRACK_PEAK", "txxx"],
  ["replayGainAlbumGain", "TXXX:REPLAYGAIN_ALBUM_GAIN", "txxx"],
  ["replayGainAlbumPeak", "TXXX:REPLAYGAIN_ALBUM_PEAK", "txxx"],
];

const MANAGED_ID3 = new Set<string>([
  ...ID3_FIELD_MAP.map(([, key]) => key),
  "TDRL",
  "TYER",
  "COMPILATION",
  "XSOA",
  "TSO2",
  "TSOP",
  "MVNM",
  "MVIN",
  "TDOR",
]);

function buildId3Frames(metadata: MusicMetadata): Id3Frame[] {
  const frames: Id3Frame[] = [];
  const enc = new TextEncoder();

  const text = (key: string, value: string | undefined) => {
    if (value === undefined || value === "") return;
    frames.push({ key, payload: concatBytes(new Uint8Array([3]), enc.encode(value)), encoding: 3 });
  };
  const multi = (key: string, values: string[] | undefined) => {
    if (!values?.length) return;
    frames.push({
      key,
      payload: concatBytes(new Uint8Array([3]), enc.encode(values.join("\u0000"))),
      encoding: 3,
    });
  };
  const txxx = (key: string, value: string | undefined) => {
    if (!key.includes(":") || value === undefined || value === "") return;
    const [, desc] = key.split(":");
    frames.push({
      key: "TXXX",
      payload: concatBytes(new Uint8Array([3]), enc.encode(desc), new Uint8Array([0]), enc.encode(value)),
      encoding: 3,
    });
  };

  const trackFrame: Id3Frame[] = [];
  const discFrame: Id3Frame[] = [];

  for (const [field, key, kind] of ID3_FIELD_MAP) {
    if (kind === "pair" || kind === "pairAlt") {
      const n = metadata[field] as number | undefined;
      if (n === undefined) continue;
      const isTrack = key === "TRCK";
      const total = isTrack ? metadata.trackTotal : metadata.discTotal;
      const frame: Id3Frame = { key, payload: pairPayload(n, total), encoding: 3 };
      const target = isTrack ? trackFrame : discFrame;
      // `pairAlt` reuses the same frame id, so the second entry is a no-op.
      if (kind === "pair" || target.length === 0) target.push(frame);
      continue;
    }
    const value = metadata[field];
    if (kind === "multi") multi(key, value as string[] | undefined);
    else if (kind === "txxx") txxx(key, value as string | undefined);
    else if (typeof value === "boolean") text(key, value ? "1" : "0");
    else text(key, typeof value === "number" ? String(value) : (value as string | undefined));
  }
  frames.push(...trackFrame, ...discFrame);
  if (metadata.year !== undefined && metadata.date === undefined) text("TDRC", String(metadata.year));

  // COMM and USLT carry `<encoding><language><descriptor>\0<text>`; the
  // generic text-frame layout would omit the language and descriptor.
  if (metadata.comment) {
    frames.push({
      key: "COMM",
      payload: concatBytes(new Uint8Array([3]), enc.encode("eng"), enc.encode(""), new Uint8Array([0]), enc.encode(metadata.comment)),
      encoding: 3,
    });
  }
  if (metadata.lyrics) {
    frames.push({
      key: "USLT",
      payload: concatBytes(new Uint8Array([3]), enc.encode("eng"), enc.encode(""), new Uint8Array([0]), enc.encode(metadata.lyrics)),
      encoding: 3,
    });
  }
  for (const [k, v] of Object.entries(metadata.customFields ?? {})) {
    if (k.startsWith("_")) continue;
    txxx(k, v);
  }
  for (const art of (metadata.artwork ?? []).slice(0, 1)) {
    frames.push({
      key: "APIC",
      payload: concatBytes(
        new Uint8Array([3]),
        enc.encode(art.mime || "image/jpeg"),
        new Uint8Array([0]),
        new Uint8Array([{ front: 3, back: 4, artist: 2, disc: 6, leaflet: 7, other: 0 }[art.role]]),
        enc.encode(art.description ?? ""),
        new Uint8Array([0]),
        art.data,
      ),
      encoding: 3,
    });
  }
  return frames;
}

function pairPayload(a: number, b?: number): Uint8Array {
  const enc = new TextEncoder();
  const text = b !== undefined ? `${a}/${b}` : String(a);
  return concatBytes(new Uint8Array([3]), enc.encode(text));
}

function writeId3Family(
  original: Uint8Array,
  current: ScannedFile,
  metadata: MusicMetadata,
  options: WriteOptions,
): WriteResult {
  const existing = parseId3v2(original.subarray(0, current.layout.headEnd));
  const preserved = (existing?.frames ?? []).filter(
    (f) => !MANAGED_ID3.has(f.key) && !(f.key === "TXXX" && isManagedTxxx(f)),
  );
  const frames = buildId3Frames(metadata);
  const tag = buildId3v2(frames, preserved, { padding: 0 });

  const audioStart = current.layout.headEnd;
  const ape = findApeTag(original);
  let audioEnd = original.length;
  const parts: Uint8Array[] = [];
  if (ape) {
    if (ape.atHeader) {
      // APE tag ahead of the audio: keep it in front of the new ID3v2 tag.
      parts.push(ape.tag);
    }
    audioEnd = Math.min(ape.atHeader ? ape.offset + ape.tag.length : ape.offset, original.length);
  }
  if (current.layout.variant.hasId3v1) audioEnd -= ID3V1_SIZE;

  parts.push(tag);
  parts.push(original.subarray(audioStart, Math.max(audioStart, audioEnd)));
  if (options.id3v1) parts.push(buildId3v1(metadata));

  const bytes = concatBytes(...parts);
  return {
    bytes,
    bytesWritten: bytes.length - original.length,
    warnings: [],
  };
}

function isManagedTxxx(frame: Id3Frame): boolean {
  const payload = frame.payload;
  if (payload[0] !== 3) return false;
  const text = new TextDecoder("utf-8").decode(payload.subarray(1));
  const nul = text.indexOf("\u0000");
  const desc = (nul === -1 ? text : text.slice(0, nul)).toLowerCase();
  return [
    "label", "barcode", "catalognumber", "musicbrainz track id", "musicbrainz album id",
    "musicbrainz release group id", "musicbrainz work id", "replaygain_track_gain",
    "replaygain_track_peak", "replaygain_album_gain", "replaygain_album_peak",
  ].includes(desc);
}

/* --- APE family --- */

function writeApeFamily(
  original: Uint8Array,
  current: ScannedFile,
  metadata: MusicMetadata,
  _options: WriteOptions,
): WriteResult {
  const ape = findApeTag(original);
  const preservedItems: ApeParse["items"] = [];
  if (ape) {
    const parsed = parseApeTag(ape.tag, ape.offset, ape.atHeader);
    if (parsed) preservedItems.push(...parsed.items);
  }

  const tag = buildApeTag(metadata, preservedItems);
  let start = 0;
  if (current.layout.variant.hasId3v2 || current.layout.headEnd > 0) start = current.layout.headEnd;
  let end = original.length;
  if (ape) {
    if (ape.atHeader) start = Math.max(start, ape.offset + ape.tag.length);
    else end = ape.offset;
  }
  if (current.layout.variant.hasId3v1) end -= ID3V1_SIZE;

  const id3Head = original.subarray(0, current.layout.headEnd);
  const parts: Uint8Array[] = [];
  if (current.layout.headEnd > 0) parts.push(id3Head);
  parts.push(original.subarray(start, Math.max(start, end)));
  parts.push(tag);
  if (current.layout.variant.hasId3v1) parts.push(original.subarray(original.length - ID3V1_SIZE));

  const bytes = concatBytes(...parts);
  return { bytes, bytesWritten: bytes.length - original.length, warnings: [] };
}

/* ---------------- verification ---------------- */

export interface VerifyResult {
  ok: boolean;
  title?: string;
  artist?: string;
  artworkCount: number;
  warnings: string[];
  /** Fields the caller asked for but the written file does not report. */
  mismatches: string[];
}

export function verifyWrite(bytes: Uint8Array, expected: MusicMetadata, path: string): VerifyResult {
  let re: ScannedFile;
  try {
    re = readMetadata(bytes, path);
  } catch (err) {
    return {
      ok: false,
      artworkCount: 0,
      warnings: [`Written file could not be re-read: ${(err as Error).message}`],
      mismatches: [],
    };
  }

  const mismatches: string[] = [];
  const check = (label: string, want: unknown, got: unknown) => {
    if (want === undefined || want === "") return;
    const a = Array.isArray(want) ? want.join(" / ") : String(want);
    const b = Array.isArray(got) ? got.join(" / ") : got === undefined ? "" : String(got);
    if (a.trim() !== b.trim()) mismatches.push(`${label}: wrote "${a}", file reports "${b}"`);
  };

  check("Title", expected.title, re.metadata.title);
  check("Artist", expected.artists ?? expected.artist, re.metadata.artists ?? re.metadata.artist);
  check("Album", expected.album, re.metadata.album);
  check("Album artist", expected.albumArtists, re.metadata.albumArtists);
  check("Genre", expected.genres, re.metadata.genres);
  check("Track", expected.trackNumber, re.metadata.trackNumber);
  check("Year", expected.year, re.metadata.year);
  check("Comment", expected.comment, re.metadata.comment);

  const expectedArt = (expected.artwork ?? []).length;
  const gotArt = (re.metadata.artwork ?? []).length;
  if (expectedArt > gotArt && FORMAT_CAPABILITIES[re.format].artwork) {
    mismatches.push(`Artwork: wrote ${expectedArt} image(s), file reports ${gotArt}`);
  }

  return {
    ok: mismatches.length === 0,
    title: re.metadata.title,
    artist: re.metadata.artists?.[0] ?? re.metadata.artist,
    artworkCount: gotArt,
    warnings: re.warnings,
    mismatches,
  };
}

export { isApeTagAt, findApeTag, parseId3v2, parseId3v1, hasId3Header };
export type { Id3Frame, Id3ParseResult, RawTag };
export { probeImage };