/**
 * ID3v1 / ID3v2 codec.
 *
 * Reads v2.2 (3-char), v2.3 (4-char, 32-bit size) and v2.4 (4-char,
 * synchsafe size, UTF-8 by default) including unsynchronisation, extended
 * headers, and multi-byte text encodings. Frames we do not interpret are
 * kept as raw payloads so a write never silently drops them.
 *
 * Writes ID3v2.4 (UTF-8, no unsynchronisation) by default, which every
 * current decoder accepts.
 */

import {
  ByteReader,
  ByteWriter,
  concatBytes,
  decodeLatin1,
  decodeUtf8,
  encodeLatin1,
  hexPreview,
  probeImage,
  trimNul,
} from "../binary";
import type { Artwork, ArtworkRole, MusicMetadata, RawTag } from "../types";

export interface Id3Frame {
  /** Native 4-character id (v2.2 ids are widened to 4 for uniformity). */
  key: string;
  payload: Uint8Array;
  /** Encoding byte for text frames, kept so unknown frames can round-trip. */
  encoding?: number;
}

export interface Id3ParseResult {
  majorVersion: 2 | 3 | 4;
  /** Total tag bytes including the 10-byte header. */
  totalSize: number;
  frames: Id3Frame[];
  warnings: string[];
}

const HEADER_SIZE = 10;
export const ID3V1_SIZE = 128;

export function hasId3Header(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33; // "ID3"
}

/** Reverse the ID3 unsynchronisation scheme. */
export function deunsync(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    out[n++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, n);
}

export function unsync(b: Uint8Array): Uint8Array {
  const out = new ByteWriter(b.length + 64);
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) out.u8(0xff).u8(0x00);
    else out.u8(b[i]);
  }
  return out.toBytes();
}

/** Decode an ID3 text frame body (leading encoding byte + text). */
export function decodeTextFrame(payload: Uint8Array): string[] {
  if (payload.length === 0) return [];
  const enc = payload[0];
  const body = payload.subarray(1);
  let s: string;
  switch (enc) {
    case 0:
      s = decodeLatin1(body);
      break;
    case 1: {
      // UTF-16 with BOM
      s = body.length >= 2 && body[0] === 0xff && body[1] === 0xfe
        ? decodeUtf16LE(body.subarray(2))
        : body.length >= 2 && body[0] === 0xfe && body[1] === 0xff
          ? decodeUtf16BE(body.subarray(2))
          : decodeUtf16LE(body);
      break;
    }
    case 2:
      s = decodeUtf16BE(body);
      break;
    case 3:
      s = decodeUtf8(body);
      break;
    default:
      s = decodeLatin1(body);
  }
  s = trimNul(s);
  if (s === "") return [];
  // v2.4 permits null-separated multi-values inside one text frame.
  return s.split("\u0000").filter((v) => v !== "");
}

function decodeUtf16LE(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b[i] | (b[i + 1] << 8));
  return s;
}

function decodeUtf16BE(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
  return s;
}

/** Parse an ID3v2 tag located at offset 0 of `head`. */
export function parseId3v2(head: Uint8Array): Id3ParseResult | null {
  if (!hasId3Header(head)) return null;
  const r = new ByteReader(head, 0);
  r.pos = 3;
  const majorVersion = r.u8() as 2 | 3 | 4;
  r.u8(); // revision
  const flags = r.u8();
  const size = r.synchsafe();
  const warnings: string[] = [];
  if (majorVersion < 2 || majorVersion > 4) {
    return { majorVersion: 4, totalSize: 0, frames: [], warnings: [`Unsupported ID3v2.${majorVersion} tag`] };
  }

  const tagEnd = Math.min(HEADER_SIZE + size, head.length);
  let cursor = HEADER_SIZE;
  const body = head.subarray(0, tagEnd);
  const frameIsUnsynchronised = majorVersion < 4 && (flags & 0x80) !== 0;
  const wholeTagUnsynchronised = majorVersion < 4 && (flags & 0x40) !== 0;

  if (flags & 0x40) {
    cursor += 4; // extended header length field
    if (majorVersion === 4) {
      const extSize = new ByteReader(head, cursor - 4).synchsafe();
      cursor += Math.max(0, extSize - 4);
    }
  }

  let frameData = body.subarray(Math.min(cursor, body.length));
  // Whole-tag unsynchronisation covers every frame after the header.
  if (wholeTagUnsynchronised) frameData = deunsync(frameData);

  const res = parseFrames(frameData, majorVersion, warnings, frameIsUnsynchronised);
  return { ...res, majorVersion, totalSize: HEADER_SIZE + size };
}

