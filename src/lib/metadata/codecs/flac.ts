/**
 * FLAC codec: native metadata block sequence + STREAMINFO audio properties.
 *
 * Read walks the block chain and keeps every block it does not own, so a
 * write round-trips SEEKTABLE, CUESHEET and APPLICATION blocks untouched.
 */

import { ByteReader, ByteWriter, concatBytes } from "../binary";
import type { Artwork, AudioProperties, MusicMetadata, RawTag, ReadResult, WriteResult } from "../types";
import { composeComments, extractComments, type CommentList } from "./comment-map";
import {
  buildVorbisComment,
  decodePictureBlock,
  encodePictureBlock,
  parseVorbisComment,
} from "./vorbis";

const FLAC_MAGIC = [0x66, 0x4c, 0x61, 0x43]; // "fLaC"

export const BLOCK_STREAMINFO = 0;
export const BLOCK_PADDING = 1;
export const BLOCK_APPLICATION = 2;
export const BLOCK_SEEKTABLE = 3;
export const BLOCK_VORBIS_COMMENT = 4;
export const BLOCK_CUESHEET = 5;
export const BLOCK_PICTURE = 6;

export interface FlacBlock {
  type: number;
  data: Uint8Array;
  /** Absolute offset of the 4-byte block header. */
  offset: number;
  totalBytes: number;
}

export function isFlac(b: Uint8Array): boolean {
  return b.length >= 4 && FLAC_MAGIC.every((v, i) => b[i] === v);
}

export interface FlacReadResult extends ReadResult {
  preservedComments: CommentList;
}

export function readFlac(head: Uint8Array): FlacReadResult | null {
  if (!isFlac(head)) return null;
  const warnings: string[] = [];
  const r = new ByteReader(head, 4);
  const blocks: FlacBlock[] = [];
  let streaminfo: Uint8Array | null = null;
  let preservedComments: CommentList = [];

  for (;;) {
    if (r.remaining < 4) {
      warnings.push("Metadata block chain is truncated");
      break;
    }
    const headerByte = r.u8();
    const last = (headerByte & 0x80) !== 0;
    const type = headerByte & 0x7f;
    const len = r.u24();
    if (len > r.remaining) {
      warnings.push(`Metadata block ${type} claims ${len} bytes but only ${r.remaining} remain`);
      break;
    }
    const data = r.slice(len).slice();
    blocks.push({ type, data, offset: 0, totalBytes: 4 + len });
    if (type === BLOCK_STREAMINFO) streaminfo = data;
    if (last) break;
  }

  const metadata = {} as MusicMetadata;
  const raw: RawTag[] = [];
  const artwork: Artwork[] = [];
  let vendor = "reference libFLAC";

  for (const b of blocks) {
    if (b.type === BLOCK_VORBIS_COMMENT) {
      const comment = parseVorbisComment(b.data);if (comment) {
          vendor = comment.vendor;
          preservedComments = comment.comments;
        const ex = extractComments(comment, { pictureAsBase64: false });
        Object.assign(metadata, ex.metadata);
        raw.push(...ex.raw);
        artwork.push(...ex.artwork);
        warnings.push(...ex.warnings);
      } else {
        warnings.push("Vorbis comment block could not be parsed");
      }
    } else if (b.type === BLOCK_PICTURE) {
      const art = decodePictureBlock(b.data);
      if (art) {
        artwork.push(art);
        raw.push({ key: "PICTURE", values: [art.mime], description: art.role });
      } else {
        warnings.push("PICTURE block could not be parsed");
      }
    } else if (b.type === BLOCK_STREAMINFO) {
      raw.push({ key: "STREAMINFO", values: [describeStreaminfo(b.data)], binaryBytes: b.data.length });
    } else if (b.type !== BLOCK_PADDING) {
      raw.push({ key: `BLOCK:${b.type}`, values: [`${b.data.length} bytes`], binaryBytes: b.data.length });
    }
  }

  metadata.artwork = artwork;
  const audio = readStreaminfo(streaminfo, head.length + blocks.length);

  const headEnd = 4 + blocks.reduce((n, b) => n + b.totalBytes, 0);
  return {
    preservedComments,
    metadata,
    raw,
    audio,
    formatInfo: {
      tagScheme: "Vorbis Comment",
      tagVersion: `FLAC block chain, vendor "${vendor.slice(0, 48)}"`,
      preservedUnknown: true,
    },
    warnings,
    layout: {
      headStart: 0,
      headEnd,
      tailStart: 0,
      tailEnd: 0,
      variant: { codec: "flac", preservedBlocks: blocks.filter((b) => b.type !== BLOCK_PADDING && b.type !== BLOCK_VORBIS_COMMENT && b.type !== BLOCK_PICTURE).length },
    },
  };
}

