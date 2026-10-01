/**
 * Ogg container codec — Vorbis, Opus, Speex and FLAC-in-Ogg.
 *
 * The container is a chain of pages; the header packets live in the leading
 * run of pages whose granule position is 0. A write rebuilds that run and
 * leaves every audio page byte-identical (renumbering sequence ids so the
 * page chain stays contiguous, as the spec requires).
 */

import { ByteReader, ByteWriter, concatBytes } from "../binary";
import type { AudioProperties, MusicMetadata, RawTag, ReadResult, WriteResult } from "../types";
import { composeComments, extractComments, type CommentList } from "./comment-map";
import { buildVorbisComment, parseVorbisComment } from "./vorbis";

export type OggCodec = "vorbis" | "opus" | "speex" | "flac" | "unknown";

export interface OggPage {
  start: number;
  end: number;
  headerType: number;
  granule: number;
  serial: number;
  seq: number;
  dataOffset: number;
  lacing: number[];
  bytes: Uint8Array;
}

export function isOgg(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53; // "OggS"
}

export function parseOggPages(buf: Uint8Array, limit = 8): OggPage[] {
  const pages: OggPage[] = [];
  let at = 0;
  while (at + 27 <= buf.length && pages.length < limit) {
    if (!(buf[at] === 0x4f && buf[at + 1] === 0x67 && buf[at + 2] === 0x67 && buf[at + 3] === 0x53)) break;
    const headerType = buf[at + 5];
    const dv = new DataView(buf.buffer, buf.byteOffset + at, buf.length - at);
    const granule = Number(dv.getBigInt64(6, true));
    const serial = dv.getUint32(14, true);
    const seq = dv.getUint32(18, true);
    const segCount = buf[at + 26];
    if (at + 27 + segCount > buf.length) break;
    const lacing: number[] = [];
    let total = 0;
    for (let i = 0; i < segCount; i++) {
      lacing.push(buf[at + 27 + i]);
      total += buf[at + 27 + i];
    }
    const dataOffset = at + 27 + segCount;
    const end = Math.min(buf.length, dataOffset + total);
    pages.push({ start: at, end, headerType, granule, serial, seq, dataOffset, lacing, bytes: buf.subarray(at, end) });
    if (end <= at) break;
    at = end;
  }
  return pages;
}

/** Reassemble complete packets from a run of pages. */
export function packetsFromPages(pages: OggPage[], src: Uint8Array): Uint8Array[] {
  const packets: Uint8Array[] = [];
  let current: number[] = [];
  for (const page of pages) {
    let cursor = page.dataOffset - page.start;
    for (const seg of page.lacing) {
      for (let i = 0; i < seg; i++) current.push(src[page.start + cursor + i]);
      cursor += seg;
      if (seg < 255) {
        packets.push(Uint8Array.from(current));
        current = [];
      }
    }
  }
  if (current.length) packets.push(Uint8Array.from(current));
  return packets;
}

export interface OggParse extends ReadResult {
  codec: OggCodec;
  serial: number;
  vendor: string;
  /** The codec's identification packet, re-emitted verbatim on write. */
  headPacket: Uint8Array;
  preservedComments: CommentList;
  preservedPackets: Uint8Array[];
  preservedBlocks: Uint8Array[];
  audioPages: Uint8Array[];
  headerPageCount: number;
}