function parseFrames(
  buf: Uint8Array,
  majorVersion: 2 | 3 | 4,
  warnings: string[],
  unsynchronised: boolean,
): Id3ParseResult {
  const frames: Id3Frame[] = [];
  const idLen = majorVersion === 2 ? 3 : 4;
  const headerLen = majorVersion === 2 ? 6 : 10;
  const r = new ByteReader(buf, 0);

  while (r.remaining > headerLen) {
    const id = r.ascii(idLen);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;

    let size: number;
    if (majorVersion === 2) size = r.u24();
    else if (majorVersion === 4) size = r.synchsafe();
    else size = r.u32();

    const frameFlags =
      majorVersion === 2 ? 0 : r.u16();

    if (size <= 0) continue;
    if (size > r.remaining) {
      warnings.push(`Frame ${id} claims ${size} bytes but only ${r.remaining} remain; truncated`);
      break;
    }

    let payload = r.slice(size);
    const compressed =
      majorVersion >= 3 && (majorVersion === 4 ? (frameFlags & 0x0008) !== 0 : (frameFlags & 0x0080) !== 0);
    const dataLenIndicator =
      majorVersion === 4 && (frameFlags & 0x0001) !== 0;
    const framedUnsynchronised =
      majorVersion === 4 && (frameFlags & 0x0002) !== 0;

    if (dataLenIndicator && payload.length > 4) payload = payload.subarray(4);
    if (unsynchronised || framedUnsynchronised) payload = deunsync(payload);

    if (compressed) {
      // Frame-level zlib compression is legal but vanishingly rare. We keep
      // the payload verbatim rather than guessing at its contents.
      warnings.push(`Frame ${id} is zlib-compressed; kept verbatim and re-emitted as-is`);
    }

    frames.push({ key: widenId(id), payload });
  }

  return { majorVersion, totalSize: 0, frames, warnings };
}

/** v2.2 three-character ids widened to their v2.3/v2.4 equivalents. */
function widenId(id: string): string {
  const map: Record<string, string> = {
    TT2: "TIT2",
    TP1: "TPE1",
    TP2: "TPE2",
    TP3: "TPE3",
    TP4: "TPE4",
    TCM: "TCOM",
    TAL: "TALB",
    TPA: "TPOS",
    TRK: "TRCK",
    TYE: "TYER",
    TDA: "TDAT",
    TIM: "TIME",
    TRC: "TSRC",
    TBP: "TBPM",
    TKE: "TKEY",
    TOT: "TOAL",
    TOA: "TOPE",
    TOL: "TOLY",
    TLE: "TLEN",
    TCO: "TCON",
    TCP: "TCMP",
    TCR: "TCOP",
    TPB: "TPUB",
    TEN: "TENC",
    TSS: "TSSE",
    TLE_ENCODED: "TENC",
    COM: "COMM",
    ULT: "USLT",
    PIC: "APIC",
    GEO: "GEOB",
    CNT: "PCNT",
    POP: "POPM",
    UFI: "UFID",
    SLT: "SYLT",
    RVA: "RVA2",
    TDY: "TDLY",
    TSA: "TSOA",
    TS2: "TSO2",
    TSP: "TSOP",
    TST: "TSOT",
    MVN: "MVNM",
    MVI: "MVIN",
  };
  return map[id] ?? id.padEnd(4, " ");
}



/* ---------------- field mapping ---------------- */

const NUM_PAIR = /^(\d+)\s*\/\s*(\d+)/;

function splitPair(v: string): [number | undefined, number | undefined] {
  const m = NUM_PAIR.exec(v.trim());
  if (!m) {
    const n = Number.parseInt(v.trim(), 10);
    return Number.isFinite(n) ? [n, undefined] : [undefined, undefined];
  }
  return [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10)];
}