export function parseStreaminfo(data: Uint8Array) {
  const r = new ByteReader(data, 0);
  const minBlock = r.u16();
  r.u16(); // max block
  r.u24(); // min frame
  r.u24(); // max frame
  const a = r.u8();
  const b = r.u8();
  const c = r.u8();
  const d = r.u8();
  const e = r.u8();
  const f = r.u8();
  const sampleRate = (a << 12) | (b << 4) | (c >> 4);
  const channels = ((c & 0x0e) >> 1) + 1;
  const bitDepth = (((c & 0x01) << 4) | (d >> 4)) + 1;
  const totalSamples = (d & 0x0f) * 2 ** 32 + e * 2 ** 24 + f * 2 ** 16 + (data[16] << 8) + data[17];
  const md5 = Array.from(data.subarray(20, 34))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { minBlock, sampleRate, channels, bitDepth, totalSamples, md5 };
}

function readStreaminfo(data: Uint8Array | null, fallbackFileBytes: number): AudioProperties {
  if (!data || data.length < 34) {
    return { codec: "FLAC", container: "FLAC", lossless: true };
  }
  const si = parseStreaminfo(data);
  const duration = si.sampleRate > 0 ? si.totalSamples / si.sampleRate : undefined;
  return {
    codec: "FLAC",
    container: "FLAC",
    lossless: true,
    sampleRate: si.sampleRate,
    channels: si.channels,
    bitDepth: si.bitDepth,
    duration,
    audioBytes: Math.max(0, fallbackFileBytes),
    bitrateMode: "CBR",
  };
}

function describeStreaminfo(data: Uint8Array): string {
  try {
    const si = parseStreaminfo(data);
    return `${si.sampleRate} Hz, ${si.channels} ch, ${si.bitDepth}-bit, ${si.totalSamples} samples`;
  } catch {
    return `${data.length} bytes`;
  }
}

/** Serialise the full FLAC file (metadata chain + untouched audio frames). */
export function writeFlac(
  original: Uint8Array,
  metadata: MusicMetadata,
  layout: ReadResult["layout"],
  preservedComments: CommentList,
  preservedBlocks: Uint8Array[],
  fileBytes: number,
  vendor: string,
): WriteResult {
  const warnings: string[] = [];
  const comments = composeComments(metadata, preservedComments, { pictureAsBase64: false });
  const commentBlock = buildVorbisComment(vendor, comments);
  const blocks: Uint8Array[] = [];

  // STREAMINFO first, verbatim.
  const head = original.subarray(0, layout.headEnd);
  const streaminfo = firstBlockData(head);
  if (streaminfo) blocks.push(encodeBlock(BLOCK_STREAMINFO, streaminfo));

  for (const b of preservedBlocks) blocks.push(b);

  blocks.push(encodeBlock(BLOCK_VORBIS_COMMENT, commentBlock));

  const art = metadata.artwork ?? [];
  const pictures = art.slice(0, 1); // reference libFLAC writes one PICTURE block
  for (const pic of pictures) blocks.push(encodeBlock(BLOCK_PICTURE, encodePictureBlock(pic)));
  if (art.length > 1) {
    warnings.push(
      `FLAC stores front cover in a PICTURE block; ${art.length - 1} additional image(s) were not written`,
    );
  }

  // Keep roughly the original padding so players that rewrite tags still fit.
  const paddingLen = Math.max(0, Math.min(8192, layout.headEnd - totalLen(blocks)));
  if (paddingLen > 0) blocks.push(encodeBlock(BLOCK_PADDING, new Uint8Array(paddingLen)));

  const out = new ByteWriter(totalLen(blocks) + 16);
  out.bytes(FLAC_MAGIC);
  for (let i = 0; i < blocks.length; i++) {
    const isLast = i === blocks.length - 1;
    out.u8(blocks[i][0] | (isLast ? 0x80 : 0));
    out.bytes(blocks[i].subarray(1));
  }

  const audio = original.subarray(layout.headEnd);
  void fileBytes;
  return { bytes: concatBytes(out.toBytes(), audio), bytesWritten: out.length, warnings };
}

/** Payload of the first metadata block (STREAMINFO), header stripped. */
function firstBlockData(head: Uint8Array): Uint8Array | null {
  if (head.length < 8) return null;
  const len = (head[5] << 16) | (head[6] << 8) | head[7];
  const end = 8 + len;
  if (end > head.length) return null;
  return head.slice(8, end);
}

function encodeBlock(type: number, data: Uint8Array): Uint8Array {
  const w = new ByteWriter(data.length + 4);
  w.u8(type & 0x7f).u24(data.length).bytes(data);
  return w.toBytes();
}

function totalLen(blocks: Uint8Array[]): number {
  return blocks.reduce((n, b) => n + b.length, 0) + 16;
}