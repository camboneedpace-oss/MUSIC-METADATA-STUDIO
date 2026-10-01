/**
 * Audio stream property probing.
 *
 * Where a container does not describe its own bitrate/sample rate, we walk
 * the first frames ourselves: MPEG audio for MP3, the APE/WavPack/Musepack
 * block headers for their respective formats, and the DSF chunk table for
 * DSD. This is what makes the technical columns real rather than guesses.
 */

import { ByteReader } from "./binary";
import type { AudioProperties } from "./types";

const MPEG_BITRATES_V1_L3 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1,
];
const MPEG_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1];
const MPEG_BITRATES_V1_L2 = [
  0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, -1,
];
const MPEG_BITRATES_V1_L1 = [
  0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, -1,
];
const MPEG_BITRATES_V2_L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, -1];
const MPEG_RATES = [
  [11025, 12000, 8000], // MPEG 2.5
  [0, 0, 0], // reserved
  [22050, 24000, 16000], // MPEG 2
  [44100, 48000, 32000], // MPEG 1
];

export interface MpegFrame {
  offset: number;
  version: 1 | 2 | 2.5;
  layer: 1 | 2 | 3;
  bitrate: number;
  sampleRate: number;
  channels: number;
  samplesPerFrame: number;
  frameLength: number;
  sideInfo: number;
}

export function findMpegFrame(buf: Uint8Array, from = 0): MpegFrame | null {
  for (let i = from; i + 4 <= buf.length - 1; i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const b1 = buf[i + 1];
    const b2 = buf[i + 2];
    const versionBits = (b1 >> 3) & 0x03;
    const layerBits = (b1 >> 1) & 0x03;
    const bitrateIndex = (b2 >> 4) & 0x0f;
    const rateIndex = (b2 >> 2) & 0x03;
    if (versionBits === 1 || layerBits === 0) continue;
    if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) continue;

    const version: 1 | 2 | 2.5 = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
    const layer = (4 - layerBits) as 1 | 2 | 3;
    const table =
      version === 1
        ? layer === 1 ? MPEG_BITRATES_V1_L1 : layer === 2 ? MPEG_BITRATES_V1_L2 : MPEG_BITRATES_V1_L3
        : layer === 1 ? MPEG_BITRATES_V2_L1 : MPEG_BITRATES_V2_L3;
    const bitrate = table[bitrateIndex] * 1000;
    const sampleRate = MPEG_RATES[versionBits][rateIndex];
    if (!bitrate || !sampleRate) continue;

    const channels = ((buf[i + 3] >> 6) & 0x03) === 3 ? 1 : 2;
    const samplesPerFrame = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152;
    const sideInfo = layer === 1 ? 17 : layer === 3 ? (version === 1 ? 32 : 17) : 32;
    const frameLength =
      layer === 1
        ? Math.floor((12 * bitrate) / sampleRate + 4) * 4
        : Math.floor((samplesPerFrame / 8) * (bitrate / sampleRate)) + (layer === 3 && version !== 1 ? 1 : 0);

    // Confirm with the next frame so we do not lock onto a false positive.
    const next = i + frameLength;
    if (next + 1 < buf.length && buf[next] === 0xff && (buf[next + 1] & 0xe0) === 0xe0) {
      return {
        offset: i, version, layer, bitrate, sampleRate, channels,
        samplesPerFrame, frameLength, sideInfo,
      };
    }
  }
  return null;
}

interface VbrHeader {
  frames?: number;
  bytes?: number;
  toc?: Uint8Array;
}

/** Xing/Info (VBR) and VBRI (Fraunhofer) headers give exact frame counts. */
export function readVbrHeader(buf: Uint8Array, frame: MpegFrame): VbrHeader | null {
  const tagAt = frame.offset + 4 + frame.sideInfo;
  const tag = String.fromCharCode(...buf.subarray(tagAt, tagAt + 4));
  if (tag === "Xing" || tag === "Info") {
    const r = new ByteReader(buf, tagAt + 4);
    const flags = r.u32();
    const out: VbrHeader = {};
    if (flags & 0x01) out.frames = r.u32();
    if (flags & 0x02) out.bytes = r.u32();
    if (flags & 0x04) out.toc = buf.slice(r.pos, r.pos + 100);
    return out;
  }
  const vbriAt = frame.offset + 4 + 32;
  if (String.fromCharCode(...buf.subarray(vbriAt, vbriAt + 4)) === "VBRI") {
    const r = new ByteReader(buf, vbriAt + 4);
    r.u16(); // version
    r.u16(); // delay
    r.u16(); // quality
    return { bytes: r.u32(), frames: r.u32() };
  }
  return null;
}

