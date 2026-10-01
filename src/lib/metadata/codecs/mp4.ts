/**
 * MP4 / M4A / M4B / ALAC codec — the `moov.udta.meta.ilst` atom tree.
 *
 * iTunes-style atoms use leading `©` (0xA9) and 4-char codes. Numeric atoms
 * (trkn, disk, tmpo) carry binary payloads rather than strings, so they get
 * bespoke encode/decode. Writing resizes `moov`, which shifts `mdat`, so
 * every `stco`/`co64` chunk offset is adjusted by the delta — otherwise the
 * file becomes unseekable and many players reject it.
 */

import { ByteReader, ByteWriter, concatBytes, probeImage } from "../binary";
import type { AudioProperties, Artwork, MusicMetadata, RawTag, ReadResult, WriteResult } from "../types";

export function isMp4(b: Uint8Array): boolean {
  return b.length >= 12 && String.fromCharCode(...b.subarray(4, 8)) === "ftyp";
}

interface Box {
  type: string;
  start: number;
  headerSize: number;
  size: number;
  dataStart: number;
  end: number;
}

function readBoxes(buf: Uint8Array, start: number, end: number, depth = 0): Box[] {
  const out: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    const dv = new DataView(buf.buffer, buf.byteOffset + at, Math.min(16, buf.length - at));
    let size = dv.getUint32(0);
    const type = String.fromCharCode(buf[at + 4], buf[at + 5], buf[at + 6], buf[at + 7]);
    let headerSize = 8;
    if (size === 1) {
      size = Number(dv.getBigUint64(8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < headerSize || at + size > end) break;
    out.push({ type, start: at, headerSize, size, dataStart: at + headerSize, end: at + size });
    at += size;
    if (depth > 6) break;
  }
  return out;
}

function findPath(buf: Uint8Array, boxes: Box[], path: string[]): Box | null {
  const [head, ...rest] = path;
  const box = boxes.find((b) => b.type === head);
  if (!box) return null;
  if (!rest.length) return box;
  // `meta` is a full box: 4 bytes of version/flags precede its children.
  const skip = head === "meta" ? 4 : 0;
  return findPath(buf, readBoxes(buf, box.dataStart + skip, box.end), rest);
}

const A9 = "©";

export function readMp4(head: Uint8Array): ReadResult | null {
  if (!isMp4(head)) return null;
  const warnings: string[] = [];
  const metadata = {} as MusicMetadata;
  const raw: RawTag[] = [];
  const artwork: Artwork[] = [];
  const custom: Record<string, string> = {};

  const top = readBoxes(head, 0, head.length);
  const moov = top.find((b) => b.type === "moov");
  if (!moov) {
    warnings.push("No `moov` box found; file may be truncated or still being written");
  }

  const ilst =
    (moov && findPath(head, readBoxes(head, moov.dataStart, moov.end), ["udta", "meta", "ilst"])) ||
    (moov && findPath(head, readBoxes(head, moov.dataStart, moov.end), ["meta", "ilst"]));

  const audio = readMp4Audio(head, top);

  if (ilst) {
    for (const atom of readBoxes(head, ilst.dataStart, ilst.end)) {
      const values = readAtomValues(head, atom);
      if (!values.length) continue;
      const key = atom.type;
      switch (key) {
        case `${A9}nam`:
          metadata.title = values[0];
          break;
        case `${A9}ART`:
          metadata.artists = values;
          break;
        case "aART":
          metadata.albumArtists = values;
          break;
        case `${A9}alb`:
          metadata.album = values[0];
          break;
        case `${A9}day`:
          metadata.date = values[0];
          if (/^\d{4}/.test(values[0])) metadata.year = Number.parseInt(values[0].slice(0, 4), 10);
          break;
        case `${A9}gen`:
          metadata.genres = values;
          break;
        case "gnre": {
          const n = Number.parseInt(values[0], 10);
          if (Number.isFinite(n) && !metadata.genres?.length) metadata.genres = [String(n)];
          break;
        }
        case `${A9}wrt`:
          metadata.composers = values;
          break;
        case `${A9}cmt`:
          metadata.comment = values[0];
          break;
        case "desc":
          if (!metadata.comment) metadata.comment = values[0];
          break;
        case `${A9}lyr`:
          metadata.lyrics = values[0];
          break;
        case "trkn": {
          const pair = readNumberPair(head, atom);
          if (pair[0] !== undefined) metadata.trackNumber = pair[0];
          if (pair[1] !== undefined) metadata.trackTotal = pair[1];
          break;
        }
        case "disk": {
          const pair = readNumberPair(head, atom);
          if (pair[0] !== undefined) metadata.discNumber = pair[0];
          if (pair[1] !== undefined) metadata.discTotal = pair[1];
          break;
        }
        case "tmpo": {
          const n = Math.round(Number.parseFloat(values[0]));
          if (Number.isFinite(n)) metadata.bpm = n;
          break;
        }
        case "cpil":
          metadata.compilation = values[0] === "1";
          break;
        case `${A9}too`:
          metadata.encoder = values[0];
          break;
        case "cprt":
          metadata.copyright = values[0];
          break;
        case "covr": {
          for (const { bytes, dataType } of covrPayloads(head, atom)) {
            const probed = probeImage(bytes);
            artwork.push({
              id: `covr-${Math.random().toString(36).slice(2, 10)}`,
              data: bytes,
              mime: dataType === 14 ? "image/png" : dataType === 27 ? "image/bmp" : probed.mime,
              role: "front",
              width: probed.width,
              height: probed.height,
              bytes: bytes.length,
            });
          }
          break;
        }
        case "----": {
          const name = readFreeformName(head, atom);
          const v = values[0];
          if (name === "Conductor") metadata.conductor = v;
          else if (name === "Grouping") metadata.grouping = v;
          else if (name === "Publisher") metadata.publisher = v;
          else if (name === "RELEASEDATE") metadata.date = v;
          else if (name === "MusicBrainz Track Id") metadata.musicBrainzRecordingId = v;
          else if (name === "MusicBrainz Album Id") metadata.musicBrainzReleaseId = v;
          else if (name === "MusicBrainz Release Group Id") metadata.musicBrainzReleaseGroupId = v;
          else if (name === "MusicBrainz Work Id") metadata.musicBrainzWorkId = v;
          else if (name === "BARCODE") metadata.barcode = v;
          else if (name === "CATALOGNUMBER") metadata.catalogNumber = v;
          else if (name === "ISRC") metadata.isrc = v;
          else if (name === "LABEL") metadata.label = v;
          else if (name === "initialkey") metadata.key = v;
          else if (name === "replaygain_track_gain") metadata.replayGainTrackGain = v;
          else if (name === "replaygain_track_peak") metadata.replayGainTrackPeak = v;
          else if (name === "replaygain_album_gain") metadata.replayGainAlbumGain = v;
          else if (name === "replaygain_album_peak") metadata.replayGainAlbumPeak = v;
          else if (name) custom[name] = v;
          break;
        }
        case "purd": // purchase date
        case "rtng":
        case "stik":
        case "pgap":
        case "hdvd":
        case "apID":
        case "cnID":
        case "plID":
        case "geID":
        case "sfID":
        case "atID":
        case "akID":
        case "cmID":
        case "xid ":
          break;
        default:
          raw.push({ key, values });
          continue;
      }
      raw.push({ key, values });
    }
  } else if (moov) {
    warnings.push("File contains no `ilst` atom — it has never been tagged");
  }

  metadata.artwork = artwork;
  if (Object.keys(custom).length) metadata.customFields = custom;

  return {
    metadata,
    raw,
    audio,
    formatInfo: { tagScheme: "MP4 ilst", preservedUnknown: true },
    warnings,
    layout: {
      headStart: 0,
      headEnd: moov ? moov.end : head.length,
      tailStart: 0,
      tailEnd: 0,
      variant: { container: "mp4", hasMoov: Boolean(moov), moovStart: moov?.start ?? -1 },
    },
  };
}

/** Every `data` payload inside a value atom. */
function readAtomValues(buf: Uint8Array, atom: Box): string[] {
  const out: string[] = [];
  for (const d of readBoxes(buf, atom.dataStart, atom.end)) {
    if (d.type !== "data") continue;
    if (d.size < 16) continue;
    const flags =
      (buf[d.dataStart] << 16) | (buf[d.dataStart + 1] << 8) | buf[d.dataStart + 2];
    const payload = buf.subarray(d.dataStart + 8, d.end);
    if (flags === 21) {
      const pairs: number[] = [];
      for (let i = 0; i + 1 < payload.length; i += 2) pairs.push((payload[i] << 8) | payload[i + 1]);
      out.push(String(pairs[0] ?? 0));
      if (pairs[1]) out.push(String(pairs[1]));
    } else {
      out.push(new TextDecoder("utf-8").decode(payload).replace(/\u0000+$/, ""));
    }
  }
  return out.filter((v) => v !== "");
}

/**
 * `trkn` / `disk` carry a binary pair: reserved u16, number u16, total u16,
 * reserved u16. The data atom's type field is 0 (implicit), so the bytes must
 * be decoded directly rather than as text.
 */
function readNumberPair(buf: Uint8Array, atom: Box): [number | undefined, number | undefined] {
  for (const d of readBoxes(buf, atom.dataStart, atom.end)) {
    if (d.type !== "data") continue;
    const payload = buf.subarray(d.dataStart + 8, d.end);
    if (payload.length < 6) return [undefined, undefined];
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const n = dv.getUint16(2);
    const total = dv.getUint16(4);
    return [n || undefined, total || undefined];
  }
  return [undefined, undefined];
}

function covrPayloads(buf: Uint8Array, atom: Box): Array<{ bytes: Uint8Array; dataType: number }> {
  const out: Array<{ bytes: Uint8Array; dataType: number }> = [];
  for (const d of readBoxes(buf, atom.dataStart, atom.end)) {
    if (d.type !== "data") continue;
    const dataType = buf[d.dataStart + 1] | (buf[d.dataStart + 2] << 8) | (buf[d.dataStart + 3] << 16);
    out.push({ bytes: buf.subarray(d.dataStart + 8, d.end).slice(), dataType });
  }
  return out;
}

function readFreeformName(buf: Uint8Array, atom: Box): string {
  for (const sub of readBoxes(buf, atom.dataStart, atom.end)) {
    if (sub.type !== "name") continue;
    return new TextDecoder("utf-8").decode(buf.subarray(sub.dataStart + 4, sub.end)).replace(/\u0000+$/, "");
  }
  return "";
}

function readMp4Audio(buf: Uint8Array, top: Box[]): AudioProperties {
  const moov = top.find((b) => b.type === "moov");
  if (!moov) return { container: "MP4" };
  const moovChildren = readBoxes(buf, moov.dataStart, moov.end);
  let result: AudioProperties = { container: "MP4" };
  let timescale = 0;
  let duration = 0;

  for (const child of moovChildren) {
    if (child.type === "mvhd") {
      const r = new ByteReader(buf, child.dataStart);
      const version = r.u8();
      r.u24();
      if (version === 1) {
        r.u64();
        r.u64();
        timescale = r.u32();
        duration = Number(r.u64());
      } else {
        r.u32();
        r.u32();
        timescale = r.u32();
        duration = r.u32();
      }
    } else if (child.type === "trak") {
      const track = readTrack(buf, child);
      if (track && (!result.sampleRate || track.codec === "alac")) {
        result = { ...result, ...track.props };
      }
    }
  }
  if (timescale > 0 && duration > 0 && !result.duration) {
    result.duration = duration / timescale;
  }
  return result;
}

function readTrack(buf: Uint8Array, trak: Box): { codec: string; props: AudioProperties } | null {
  const children = readBoxes(buf, trak.dataStart, trak.end);
  const tkhd = children.find((c) => c.type === "tkhd");
  if (!tkhd) return null;
  const tr = new ByteReader(buf, tkhd.dataStart);
  const version = tr.u8();
  tr.u24();
  if (version === 1) {
    tr.u64();
    tr.u64();
  } else {
    tr.u32();
    tr.u32();
  }
  tr.u32(); // track id
  tr.u32(); // reserved
  tr.u32(); // duration
  tr.pos += 8; // reserved
  tr.u16(); // layer
  tr.u16(); // alternate group
  tr.u16(); // volume
  tr.u16(); // reserved
  tr.pos += 36; // unity matrix
  tr.u32(); // width
  const height = tr.u32();

  const mdia = children.find((c) => c.type === "mdia");
  if (!mdia) return null;
  const mdiaChildren = readBoxes(buf, mdia.dataStart, mdia.end);
  const minf = mdiaChildren.find((c) => c.type === "minf");
  const stbl = minf && readBoxes(buf, minf.dataStart, minf.end).find((c) => c.type === "stbl");
  if (!stbl) return null;
  const stsd = readBoxes(buf, stbl.dataStart, stbl.end).find((c) => c.type === "stsd");
  if (!stsd) return null;

  // stsd: version/flags + entry count, then sample entries.
  const entries = readBoxes(buf, stsd.dataStart + 8, stsd.end);
  const entry = entries[0];
  if (!entry) return null;
  const codec = entry.type;
  const r = new ByteReader(buf, entry.dataStart + 16);
  const channels = r.u16();
  const sampleSize = r.u16();
  r.u16(); // pre_defined
  r.u16(); // reserved
  let sampleRate = r.u32() >>> 16; // 16.16 fixed point

  // The sample description box (esds / alac) carries the authoritative rate.
  let codecName = codec === "mp4a" ? "AAC" : codec === "alac" ? "ALAC" : codec;
  let bitDepth = sampleSize;
  for (const sub of readBoxes(buf, entry.dataStart + 28, entry.end)) {
    if (sub.type === "alac") {
      const ar = new ByteReader(buf, sub.dataStart);
      ar.u32(); // version/flags
      ar.u32(); // frameLength
      ar.u8(); // compatible version
      bitDepth = ar.u8();
      ar.u8(); // pb
      ar.u8(); // mb
      ar.u32(); // kb
      ar.u32(); // numChannels
      ar.u16(); // maxRun
      ar.u32(); // maxFrameBytes
      ar.u32(); // avgBitRate
      sampleRate = ar.u32();
      codecName = "ALAC";
    } else if (sub.type === "esds") {
      const er = new ByteReader(buf, sub.dataStart);
      er.u32();
      while (er.remaining > 1) {
        const tag = er.u8();
        let size = 0;
        for (let i = 0; i < 4; i++) {
          const b = er.u8();
          size = (size << 7) | (b & 0x7f);
          if (!(b & 0x80)) break;
        }
        if (tag === 0x03) {
          er.u16();
          er.u8();
          const flags = er.u8();
          if (flags & 0x80) er.u16();
          if (flags & 0x40) er.u8();
          if (flags & 0x20) er.u16();
        } else if (tag === 0x04) {
          const objectType = er.u8();
          const streamType = er.u8();
          const bu = er.u32();
          void streamType;
          void bu;
          if ((streamType >> 2) === 5) {
            const freqIndex = (objectType >> 2) & 0x0f;
            const RATES = [
              96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
              16000, 12000, 11025, 8000, 7350,
            ];
            sampleRate = RATES[freqIndex] ?? 0;
          }
        } else {
          er.pos += size;
        }
      }
    }
  }

  const props: AudioProperties = {
    codec: codecName,
    container: "MP4",
    lossless: codec === "alac",
    channels,
    bitDepth: codecName === "ALAC" ? bitDepth : undefined,
    sampleRate,
  };
  void height;
  return { codec, props };
}

/* ---------------- writing ---------------- */

function atom(type: string, payload: Uint8Array): Uint8Array {
  return new ByteWriter(payload.length + 8).u32(payload.length + 8).ascii(type).bytes(payload).toBytes();
}

function dataAtom(value: string, dataType = 1): Uint8Array {
  const payload = new TextEncoder().encode(value);
  return atom(
    "data",
    new ByteWriter(payload.length + 8).u32(dataType).u32(0).bytes(payload).toBytes(),
  );
}

function intAtom(value: number, dataType = 21): Uint8Array {
  return atom("data", new ByteWriter(8).u32(dataType).u32(0).u16(value & 0xffff).toBytes());
}

function trknAtom(track: number, total?: number): Uint8Array {
  const p = new ByteWriter(8).u16(0).u16(track).u16(total ?? 0).u16(0).toBytes();
  return atom("data", new ByteWriter(12).u32(0).u32(0).bytes(p).toBytes());
}

function freeformAtom(name: string, value: string): Uint8Array {
  const mean = atom("mean", new ByteWriter(4).ascii("com.apple.iTunes").toBytes());
  const n = atom("name", new ByteWriter(name.length + 4).ascii(name).toBytes());
  return atom("----", concatBytes(mean, n, dataAtom(value)));
}

export function buildIlst(metadata: MusicMetadata, preserved: RawTag[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const add = (type: string, payload: Uint8Array) => parts.push(atom(type, payload));

  if (metadata.title) add(`${A9}nam`, dataAtom(metadata.title));
  for (const a of metadata.artists ?? []) add(`${A9}ART`, dataAtom(a));
  if (metadata.album) add(`${A9}alb`, dataAtom(metadata.album));
  for (const a of metadata.albumArtists ?? []) add("aART", dataAtom(a));
  for (const c of metadata.composers ?? []) add(`${A9}wrt`, dataAtom(c));
  if (metadata.conductor) add("----", freeformAtom("Conductor", metadata.conductor));
  if (metadata.grouping) add("----", freeformAtom("Grouping", metadata.grouping));
  if (metadata.publisher) add("----", freeformAtom("Publisher", metadata.publisher));
  if (metadata.comment) add(`${A9}cmt`, dataAtom(metadata.comment));
  if (metadata.lyrics) add(`${A9}lyr`, dataAtom(metadata.lyrics));
  if (metadata.genres?.length) for (const g of metadata.genres) add(`${A9}gen`, dataAtom(g));
  if (metadata.date) add(`${A9}day`, dataAtom(metadata.date));
  if (metadata.bpm !== undefined) add("tmpo", intAtom(metadata.bpm));
  if (metadata.compilation !== undefined) add("cpil", dataAtom(metadata.compilation ? "1" : "0", 21));
  if (metadata.trackNumber !== undefined || metadata.trackTotal !== undefined) {
    add("trkn", trknAtom(metadata.trackNumber ?? 0, metadata.trackTotal));
  }
  if (metadata.discNumber !== undefined) {
    add("disk", trknAtom(metadata.discNumber, metadata.discTotal));
  }
  if (metadata.copyright) add("cprt", dataAtom(metadata.copyright));
  if (metadata.encoder) add(`${A9}too`, dataAtom(metadata.encoder));
  if (metadata.musicBrainzRecordingId)
    add("----", freeformAtom("MusicBrainz Track Id", metadata.musicBrainzRecordingId));
  if (metadata.musicBrainzReleaseId)
    add("----", freeformAtom("MusicBrainz Album Id", metadata.musicBrainzReleaseId));
  if (metadata.musicBrainzReleaseGroupId)
    add("----", freeformAtom("MusicBrainz Release Group Id", metadata.musicBrainzReleaseGroupId));
  if (metadata.musicBrainzWorkId)
    add("----", freeformAtom("MusicBrainz Work Id", metadata.musicBrainzWorkId));
  if (metadata.barcode) add("----", freeformAtom("BARCODE", metadata.barcode));
  if (metadata.catalogNumber) add("----", freeformAtom("CATALOGNUMBER", metadata.catalogNumber));
  if (metadata.isrc) add("----", freeformAtom("ISRC", metadata.isrc));
  if (metadata.label) add("----", freeformAtom("LABEL", metadata.label));
  if (metadata.key) add("----", freeformAtom("initialkey", metadata.key));
  if (metadata.replayGainTrackGain)
    add("----", freeformAtom("replaygain_track_gain", metadata.replayGainTrackGain));
  if (metadata.replayGainTrackPeak)
    add("----", freeformAtom("replaygain_track_peak", metadata.replayGainTrackPeak));
  if (metadata.replayGainAlbumGain)
    add("----", freeformAtom("replaygain_album_gain", metadata.replayGainAlbumGain));
  if (metadata.replayGainAlbumPeak)
    add("----", freeformAtom("replaygain_album_peak", metadata.replayGainAlbumPeak));

  for (const [k, v] of Object.entries(metadata.customFields ?? {})) {
    if (k.startsWith("_")) continue;
    add("----", freeformAtom(k, v));
  }

  const front = metadata.artwork?.[0];
  if (front) {
    const type = front.mime === "image/png" ? 14 : front.mime === "image/bmp" ? 27 : 13;
    add(
      "covr",
      atom("data", new ByteWriter(front.data.length + 8).u32(type).u32(0).bytes(front.data).toBytes()),
    );
  }

  // Preserve atoms we do not manage so nothing is lost.
  const managed = new Set([
    `${A9}nam`, `${A9}ART`, `${A9}alb`, "aART", `${A9}wrt`, `${A9}cmt`, `${A9}lyr`,
    `${A9}gen`, `${A9}day`, "tmpo", "cpil", "trkn", "disk", "cprt", `${A9}too`,
    "covr", "----",
  ]);
  for (const tag of preserved) {
    if (managed.has(tag.key)) continue;
    if (tag.binaryBytes !== undefined) continue;
    add(tag.key, dataAtom(tag.values[0] ?? ""));
  }

  return atom("ilst", concatBytes(...parts));
}



export function writeMp4(
  original: Uint8Array,
  metadata: MusicMetadata,
  preserved: RawTag[],
): WriteResult {
  const warnings: string[] = [];
  const top = readBoxes(original, 0, original.length);
  const moov = top.find((b) => b.type === "moov");
  if (!moov) {
    return {
      bytes: original,
      bytesWritten: 0,
      warnings: ["No `moov` box found — the file was left unchanged"],
    };
  }

  const ilst = buildIlst(metadata, preserved);
  const newMoov = rebuildMoov(original, moov, ilst);
  const delta = newMoov.length - (moov.end - moov.start);

  const parts: Uint8Array[] = [];
  for (const b of top) {
    if (b.type === "moov") parts.push(newMoov);
    else parts.push(original.subarray(b.start, b.end));
  }

  let bytes = concatBytes(...parts);
  const mdatAfter = top.findIndex((b) => b.type === "mdat" && b.start > moov.start) !== -1;
  if (delta !== 0 && mdatAfter) {
    bytes = adjustChunkOffsets(bytes, delta);
    warnings.push(`moov grew by ${delta} bytes; ${top.length} chunk offsets were re-based`);
  }

  return { bytes, bytesWritten: delta, warnings };
}

/** Rebuild `moov` with a fresh `ilst`, keeping every other child verbatim. */
function rebuildMoov(original: Uint8Array, moov: Box, ilst: Uint8Array): Uint8Array {
  const children = readBoxes(original, moov.dataStart, moov.end);
  const w = new ByteWriter(moov.size + ilst.length + 64);

  for (const child of children) {
    if (child.type === "udta") {
      const udtaChildren = readBoxes(original, child.dataStart, child.end);
      const hdlrIdx = udtaChildren.findIndex((c) => c.type === "hdlr");
      const meta = buildMeta(original, udtaChildren, ilst);
      const parts: Uint8Array[] = [];
      for (const c of udtaChildren) {
        if (c.type === "meta") parts.push(meta);
        else parts.push(original.subarray(c.start, c.end));
      }
      if (hdlrIdx === -1) parts.unshift(buildHdlr());
      w.bytes(atom("udta", concatBytes(...parts)));
      continue;
    }
    if (child.type === "meta") {
      w.bytes(buildMeta(original, readBoxes(original, child.dataStart + 4, child.end), ilst));
      continue;
    }
    w.bytes(original.subarray(child.start, child.end));
  }

  const body = w.toBytes();
  return new ByteWriter(body.length + 8).u32(body.length + 8).ascii("moov").bytes(body).toBytes();
}

function buildMeta(original: Uint8Array, metaChildren: Box[], ilst: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array(4)]; // version + flags
  for (const c of metaChildren) {
    if (c.type === "ilst") continue;
    parts.push(original.subarray(c.start, c.end));
  }
  parts.push(ilst);
  return atom("meta", concatBytes(...parts));
}

function buildHdlr(): Uint8Array {
  const payload = new ByteWriter()
    .u32(0)
    .u32(0)
    .ascii("mdir")
    .ascii("appl")
    .zeros(9)
    .toBytes();
  return atom("hdlr", payload);
}

/**
 * Add `delta` to every `stco`/`co64` entry. Only needed when `mdat` sits
 * after `moov`, which is the common (non-faststart) layout.
 */
function adjustChunkOffsets(bytes: Uint8Array, delta: number): Uint8Array {
  const copy = bytes.slice();
  const dv = new DataView(copy.buffer);
  const scan = (from: number, to: number, depth: number) => {
    let at = from;
    while (at + 8 <= to) {
      let size = dv.getUint32(at);
      const type = String.fromCharCode(copy[at + 4], copy[at + 5], copy[at + 6], copy[at + 7]);
      let header = 8;
      if (size === 1) {
        size = Number(dv.getBigUint64(at + 8));
        header = 16;
      } else if (size === 0) {
        size = to - at;
      }
      if (size < header || at + size > to) break;
      if (type === "stco" || type === "co64") {
        const count = dv.getUint32(at + header + 4);
        for (let i = 0; i < count; i++) {
          const p = at + header + 8 + i * (type === "stco" ? 4 : 8);
          if (type === "stco") dv.setUint32(p, dv.getUint32(p) + delta);
          else dv.setBigUint64(p, BigInt(dv.getBigUint64(p)) + BigInt(delta));
        }
      } else if (depth < 8) {
        scan(at + header, at + size, depth + 1);
      }
      at += size;
    }
  };
  scan(0, copy.length, 0);
  return copy;
}