export const ID3V1_GENRES = [
  "Blues","Classic Rock","Country","Dance","Disco","Funk","Grunge","Hip-Hop","Jazz","Metal",
  "New Age","Oldies","Other","Pop","R&B","Rap","Reggae","Rock","Techno","Industrial",
  "Alternative","Ska","Death Metal","Pranks","Soundtrack","Euro-Techno","Ambient","Trip-Hop","Vocal","Jazz+Funk",
  "Fusion","Trance","Classical","Instrumental","Acid","House","Game","Sound Clip","Gospel","Noise",
  "AlternRock","Bass","Soul","Punk","Space","Meditative","Instrumental Pop","Instrumental Rock","Ethnic","Gothic",
  "Darkwave","Techno-Industrial","Electronic","Pop-Folk","Eurodance","Dream","Southern Rock","Comedy","Cult","Gangsta",
  "Top 40","Christian Rap","Pop/Funk","Jungle","Native American","Cabaret","New Wave","Psychadelic","Rave","Showtunes",
  "Trailer","Lo-Fi","Tribal","Acid Punk","Acid Jazz","Polka","Retro","Musical","Rock & Roll","Hard Rock",
  "Folk","Folk-Rock","National Folk","Swing","Fast Fusion","Bebop","Latin","Revival","Celtic","Bluegrass",
  "Avantgarde","Gothic Rock","Progressive Rock","Psychedelic Rock","Symphonic Rock","Slow Rock","Big Band","Chorus","Easy Listening","Acoustic",
  "Humour","Speech","Chanson","Opera","Chamber Music","Sonata","Symphony","Booty Bass","Primus","Porn Groove",
  "Satire","Slow Jam","Club","Tango","Samba","Folklore","Ballad","Power Ballad","Rhythmic Soul","Freestyle",
  "Duet","Punk Rock","Drum Solo","A Cappella","Euro-House","Dance Hall","Goa","Drum & Bass","Club-House","Hardcore",
  "Terror","Indie","BritPop","Negerpunk","Polsk Punk","Beat","Christian Gangsta Rap","Heavy Metal","Black Metal","Crossover",
  "Contemporary Christian","Christian Rock","Merengue","Salsa","Thrash Metal","Anime","JPop","Synthpop","Abstract","Art Rock","Baroque",
  "Bhangra","Big Beat","Breakbeat","Chillout","Downtempo","Dub","EBM","Eclectic","Electro","Electroclash","Emo",
  "Experimental","Garage","Global","IDM","Illbient","Industro-Goth","Jam Band","Krautrock","Leftfield","Lounge",
  "Math Rock","New Romantic","Nu-Breakz","Post-Punk","Post-Rock","Psytrance","Shoegaze","Space Rock","Trop Rock","World Music",
  "Neoclassical","Audiobook","Audio Theatre","Neue Deutsche Welle","Podcast","Indie Rock","G-Funk","Dubstep","Garage Rock","Psybient",
];

/** Resolve an ID3v1 numeric genre or `(n)` reference to a name. */
export function resolveId3Genre(v: string): string {
  const t = v.trim();
  const paren = /^\((\d+)\)(.*)$/.exec(t);
  if (paren) {
    const rest = paren[2].trim();
    if (rest) return rest;
    return ID3V1_GENRES[Number.parseInt(paren[1], 10)] ?? t;
  }
  if (/^\d+$/.test(t)) {
    const i = Number.parseInt(t, 10);
    return ID3V1_GENRES[i] ?? t;
  }
  return t;
}

export interface Id3Extract {
  metadata: MusicMetadata;
  raw: RawTag[];
  artwork: Artwork[];
  warnings: string[];
}

