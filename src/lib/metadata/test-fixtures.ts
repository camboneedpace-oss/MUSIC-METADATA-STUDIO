/**
 * Hand-built binary fixtures.
 *
 * These are assembled byte-by-byte rather than with our own writers, so the
 * tests exercise the readers against the real on-disk layouts instead of
 * round-tripping our own assumptions.
 */

import { concatBytes } from "./binary";

export function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

export function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo. */
export const MP3_FRAME_HEADER = [0xff, 0xfb, 0x90, 0x00];
export const MP3_FRAME_LEN = 417;

export function makeAudioFrames(count = 4): Uint8Array {
  const parts: number[] = [];
  for (let i = 0; i < count; i++) {
    parts.push(...MP3_FRAME_HEADER);
    for (let j = 4; j < MP3_FRAME_LEN; j++) parts.push(j & 0x7f);
  }
  return Uint8Array.from(parts);
}

export function makeMp3(
  id3v2?: Uint8Array,
  id3v1?: Uint8Array,
  frames = 4,
): Uint8Array {
  return concatBytes(id3v2 ?? new Uint8Array(0), makeAudioFrames(frames), id3v1 ?? new Uint8Array(0));
}

/* ---------------- FLAC ---------------- */

export function makeFlacStreaminfo(sampleRate = 44100, channels = 2, bitDepth = 16, samples = 44100 * 180): Uint8Array {
  const b = new Uint8Array(34);
  b.set([0x10, 0x00, 0x10, 0x00], 0); // min/max block size
  b.set([0x00, 0x21, 0x00, 0x00, 0x00, 0x00], 4); // min/max frame size
  const sr = sampleRate;
  const ch = channels - 1;
  const bps = bitDepth - 1;
  b[10] = (sr >> 12) & 0xff;
  b[11] = (sr >> 4) & 0xff;
  b[12] = ((sr & 0x0f) << 4) | ((ch & 0x07) << 1) | ((bps >> 4) & 0x01);
  b[13] = ((bps & 0x0f) << 4) | ((samples / 2 ** 32) & 0x0f);
  const hi = Math.floor(samples / 2 ** 32);
  b[13] = ((bps & 0x0f) << 4) | (hi & 0x0f);
  b[14] = (samples >>> 24) & 0xff;
  b[15] = (samples >>> 16) & 0xff;
  b[16] = (samples >>> 8) & 0xff;
  b[17] = samples & 0xff;
  return b;
}

export function flacBlock(type: number, data: Uint8Array, last = false): Uint8Array {
  const w = new Uint8Array(4 + data.length);
  w[0] = type | (last ? 0x80 : 0);
  w[1] = (data.length >> 16) & 0xff;
  w[2] = (data.length >> 8) & 0xff;
  w[3] = data.length & 0xff;
  w.set(data, 4);
  return w;
}

export function makeFlac(blocks: Uint8Array[], audioBytes = 64): Uint8Array {
  return concatBytes(new Uint8Array([0x66, 0x4c, 0x61, 0x43]), ...blocks, new Uint8Array(audioBytes).fill(0xa5));
}

/* ---------------- Vorbis comment block ---------------- */

export function vorbisCommentBlock(vendor: string, comments: Array<[string, string]>, type = 4): Uint8Array {
  const enc = new TextEncoder();
  const entries = comments.map(([k, v]) => enc.encode(`${k}=${v}`));
  const size =
    4 + enc.encode(vendor).length + 4 + entries.reduce((n, e) => n + 4 + e.length, 0);
  const body = new Uint8Array(size);
  const dv = new DataView(body.buffer);
  let at = 0;
  const vend = enc.encode(vendor);
  dv.setUint32(at, vend.length, true);
  at += 4;
  body.set(vend, at);
  at += vend.length;
  dv.setUint32(at, comments.length, true);
  at += 4;
  for (const e of entries) {
    dv.setUint32(at, e.length, true);
    at += 4;
    body.set(e, at);
    at += e.length;
  }
  return flacBlock(type, body);
}

export function pictureBlock(
  mime: string,
  data: Uint8Array,
  pictureType = 3,
  description = "",
): Uint8Array {
  const mimeBytes = new TextEncoder().encode(mime);
  const descBytes = new TextEncoder().encode(description);
  const body = new Uint8Array(4 + 4 + mimeBytes.length + 4 + 4 + descBytes.length + 16 + 4 + data.length);
  const dv = new DataView(body.buffer);
  let at = 0;
  dv.setUint32(at, pictureType, false);
  at += 4;
  dv.setUint32(at, mimeBytes.length, false);
  at += 4;
  body.set(mimeBytes, at);
  at += mimeBytes.length;
  dv.setUint32(at, descBytes.length, false);
  at += 4;
  body.set(descBytes, at);
  at += descBytes.length;
  at += 16; // width, height, depth, colours
  dv.setUint32(at, data.length, false);
  at += 4;
  body.set(data, at);
  return flacBlock(6, body);
}