export function readOgg(head: Uint8Array): OggParse | null {
  if (!isOgg(head)) return null;
  const warnings: string[] = [];
  const pages = parseOggPages(head);
  if (!pages.length) {
    warnings.push("Ogg stream has no readable pages");
    return null;
  }

  // Header pages carry granule 0; the first audio page does not.
  let headerCount = 0;
  for (const p of pages) {
    if (p.granule === 0) headerCount++;
    else break;
  }
  if (headerCount === 0) headerCount = Math.min(1, pages.length);

  const headerPages = pages.slice(0, headerCount);
  const audioPages = pages.slice(headerCount);
  const packets = packetsFromPages(headerPages, head);

  const metadata = {} as MusicMetadata;
  const raw: RawTag[] = [];
  let codec: OggCodec = "unknown";
  let vendor = "";
  let preservedComments: CommentList = [];
  const preservedPackets: Uint8Array[] = [];
  const preservedBlocks: Uint8Array[] = [];

  const first = packets[0];
  if (!first) return null;

  if (first[0] === 0x01 && first[1] === 0x76 && first[2] === 0x6f && first[3] === 0x72 && first[4] === 0x62) {
    codec = "vorbis";
    for (let i = 0; i < packets.length; i++) {
      if (packets[i][0] === 0x03 && matches(packets[i], 1, "vorbis")) {
        const body = packets[i].subarray(7);
        const comment = parseVorbisComment(body);
        if (comment) {
          vendor = comment.vendor;
          preservedComments = comment.comments;
          const ex = extractComments(comment, { pictureAsBase64: true });
          Object.assign(metadata, ex.metadata);
          raw.push(...ex.raw);
          warnings.push(...ex.warnings);
        }
      } else if (i > 0) {
        preservedPackets.push(packets[i]);
      }
    }
  } else if (matches(first, 0, "OpusHead")) {
    codec = "opus";
    for (let i = 0; i < packets.length; i++) {
      if (matches(packets[i], 0, "OpusTags")) {
        const comment = parseVorbisComment(packets[i].subarray(8));
        if (comment) {
          vendor = comment.vendor;
          preservedComments = comment.comments;
          const ex = extractComments(comment, { pictureAsBase64: true });
          Object.assign(metadata, ex.metadata);
          raw.push(...ex.raw);
          warnings.push(...ex.warnings);
        }
      } else if (i > 0) {
        preservedPackets.push(packets[i]);
      }
    }
  } else if (matches(first, 0, "Speex   ")) {
    codec = "speex";
    for (let i = 0; i < packets.length; i++) {
      if (i > 0) {
        const body = packets[i][0] === 0x01 ? packets[i].subarray(1) : packets[i];
        const comment = parseVorbisComment(body);
        if (comment) {
          vendor = comment.vendor;
          preservedComments = comment.comments;
          const ex = extractComments(comment, { pictureAsBase64: true });
          Object.assign(metadata, ex.metadata);
          raw.push(...ex.raw);
          warnings.push(...ex.warnings);
        } else {
          preservedPackets.push(packets[i]);
        }
      }
    }
  } else if (first[0] === 0x7f && matches(first, 1, "FLAC")) {
    codec = "flac";
    // The mapping header embeds the native metadata blocks, including the
    // Vorbis comment block we want to rewrite.
    const after = first.subarray(9);
    const r = new ByteReader(after, 0);
    if (after.length > 4 && after[0] === 0x66) {
      r.pos = 4;
      for (;;) {
        if (r.remaining < 4) break;
        const hb = r.u8();
        const last = (hb & 0x80) !== 0;
        const type = hb & 0x7f;
        const len = r.u24();
        if (len > r.remaining) break;
        const data = r.slice(len).slice();
        if (type === 4) {
          const comment = parseVorbisComment(data);
          if (comment) {
            vendor = comment.vendor;
            preservedComments = comment.comments;
            const ex = extractComments(comment, { pictureAsBase64: true });
            Object.assign(metadata, ex.metadata);
            raw.push(...ex.raw);
            warnings.push(...ex.warnings);
          }
        } else if (type !== 1) {
          preservedBlocks.push(
            new ByteWriter().bytes(after.subarray(0, 4)).u8(hb & 0x7f).u24(len).bytes(data).toBytes(),
          );
        }
        if (last) break;
      }
    }
    if (packets.length > 1) preservedPackets.push(packets[1]);
  } else {
    warnings.push("Unrecognised Ogg codec header; metadata not read");
    codec = "unknown";
  }

  const audio = readOggAudioProps(head, codec, pages);
  const headEnd = headerPages.length ? headerPages[headerPages.length - 1].end : 0;

  return {
    codec,
    serial: pages[0].serial,
    vendor,
    headPacket: first,
    preservedComments,
    preservedPackets,
    preservedBlocks,
    audioPages: audioPages.map((p) => p.bytes),
    headerPageCount: headerCount,
    metadata,
    raw,
    audio,
    formatInfo: {
      tagScheme: "Vorbis Comment",
      tagVersion: `Ogg ${codec}${vendor ? `, vendor "${vendor.slice(0, 48)}"` : ""}`,
      preservedUnknown: true,
    },
    warnings,
    layout: {
      headStart: 0,
      headEnd,
      tailStart: 0,
      tailEnd: 0,
      variant: { container: "ogg", codec },
    },
  };
}