export function extractId3(
  frames: Id3Frame[],
  warnings: string[],
  artworkPrefix: string,
): Id3Extract {
  const metadata: MusicMetadata = {};
  const raw: RawTag[] = [];
  const artwork: Artwork[] = [];
  const customFields: Record<string, string> = {};
  let artSeq = 0;

  const textOf = (f: Id3Frame) => decodeTextFrame(f.payload);

  const assignFirst = (key: string, vals: string[]) => {
    if (vals.length) (metadata as Record<string, unknown>)[key] = vals[0];
  };
  const assignMany = (key: string, vals: string[]) => {
    if (vals.length) (metadata as Record<string, unknown>)[key] = vals;
  };

  for (const f of frames) {
    const key = f.key;
    switch (key) {
      case "TIT2":
      case "TT2":
        assignFirst("title", textOf(f));
        break;
      case "TPE1":
      case "TP1":
        assignMany("artists", textOf(f));
        break;
      case "TPE2":
      case "TP2":
        assignMany("albumArtists", textOf(f));
        break;
      case "TALB":
      case "TAL":
        assignFirst("album", textOf(f));
        break;
      case "TCOM":
      case "TCM":
        assignMany("composers", textOf(f));
        break;
      case "TPE3":
      case "TP3":
        assignFirst("conductor", textOf(f));
        break;
      case "TRCK":
      case "TRK": {
        const [n, t] = splitPair(textOf(f)[0] ?? "");
        if (n !== undefined) metadata.trackNumber = n;
        if (t !== undefined) metadata.trackTotal = t;
        break;
      }
      case "TPOS":
      case "TPA": {
        const [n, t] = splitPair(textOf(f)[0] ?? "");
        if (n !== undefined) metadata.discNumber = n;
        if (t !== undefined) metadata.discTotal = t;
        break;
      }
      case "TYER":
      case "TDRC":
      case "TDRL":
      case "TDRL_":
      case "TYE": {
        const v = textOf(f)[0];
        if (v) {
          metadata.date = v;
          const y = /(\d{4})/.exec(v);
          if (y) metadata.year = Number.parseInt(y[1], 10);
        }
        break;
      }
      case "TCON":
      case "TCO": {
        const vals = textOf(f).map(resolveId3Genre);
        assignMany("genres", vals);
        break;
      }
      case "TIT1":
        assignFirst("grouping", textOf(f));
        break;
      case "TBPM":
      case "TBP": {
        const n = Number.parseFloat(textOf(f)[0] ?? "");
        if (Number.isFinite(n)) metadata.bpm = Math.round(n);
        break;
      }
      case "TKEY":
        assignFirst("key", textOf(f));
        break;
      case "TCOP":
      case "TCR":
        assignFirst("copyright", textOf(f));
        break;
      case "TPUB":
      case "TPB":
        assignFirst("publisher", textOf(f));
        break;
      case "TLAN":
      case "TEN":
        assignFirst("language", textOf(f));
        break;
      case "TSRC":
      case "TRC":
        assignFirst("isrc", textOf(f));
        break;
      case "TCMP":
      case "TCP":
        assignFirst("compilation", textOf(f));
        break;
      case "TENC":
      case "TEN2":
        assignFirst("encoder", textOf(f));
        break;
      case "TSSE":
      case "TSS":
        metadata.encoderSettings = textOf(f).join(" ");
        break;
      case "TLEN": {
        const n = Number.parseInt(textOf(f)[0] ?? "", 10);
        if (Number.isFinite(n)) metadata.replayGainTrackPeak = undefined;
        break;
      }
      case "UFID":
      case "UFI": {
        // owner\0identifier — MusicBrainz uses a well-known owner id.
        const nul = f.payload.indexOf(0);
        const owner = nul > 0 ? decodeLatin1(f.payload.subarray(0, nul)) : "";
        const id = nul > 0 ? trimNul(decodeUtf8(f.payload.subarray(nul + 1))) : "";
        if (id) {
          if (owner === "http://musicbrainz.org") metadata.musicBrainzRecordingId = id;
          else customFields[`UFID:${owner || "unknown"}`] = id;
        }
        break;
      }
      case "TXXX":
      case "TXX": {
        const vals = textOf(f);
        const desc = vals[0] ?? "";
        const value = vals.slice(1).join("\u0000");
        applyTxxx(metadata, customFields, desc, value);
        raw.push({ key: `TXXX:${desc}`, values: [value] });
        continue;
      }
      case "COMM":
      case "COM": {
        const text = readLangDescribedText(f.payload);
        const lang = readLanguage(f.payload);
        if (lang === "eng" || (text && !metadata.comment)) metadata.comment = text;
        raw.push({ key: `COMM:${lang}`, values: [text], description: readDescription(f.payload) });
        continue;
      }
      case "USLT":
      case "ULT": {
        const text = readLangDescribedText(f.payload);
        metadata.lyrics = text;
        raw.push({ key: "USLT", values: [text.slice(0, 4000)] });
        continue;
      }
      case "SYLT":
      case "SLT":
        raw.push({ key, values: [hexPreview(f.payload, 16)], binaryBytes: f.payload.length });
        continue;
      case "APIC":
      case "PIC": {
        const pic = parseApic(f.payload, f.key === "PIC" ? 2 : 3);
        if (!pic) {
          warnings.push(`${artworkPrefix} picture frame could not be parsed`);
          continue;
        }
        artwork.push(pic.art);
        raw.push({ key: "APIC", values: [pic.art.mime], description: pic.art.description });
        continue;
      }
      case "POPM":
      case "POP":
        raw.push({ key: "POPM", values: [hexPreview(f.payload, 12)], binaryBytes: f.payload.length });
        continue;
      case "PCNT": {
        const r = new ByteReader(f.payload, 0);
        const n = r.u32();
        metadata.customFields = { ...customFields, _playCount: String(n) };
        raw.push({ key: "PCNT", values: [String(n)] });
        continue;
      }
      case "RVA2": {
        const vals = decodeTextFrame(f.payload);
        const gain = vals[0];
        if (gain) {
          const name = decodeLatin1(f.payload.subarray(1, f.payload[0] === 3 ? 2 : 1));
          if (/track/i.test(name)) metadata.replayGainTrackGain = gain;
          else if (/album/i.test(name)) metadata.replayGainAlbumGain = gain;
          else customFields[`RVA2:${name}`] = gain;
        }
        raw.push({ key: "RVA2", values: vals });
        continue;
      }
      default:
        raw.push({
          key,
          values: isTextId(key) ? textOf(f) : [hexPreview(f.payload, 16)],
          binaryBytes: isTextId(key) ? undefined : f.payload.length,
        });
        continue;
    }

    const vals = isTextId(key) ? textOf(f) : [];
    raw.push({ key, values: vals.length ? vals : [hexPreview(f.payload, 12)], binaryBytes: vals.length ? undefined : f.payload.length });
  }

  metadata.artwork = artwork;
  if (Object.keys(customFields).length) metadata.customFields = customFields;
  void artSeq;

  return { metadata, raw, artwork, warnings };
}