export function readMp3Audio(
  buf: Uint8Array,
  audioStart: number,
  audioEnd: number,
  totalBytes: number,
): AudioProperties {
  const frame = findMpegFrame(buf, audioStart);
  if (!frame) {
    return { codec: "MPEG Audio", container: "MP3", lossless: false };
  }
  const codecName =
    frame.layer === 3 ? (frame.version === 1 ? "MPEG-1 Layer 3" : "MPEG-2 Layer 3")
    : frame.layer === 2 ? `MPEG-1 Layer 2`
    : "MPEG-1 Layer 1";

  const audioBytes = Math.max(0, audioEnd - frame.offset);
  const vbr = readVbrHeader(buf, frame);
  const audio: AudioProperties = {
    codec: codecName,
    container: "MP3",
    lossless: false,
    sampleRate: frame.sampleRate,
    channels: frame.channels,
    audioBytes,
  };

  if (vbr?.frames && vbr.frames > 0) {
    const samples = vbr.frames * frame.samplesPerFrame;
    audio.duration = samples / frame.sampleRate;
    const streamBytes = vbr.bytes ?? audioBytes;
    if (streamBytes > 0 && audio.duration > 0) {
      audio.bitrate = Math.round((streamBytes * 8) / audio.duration);
      audio.bitrateMode = "VBR";
    }
  } else {
    // No VBR header: use the frame header, which is an upper bound only when
    // the encoder switched bitrates. Report CBR with a lower-bound bitrate.
    audio.bitrate = frame.bitrate;
    audio.bitrateMode = "CBR";
    if (audioBytes > 0 && frame.sampleRate > 0) {
      const estimate = (audioBytes * 8 * frame.sampleRate) / (frame.samplesPerFrame * frame.frameLength);
      if (estimate > 0) {
        audio.duration = (audioBytes * 8) / estimate;
      }
    }
  }
  void totalBytes;
  return audio;
}

/* ---------- other codecs' own headers ---------- */

export function readWavPackStream(head: Uint8Array): Partial<AudioProperties> {
  if (String.fromCharCode(...head.subarray(0, 4)) !== "wvpk") return {};
  const r = new ByteReader(head, 4);
  const blockSize = r.u32();
  r.u16(); // version
  r.u8(); // block index high
  r.u8(); // total samples high
  r.u32(); // total samples
  const flags = r.u32();
  r.u32(); // crc
  const lossless = (flags & 0x08) === 0;
  return {
    codec: "WavPack",
    container: "WavPack",
    lossless,
    audioBytes: blockSize,
  };
}

export function readMusepackStream(head: Uint8Array): Partial<AudioProperties> {
  if (String.fromCharCode(...head.subarray(0, 4)) === "MPCK") {
    return { codec: "Musepack SV8", container: "Musepack", lossless: false };
  }
  if (String.fromCharCode(...head.subarray(0, 3)) === "MP+") {
    return { codec: "Musepack SV7", container: "Musepack", lossless: false };
  }
  return {};
}

export function readOptimFrogStream(head: Uint8Array): Partial<AudioProperties> {
  const sig = String.fromCharCode(...head.subarray(0, 4));
  if (sig !== "OFR " && sig !== "OFRM") return {};
  return { codec: "OptimFROG", container: "OptimFROG", lossless: true };
}

export function readTakStream(head: Uint8Array): Partial<AudioProperties> {
  if (String.fromCharCode(...head.subarray(0, 4)) !== "tBaK") return {};
  const r = new ByteReader(head, 4);
  const blocksPerFrame = r.u16();
  const totalFrames = r.u16();
  r.u32(); // total blocks
  const sampleRate = r.u32();
  r.u16(); // flags
  r.u16(); // crc
  r.u8(); // frame type
  const channels = r.u8();
  const bitDepth = r.u8();
  void blocksPerFrame;
  void totalFrames;
  return {
    codec: "Tom's Audio Kompressor",
    container: "TAK",
    lossless: true,
    sampleRate,
    channels,
    bitDepth,
  };
}

export function readDsfStream(head: Uint8Array): Partial<AudioProperties> {
  if (String.fromCharCode(...head.subarray(0, 4)) !== "DSD ") return {};
  const r = new ByteReader(head, 4);
  const chunkSize = r.u64();
  const totalSize = r.u64();
  void totalSize;
  const metadataPointer = r.u64();
  void metadataPointer;

  const f = new ByteReader(head, Number(chunkSize));
  if (f.ascii(4) !== "fmt ") return { codec: "DSD", container: "DSF", lossless: true };
  const fmtSize = f.u64();
  const formatVersion = f.u32();
  const formatId = f.u32();
  const channelType = f.u32();
  const channelNum = f.u32();
  const samplingFrequency = f.u32();
  const bitsPerSample = f.u32();
  const sampleCount = f.u64();
  void fmtSize;
  void formatVersion;
  void formatId;
  void channelType;
  return {
    codec: "DSD",
    container: "DSF",
    lossless: true,
    sampleRate: samplingFrequency,
    channels: channelNum,
    bitDepth: bitsPerSample,
    duration: samplingFrequency > 0 ? sampleCount / samplingFrequency : undefined,
  };
}

export function readTtAStream(head: Uint8Array): Partial<AudioProperties> {
  if (String.fromCharCode(...head.subarray(0, 4)) !== "TTA1") return {};
  const r = new ByteReader(head, 4);
  const channels = r.u16();
  const bits = r.u16();
  const sampleRate = r.u32();
  const samples = r.u32();
  return {
    codec: "True Audio",
    container: "TTA",
    lossless: true,
    channels,
    bitDepth: bits,
    sampleRate,
    duration: sampleRate > 0 ? samples / sampleRate : undefined,
  };
}