/* ---------------- Ogg ---------------- */

export const OGG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

export function oggCrc(data: Uint8Array): number {
  let crc = 0;
  for (const b of data) {
    crc = ((crc << 8) & 0xffffffff) ^ OGG_CRC_TABLE[((crc >>> 24) & 0xff) ^ b];
  }
  return crc >>> 0;
}

export interface OggPageSpec {
  headerType?: number;
  granule?: number;
  serial?: number;
  seq?: number;
  packets: Uint8Array[];
}

export function makeOggPage(spec: OggPageSpec): Uint8Array {
  const lacing: number[] = [];
  const payload: number[] = [];
  for (const packet of spec.packets) {
    let p = packet;
    let remaining = p.length;
    while (remaining >= 255) {
      lacing.push(255);
      payload.push(...p.subarray(0, 255));
      remaining -= 255;
      p = p.subarray(255);
    }
    lacing.push(remaining);
    payload.push(...p.subarray(0, remaining));
  }

  const head = new Uint8Array(27 + lacing.length);
  const dv = new DataView(head.buffer);
  head.set(new TextEncoder().encode("OggS"), 0);
  head[4] = 0;
  head[5] = spec.headerType ?? 0;
  dv.setBigInt64(6, BigInt(spec.granule ?? 0), true);
  dv.setUint32(14, spec.serial ?? 1, true);
  dv.setUint32(18, spec.seq ?? 0, true);
  dv.setUint32(22, 0, true);
  head[26] = lacing.length;
  head.set(Uint8Array.from(lacing), 27);

  const page = concatBytes(head, Uint8Array.from(payload));
  const crc = oggCrc(page);
  new DataView(page.buffer).setUint32(22, crc, true);
  return page;
}

export function makeVorbisOgg(comments: Array<[string, string]>, vendor = "Xiph.Org libVorbis"): Uint8Array {
  // Identification packet: 0x01 "vorbis" + version + channels + rate + limits
  const ident = new Uint8Array(30);
  ident.set([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73], 0);
  const dv = new DataView(ident.buffer);
  dv.setUint32(7, 0, true); // vorbis version
  ident[11] = 2; // channels
  dv.setUint32(12, 44100, true); // sample rate
  dv.setUint32(16, 0, true); // bitrate max
  dv.setUint32(20, 128000, true); // bitrate nominal
  dv.setUint32(24, 0, true); // bitrate min
  ident[28] = 0xb8; // blocksizes
  ident[29] = 1; // framing

  const raw = vorbisCommentBlock(vendor, comments, 0);
  // Strip the FLAC block header: Ogg Vorbis stores the raw comment struct.
  const comment = raw.subarray(4);
  const withHeader = concatBytes(new Uint8Array([0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]), comment, new Uint8Array([1]));

  const setup = concatBytes(new Uint8Array([0x05, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]), new Uint8Array(64));

  const audio = new Uint8Array(128).fill(0x42);
  return concatBytes(
    makeOggPage({ headerType: 0x02, granule: 0, seq: 0, packets: [ident, withHeader, setup] }),
    makeOggPage({ headerType: 0x04, granule: 44100 * 120, seq: 1, packets: [audio] }),
  );
}

export function makeOpusOgg(comments: Array<[string, string]>, vendor = "libopus"): Uint8Array {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode("OpusHead"), 0);
  head[8] = 1; // version
  head[9] = 2; // channels
  const dv = new DataView(head.buffer);
  dv.setUint16(10, 312, true); // pre-skip
  dv.setUint32(12, 48000, true); // input sample rate
  dv.setUint16(16, 0, true); // gain
  head[18] = 0; // mapping family

  const raw = vorbisCommentBlock(vendor, comments, 0);
  const tags = concatBytes(new TextEncoder().encode("OpusTags"), raw.subarray(4));

  const audio = new Uint8Array(96).fill(0x33);
  return concatBytes(
    makeOggPage({ headerType: 0x02, granule: 0, seq: 0, packets: [head, tags] }),
    makeOggPage({ headerType: 0x04, granule: 48000 * 90, seq: 1, packets: [audio] }),
  );
}

/* ---------------- MP4 ---------------- */

/** MP4 atom names are raw bytes, not UTF-8: `©nam` is 0xA9 + "nam". */
function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function box(type: string, payload: Uint8Array): Uint8Array {
  return concatBytes(u32be(payload.length + 8), latin1(type), payload);
}