function isTextId(key: string): boolean {
  return (key.startsWith("T") && key !== "TXXX" && key !== "TXX") || key === "UFID";
}

/**
 * COMM and USLT payloads are `<encoding><language:3><descriptor>\0<text>`.
 * The descriptor is null-terminated *in the frame's own encoding*, so UTF-16
 * descriptions terminate on a 00 00 pair rather than a single zero.
 */
const LANG_END = 4;

function readLanguage(payload: Uint8Array): string {
  return decodeLatin1(payload.subarray(1, LANG_END));
}

function readDescription(payload: Uint8Array): string {
  const { pos } = skipTerminated(payload, LANG_END, payload[0]);
  return pos < payload.length ? trimNul(decodeLatin1(payload.subarray(pos))) : "";
}

function readLangDescribedText(payload: Uint8Array): string {
  const { pos } = skipTerminated(payload, LANG_END, payload[0]);
  return decodeTextFramePayload(payload[0], payload.length - pos, payload, pos);
}

/** Advance past a null-terminated string in the given encoding. */
function skipTerminated(
  buf: Uint8Array,
  start: number,
  enc: number,
): { pos: number } {
  if (enc === 1 || enc === 2) {
    let i = start;
    while (i + 1 < buf.length) {
      if (buf[i] === 0 && buf[i + 1] === 0) return { pos: i + 2 };
      i += 2;
    }
    return { pos: buf.length };
  }
  let i = start;
  while (i < buf.length && buf[i] !== 0) i++;
  return { pos: Math.min(i + 1, buf.length) };
}

function decodeTextFramePayload(
  enc: number,
  byteLen: number,
  buf: Uint8Array,
  at: number,
): string {
  const fake = new Uint8Array(byteLen + 1);
  fake[0] = enc;
  fake.set(buf.subarray(at, at + byteLen), 1);
  return decodeTextFrame(fake)[0] ?? "";
}