function matches(b: Uint8Array, offset: number, s: string): boolean {
  if (b.length < offset + s.length) return false;
  for (let i = 0; i < s.length; i++) if (b[offset + i] !== s.charCodeAt(i)) return false;
  return true;
}

function readOggAudioProps(
  head: Uint8Array,
  codec: OggCodec,
  pages: OggPage[],
): AudioProperties {
  const first = packetsFromPages([pages[0]], head)[0];
  if (!first) return {};
  const r = new ByteReader(first, 0);

  if (codec === "vorbis") {
    // [1]"vorbis" | version u32 | channels u8 | rate u32 | bitrate_max u32
    // | bitrate_nominal u32 | bitrate_min u32 | blocksize u8 | framing u8
    r.pos = 7;
    r.u32le(); // vorbis version
    const channels = r.u8();
    const sampleRate = r.u32le();
    const brMax = r.u32le();
    const brNominal = r.u32le();
    r.u32le(); // bitrate minimum
    return {
      codec: "Vorbis",
      container: "Ogg",
      lossless: false,
      channels,
      sampleRate,
      bitrate: brNominal || brMax,
      bitrateMode: brNominal && brMax ? "VBR" : brNominal ? "CBR" : "?",
      duration: lastGranuleDuration(pages, sampleRate),
    };
  }
  if (codec === "opus") {
    // "OpusHead" | version u8 | channels u8 | pre-skip u16 | input rate u32
    // | output gain u16 | mapping family u8
    r.pos = 8;
    r.u8(); // version
    const channels = r.u8();
    const preSkip = r.u16();
    const last = pages[pages.length - 1];
    // Opus granule positions are always counted at 48 kHz.
    const duration = Math.max(0, last.granule - preSkip) / 48000;
    return {
      codec: "Opus",
      container: "Ogg",
      lossless: false,
      channels,
      sampleRate: 48000,
      duration,
      bitrateMode: "VBR",
    };
  }
  if (codec === "speex") {
    // "Speex   " | speex_version[20] | version_id u32 | header_size u32
    // | rate u32 | mode u32 | mode_bitstream_version u32 | nb_channels u32
    r.pos = 8;
    r.ascii(20);
    r.u32le(); // version id
    r.u32le(); // header size
    const rate = r.u32le();
    r.u32le(); // mode
    r.u32le(); // mode bitstream version
    const channels = r.u32le();
    return {
      codec: "Speex",
      container: "Ogg",
      lossless: false,
      channels,
      sampleRate: rate,
      duration: lastGranuleDuration(pages, rate),
    };
  }
  if (codec === "flac") {
    return { codec: "FLAC", container: "Ogg", lossless: true };
  }
  return { container: "Ogg" };
}

function lastGranuleDuration(pages: OggPage[], sampleRate: number): number | undefined {
  if (!sampleRate) return undefined;
  let last = 0;
  for (const p of pages) if (p.granule > last) last = p.granule;
  return last > 0 ? last / sampleRate : undefined;
}

/* ---------------- writing ---------------- */