function fullBox(type: string, version: number, flags: number, payload: Uint8Array): Uint8Array {
  const head = new Uint8Array(4);
  head[0] = version;
  head[1] = (flags >> 16) & 0xff;
  head[2] = (flags >> 8) & 0xff;
  head[3] = flags & 0xff;
  return box(type, concatBytes(head, payload));
}

function mp4Data(value: string, dataType = 1): Uint8Array {
  return box("data", concatBytes(u32be(dataType), u32be(0), new TextEncoder().encode(value)));
}

function mp4DataPair(a: number, b: number): Uint8Array {
  const p = new Uint8Array(8);
  const dv = new DataView(p.buffer);
  dv.setUint16(2, a);
  dv.setUint16(4, b);
  return box("data", concatBytes(u32be(0), u32be(0), p));
}

export interface Mp4AtomSpec {
  [atom: string]: string | number | Uint8Array;
}

export function makeMp4(ilst: Mp4AtomSpec, opts: { brand?: string; mdatBytes?: number } = {}): Uint8Array {
  const brand = opts.brand ?? "M4A ";

  const mvhd = fullBox("mvhd", 0, 0, concatBytes(
    u32be(0), u32be(0), u32be(1000), u32be(180000), u32be(0x00010000), u32be(0x0100),
    u32be(0), new Uint8Array(80),
  ));

  // Minimal mp4a sample entry with an esds carrying the sample rate index.
  const sampleEntry = box("mp4a", concatBytes(
    new Uint8Array(6), u16be(1), // 6 reserved bytes + data_reference_index (u16)
    new Uint8Array(8), // reserved (version/revision/vendor)
    u16be(2), // channels (AudioSampleEntry is big-endian)
    u16be(16), // sample size
    u16be(0), u16be(0), // pre_defined, reserved
    u32be(44100 << 16), // 16.16 sample rate
    esds(),
  ));
  const stsd = fullBox("stsd", 0, 0, concatBytes(u32be(1), sampleEntry));
  const stbl = box("stbl", concatBytes(
    stsd,
    fullBox("stts", 0, 0, concatBytes(u32be(0))),
    fullBox("stsc", 0, 0, concatBytes(u32be(0))),
    fullBox("stsz", 0, 0, concatBytes(u32be(0), u32be(0))),
    fullBox("stco", 0, 0, concatBytes(u32be(0))),
  ));
  const minf = box("minf", concatBytes(
    fullBox("smhd", 0, 0, new Uint8Array(4)),
    box("dinf", fullBox("dref", 0, 0, concatBytes(u32be(0)))),
    stbl,
  ));
  const mdia = box("mdia", concatBytes(
    fullBox("mdhd", 0, 0, concatBytes(u32be(0), u32be(0), u32be(1000), u32be(180000), u16be(0x55c4), u16be(0))),
    fullBox("hdlr", 0, 0, concatBytes(u32be(0), latin1("soun"), u32be(0), u32be(0), u32be(0), new Uint8Array([0]))),
    minf,
  ));
  const trak = box("trak", concatBytes(
    fullBox("tkhd", 0, 7, concatBytes(
      u32be(0), u32be(0), u32be(1), u32be(0), u32be(180000), new Uint8Array(8),
      u16be(0), u16be(0), u16be(0x0100), u16be(0), new Uint8Array(36), u32be(0), u32be(0),
    )),
    mdia,
  ));

  const ilstParts: Uint8Array[] = [];
  for (const [atom, value] of Object.entries(ilst)) {
    // `trknTotal` / `diskTotal` are consumed by the pair builder, not emitted
    // as atoms of their own.
    if (atom === "trknTotal" || atom === "diskTotal") continue;
    const key = atom;
    if (typeof value === "number") {
      if (key === "trkn" || key === "disk") {
        ilstParts.push(box(key, mp4DataPair(value, (ilst as Record<string, number>)[`${key}Total`] ?? 0)));
      } else {
        ilstParts.push(box(key, mp4Data(String(value))));
      }
    } else if (typeof value === "string") {
      ilstParts.push(box(key, mp4Data(value)));
    } else {
      ilstParts.push(box(key, value));
    }
  }
  const ilstBox = box("ilst", concatBytes(...ilstParts));
  const hdlr = fullBox("hdlr", 0, 0, concatBytes(u32be(0), latin1("mdir"), latin1("appl"), u32be(0), u32be(0), u32be(0), new Uint8Array([0])));
  const meta = box("meta", concatBytes(new Uint8Array(4), hdlr, ilstBox));
  const udta = box("udta", meta);
  const moov = box("moov", concatBytes(mvhd, trak, udta));

  const mdatPayload = new Uint8Array(opts.mdatBytes ?? 256).fill(0x77);
  const ftyp = box("ftyp", concatBytes(latin1(brand), u32be(0), latin1("M4A mp42isom")));

  return concatBytes(ftyp, moov, box("mdat", mdatPayload));
}

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}