function applyTxxx(
  metadata: MusicMetadata,
  customFields: Record<string, string>,
  desc: string,
  value: string,
) {
  const k = desc.toLowerCase();
  const set = (field: keyof MusicMetadata) => {
    (metadata as Record<string, unknown>)[field] = value;
  };
  if (k === "musicbrainz release track id" || k === "musicbrainz track id" || k === "musicbrainz_recordingid")
    set("musicBrainzRecordingId");
  else if (k === "musicbrainz album id" || k === "musicbrainz_albumid" || k === "musicbrainz release id")
    set("musicBrainzReleaseId");
  else if (k === "musicbrainz release group id" || k === "musicbrainz_releasegroupid")
    set("musicBrainzReleaseGroupId");
  else if (k === "musicbrainz work id" || k === "musicbrainz_workid") set("musicBrainzWorkId");
  else if (k === "barcode") set("barcode");
  else if (k === "catalognumber" || k === "catalog number") set("catalogNumber");
  else if (k === "isrc") set("isrc");
  else if (k === "label") set("label");
  else if (k === "replaygain_track_gain") set("replayGainTrackGain");
  else if (k === "replaygain_track_peak") set("replayGainTrackPeak");
  else if (k === "replaygain_album_gain") set("replayGainAlbumGain");
  else if (k === "replaygain_album_peak") set("replayGainAlbumPeak");
  else if (k === "labelid" || k === "label id") customFields.LABELID = value;
  else if (desc) customFields[desc] = value;
}

function pictureRoleFromType(t: string): ArtworkRole {
  switch (t) {
    case "3":
      return "front";
    case "4":
      return "back";
    case "2":
      return "artist";
    case "6":
      return "disc";
    case "7":
      return "leaflet";
    default:
      return "other";
  }
}

export function parseApic(payload: Uint8Array, kind: 2 | 3): { art: Artwork } | null {
  const r = new ByteReader(payload, 0);
  const enc = r.u8();
  let mime: string;
  if (kind === 2) {
    // PIC: fixed 3-char image format instead of a mime string.
    const fmt = r.ascii(3).toLowerCase();
    mime = fmt === "png" ? "image/png" : "image/jpeg";
  } else {
    let s = "";
    while (r.remaining > 0) {
      const b = r.u8();
      if (b === 0) break;
      s += String.fromCharCode(b);
    }
    mime = s || "image/jpeg";
  }
  const picType = r.u8();
  let description = "";
  const { pos } = skipTerminated(payload, r.pos, enc);
  if (pos > r.pos) description = trimNul(decodeLatin1(payload.subarray(r.pos, pos)));
  const data = r.slice(r.remaining);
  if (data.length === 0) return null;
  const probed = probeImage(data);
  return {
    art: {
      id: `apic-${Math.random().toString(36).slice(2, 10)}`,
      data,
      mime: mime || probed.mime,
      role: pictureRoleFromType(String.fromCharCode(picType)),
      description: description || undefined,
      width: probed.width,
      height: probed.height,
      bytes: data.length,
    },
  };
}

export function buildApic(art: { data: Uint8Array; mime: string; role: ArtworkRole; description?: string }): Id3Frame {
  const enc = 3; // UTF-8
  const typeCode = { front: 3, back: 4, artist: 2, disc: 6, leaflet: 7, other: 0 }[art.role];
  const w = new ByteWriter(art.data.length + 32);
  w.u8(enc);
  w.ascii(art.mime || "image/jpeg").u8(0);
  w.u8(typeCode);
  w.utf8(art.description ?? "").u8(0);
  w.bytes(art.data);
  return { key: "APIC", payload: w.toBytes(), encoding: enc };
}

export function buildUslt(text: string, language = "eng"): Id3Frame {
  const w = new ByteWriter(text.length * 2 + 16);
  w.u8(3).ascii(language).utf8("").u8(0).utf8(text);
  return { key: "USLT", payload: w.toBytes(), encoding: 3 };
}

export function buildComm(text: string, description = "", language = "eng"): Id3Frame {
  const w = new ByteWriter(text.length + 16);
  w.u8(3).ascii(language).utf8(description).u8(0).utf8(text);
  return { key: "COMM", payload: w.toBytes(), encoding: 3 };
}

export function buildTxxx(description: string, value: string): Id3Frame {
  const w = new ByteWriter(value.length + 16);
  w.u8(3).utf8(description).u8(0).utf8(value);
  return { key: "TXXX", payload: w.toBytes(), encoding: 3 };
}