export function writeOgg(
  original: Uint8Array,
  metadata: MusicMetadata,
  parsed: OggParse,
  vendor: string,
): WriteResult {
  const comments = composeComments(metadata, parsed.preservedComments, { pictureAsBase64: true });
  const commentBytes = buildVorbisComment(vendor || parsed.vendor, comments);
  const packets: Uint8Array[] = [];

  switch (parsed.codec) {
    case "vorbis":
      // Identification packet is re-emitted byte-for-byte.
      packets.push(parsed.headPacket);
      packets.push(
        new ByteWriter(commentBytes.length + 16)
          .bytes([0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73])
          .bytes(commentBytes)
          .u8(1) // framing bit
          .toBytes(),
      );
      for (const p of parsed.preservedPackets) packets.push(p);
      break;
    case "opus":
      packets.push(parsed.headPacket); // OpusHead
      packets.push(
        new ByteWriter(commentBytes.length + 16)
          .ascii("OpusTags")
          .bytes(commentBytes)
          .toBytes(),
      );
      for (const p of parsed.preservedPackets) packets.push(p);
      break;
    case "speex":
      packets.push(parsed.headPacket);
      packets.push(
        new ByteWriter(commentBytes.length + 16)
          .bytes(commentBytes)
          .u8(1)
          .toBytes(),
      );
      for (const p of parsed.preservedPackets) packets.push(p);
      break;
    case "flac":
      packets.push(parsed.headPacket);
      for (const b of parsed.preservedBlocks) packets.push(b);
      packets.push(commentBytes);
      for (const p of parsed.preservedPackets) packets.push(p);
      break;
    default:
      return {
        bytes: original,
        bytesWritten: 0,
        warnings: ["Unrecognised Ogg codec; the file was left unchanged"],
      };
  }

  const headerPageBytes = buildPages(packets, parsed.serial, 0);
  // Audio pages keep their bytes but need contiguous sequence numbers.
  const seqDelta = countPages(packets) - parsed.headerPageCount;

  const audioParts: Uint8Array[] = [headerPageBytes];
  for (const page of parsed.audioPages) {
    audioParts.push(seqDelta === 0 ? page : renumberPage(page, parsed.serial, seqDelta));
  }
  return {
    bytes: concatBytes(...audioParts),
    bytesWritten: headerPageBytes.length,
    warnings: [],
  };
}

function countPages(packets: Uint8Array[]): number {
  // Same chunking rule as buildPages: at most 255 lacing values per page.
  let pages = 1;
  let segs = 0;
  for (const p of packets) {
    const l = lace(p);
    if (segs + l.length > 255 && segs > 0) {
      pages++;
      segs = 0;
    }
    segs += l.length;
    if (segs === 255) {
      pages++;
      segs = 0;
    }
  }
  return pages;
}

function lace(packet: Uint8Array): number[] {
  const out: number[] = [];
  let remaining = packet.length;
  while (remaining >= 255) {
    out.push(255);
    remaining -= 255;
  }
  out.push(remaining);
  return out;
}

function buildPages(packets: Uint8Array[], serial: number, firstSeq: number): Uint8Array {
  const pages: Uint8Array[] = [];
  let pending: number[] = [];
  let payload: number[] = [];
  let seq = firstSeq;
  let pageIndex = 0;
  const pageCount = countPages(packets);

  const flush = () => {
    if (!pending.length) return;
    const w = new ByteWriter(payload.length + 32 + pending.length);
    w.ascii("OggS").u8(0);
    w.u8(pageIndex === 0 ? 0x02 : 0x00); // BOS on the first header page
    w.u64(0); // granule position: header packets have none
    w.u32(serial).u32(seq);
    w.u32(0); // CRC placeholder
    w.u8(pending.length);
    for (const l of pending) w.u8(l);
    w.bytes(Uint8Array.from(payload));
    const page = w.toBytes();
    const crc = oggCrc(page);
    const dv = new DataView(page.buffer, page.byteOffset, page.byteLength);
    dv.setUint32(22, crc, true);
    pages.push(page);
    pending = [];
    payload = [];
    seq++;
    pageIndex++;
  };

  for (const packet of packets) {
    const l = lace(packet);
    if (pending.length + l.length > 255 && pending.length > 0) flush();
    pending.push(...l);
    for (const b of packet) payload.push(b);
  }
  flush();
  void pageCount;
  return concatBytes(...pages);
}

function renumberPage(page: Uint8Array, serial: number, delta: number): Uint8Array {
  const copy = page.slice();
  const dv = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  dv.setUint32(18, dv.getUint32(18, true) + delta, true);
  dv.setUint32(14, serial, true);
  dv.setUint32(22, 0, true);
  dv.setUint32(22, oggCrc(copy), true);
  return copy;
}

/** Ogg's CRC-32: poly 0x04c11db7, no reflection, no final XOR. */
export function oggCrc(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 24;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
      crc >>>= 0;
    }
  }
  return crc >>> 0;
}