function esds(): Uint8Array {
  // Minimal but structurally valid ES descriptor with DecoderConfigDescriptor.
  const dsi = new Uint8Array([0x12, 0x10]); // AAC LC, 44.1 kHz, stereo
  const dcd = concatBytes(
    new Uint8Array([0x04, 13 + dsi.length]),
    new Uint8Array([0x40, 0x15]), // object type = MPEG-4 audio
    new Uint8Array([0x00, 0x00, 0x00]), // buffer size
    u32be(128000), // max bitrate
    u32be(128000), // avg bitrate
    dsi,
  );
  const sl = new Uint8Array([0x06, 0x01, 0x02]);
  const es = concatBytes(new Uint8Array([0x03, 3 + dcd.length + sl.length]), new Uint8Array([0x00, 0x00, 0x00]), dcd, sl);
  return fullBox("esds", 0, 0, es);
}

/* ---------------- WAV ---------------- */

export function makeWav(info: Array<[string, string]>, audioBytes = 2048): Uint8Array {
  const listBody = [ ...new TextEncoder().encode("INFO") ];
  for (const [k, v] of info) {
    const bytes = new TextEncoder().encode(v);
    listBody.push(...new TextEncoder().encode(k), ...u32le(bytes.length), ...bytes);
    if (bytes.length % 2 === 1) listBody.push(0);
  }
  const list = concatBytes(new TextEncoder().encode("LIST"), u32le(listBody.length), Uint8Array.from(listBody));
  const fmt = concatBytes(
    new TextEncoder().encode("fmt "), u32le(16),
    u16le(1), u16le(2), u32le(44100), u32le(176400), u16le(4), u16le(16),
  );
  const data = concatBytes(
    new TextEncoder().encode("data"), u32le(audioBytes),
    new Uint8Array(audioBytes),
  );
  const body = concatBytes(new TextEncoder().encode("WAVE"), fmt, list, data);
  return concatBytes(new TextEncoder().encode("RIFF"), u32le(body.length), body);
}

/* ---------------- APE ---------------- */

export function makeApeTag(entries: Array<[string, Uint8Array]>): Uint8Array {
  const body: number[] = [];
  for (const [k, v] of entries) {
    body.push(...u32le(v.length), ...u32le(0));
    body.push(...new TextEncoder().encode(k), 0);
    body.push(...v);
  }
  const tagSize = body.length + 64;
  const mk = (isHeader: boolean) => [
    ...new TextEncoder().encode("APETAGEX"),
    ...u32le(1999),
    ...u32le(tagSize),
    ...u32le(entries.length),
    ...u32le(isHeader ? 0x80000000 : 0x80000000),
    0, 0, 0, 0, 0, 0, 0, 0,
  ];
  return concatBytes(Uint8Array.from(mk(true)), Uint8Array.from(body), Uint8Array.from(mk(false)));
}

/** A tiny but structurally valid PNG (1x1). */
export const TINY_PNG = (() => {
  const bytes = Uint8Array.from(atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ), (c) => c.charCodeAt(0));
  return bytes;
})();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A 4x3 PNG with a solid colour, for dimension assertions. */
export const RECT_PNG = (() => {
  const w = 4;
  const h = 3;
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = 0x40;
      raw[o + 1] = 0x80;
      raw[o + 2] = 0xc0;
    }
  }
  const idat = zlibStore(raw);
  const chunk = (type: string, data: Uint8Array) => {
    const t = new TextEncoder().encode(type);
    const out = new Uint8Array(12 + data.length);
    const d = new DataView(out.buffer);
    d.setUint32(0, data.length);
    out.set(t, 4);
    out.set(data, 8);
    d.setUint32(8 + data.length, crc32(concatBytes(t, data)));
    return out;
  };
  const ihdrOut = chunk("IHDR", ihdr);
  return concatBytes(
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdrOut,
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  );
})();

/** Store-only zlib stream: enough to make a decodable PNG without a deflate lib. */
function zlibStore(data: Uint8Array): Uint8Array {
  const blocks: number[] = [0x78, 0x01];
  const MAX = 0xffff;
  for (let i = 0; i < data.length || i === 0; i += MAX) {
    const chunk = data.subarray(i, i + MAX);
    const last = i + MAX >= data.length ? 1 : 0;
    blocks.push(last, chunk.length & 0xff, (chunk.length >> 8) & 0xff);
    blocks.push(~chunk.length & 0xff, ((~chunk.length >> 8) & 0xff) & 0xff);
    blocks.push(...chunk);
  }
  const s1 = 1;
  const s2 = 0;
  let a = s1;
  let b = s2;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  blocks.push((b << 8) & 0xffff, b & 0xff, (a << 8) & 0xffff, a & 0xff);
  return Uint8Array.from(blocks);
}