export function buildTextFrame(key: string, values: string[]): Id3Frame | null {
  if (!values.length) return null;
  const w = new ByteWriter();
  w.u8(3).utf8(values.join("\u0000"));
  return { key, payload: w.toBytes(), encoding: 3 };
}

export function buildBinaryFrame(key: string, payload: Uint8Array): Id3Frame {
  return { key, payload };
}

/**
 * Serialise frames into an ID3v2.4 tag.
 *
 * `known` carries the frames we manage; `preserved` are raw payloads from
 * the source tag that we did not interpret. Preserved frames that share a
 * key with a managed frame are dropped to avoid duplicates.
 */
export function buildId3v2(
  known: Id3Frame[],
  preserved: Id3Frame[],
  opts: { padding?: number } = {},
): Uint8Array {
  const managedKeys = new Set(known.map((f) => f.key));
  const keep = preserved.filter((f) => !managedKeys.has(f.key));

  const frames = [...known, ...keep].filter(
    (f) => !/^\s*$/.test(f.key) && f.payload.length > 0,
  );

  const body = new ByteWriter(4096);
  for (const f of frames) {
    const payload =
      f.payload.length > 0x0fffffff ? unsync(f.payload) : f.payload;
    const needsUnsync = payload !== f.payload;
    body.ascii(f.key);
    // ID3v2.4 frame sizes are synchsafe. Writing them as plain u32 happens to
    // agree for payloads under 128 bytes and silently corrupts every larger
    // frame, so the size is encoded correctly on the way in.
    body.synchsafe(payload.length);
    body.u16(0x0000 | (needsUnsync ? 0x0002 : 0));
    body.bytes(payload);
  }
  const raw = body.toBytes();

  const padding = opts.padding ?? 0;
  const head = new ByteWriter(16);
  head.ascii("ID3").u8(4).u8(0).u8(0).zeros(4);
  head.patchSynchsafe(6, raw.length + padding);
  return concatBytes(head.toBytes(), raw, new Uint8Array(padding));
}

/* ---------------- ID3v1 ---------------- */

export interface Id3v1 {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  comment?: string;
  track?: number;
  genreIndex?: number;
}

export function parseId3v1(tail: Uint8Array): Id3v1 | null {
  if (tail.length < ID3V1_SIZE) return null;
  const b = tail.subarray(tail.length - ID3V1_SIZE);
  if (decodeLatin1(b.subarray(0, 3)) !== "TAG") return null;
  const text = (a: number, z: number) => trimNul(decodeLatin1(b.subarray(a, z))).trim();
  let comment = text(97, 127);
  let track: number | undefined;
  if (b[125] === 0 && b[126] !== 0) {
    // ID3v1.1: the track byte stole two comment bytes.
    comment = text(97, 125);
    track = b[126];
  }
  const out: Id3v1 = {
    title: text(3, 33) || undefined,
    artist: text(33, 63) || undefined,
    album: text(63, 93) || undefined,
    year: text(93, 97) || undefined,
    comment: comment || undefined,
    track,
    genreIndex: b[127],
  };
  return out;
}

export function buildId3v1(m: MusicMetadata): Uint8Array {
  const w = new ByteWriter(ID3V1_SIZE);
  w.ascii("TAG");
  const put = (v: string | undefined, len: number) => {
    const s = encodeLatin1(trimForV1(v ?? ""));
    w.bytes(s.subarray(0, len));
    if (s.length < len) w.zeros(len - s.length);
  };
  put(m.title, 30);
  put(m.artist ?? m.artists?.[0], 30);
  put(m.album, 30);
  put(m.year !== undefined ? String(m.year).slice(0, 4) : undefined, 4);
  if (m.trackNumber !== undefined) {
    put(m.comment, 28);
    w.zeros(1);
    w.u8(m.trackNumber & 0xff);
  } else {
    put(m.comment, 30);
  }
  const genreName = m.genre ?? m.genres?.[0] ?? "";
  const gi = ID3V1_GENRES.indexOf(genreName);
  w.u8(gi >= 0 ? gi : 255);
  return w.toBytes();
}

function trimForV1(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, " ").slice(0, 255);
}