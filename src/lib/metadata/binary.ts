/**
 * Byte-level helpers shared by every codec.
 *
 * All codecs work on a contiguous `Uint8Array` window of the file: head
 * (tags live here) plus a tail window for APEv2/ID3v1 trailers.
 */

/** Growable big-endian byte writer. */
export class ByteWriter {
  private buf: Uint8Array;
  private len = 0;

  constructor(initial = 1024) {
    this.buf = new Uint8Array(initial);
  }

  private ensure(n: number) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2 || 1024;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  bytes(src: Uint8Array | number[]): this {
    this.ensure(src.length);
    this.buf.set(src instanceof Uint8Array ? src : Uint8Array.from(src), this.len);
    this.len += src.length;
    return this;
  }

  u8(v: number): this {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
    return this;
  }

  u16(v: number): this {
    this.ensure(2);
    this.buf[this.len++] = (v >>> 8) & 0xff;
    this.buf[this.len++] = v & 0xff;
    return this;
  }

  u24(v: number): this {
    return this.u8(v >>> 16).u8(v >>> 8).u8(v);
  }

  u32(v: number): this {
    this.ensure(4);
    this.buf[this.len++] = (v >>> 24) & 0xff;
    this.buf[this.len++] = (v >>> 16) & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
    this.buf[this.len++] = v & 0xff;
    return this;
  }

  u32le(v: number): this {
    this.ensure(4);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
    this.buf[this.len++] = (v >>> 16) & 0xff;
    this.buf[this.len++] = (v >>> 24) & 0xff;
    return this;
  }

  /** 64-bit little-endian (APE tag footers). */
  u64le(v: number): this {
    const hi = Math.floor(v / 2 ** 32);
    const lo = v >>> 0;
    return this.u32le(lo).u32le(hi);
  }

  /** 64-bit big-endian from a safe integer (synchsafe sizes stay < 2^32). */
  u64(v: number): this {
    const hi = Math.floor(v / 2 ** 32);
    const lo = v >>> 0;
    return this.u32(hi).u32(lo);
  }

  ascii(s: string): this {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return this.bytes(out);
  }

  utf8(s: string): this {
    return this.bytes(new TextEncoder().encode(s));
  }

  latin1(s: string): this {
    return this.bytes(new Uint8Array(s.length));
  }

  zeros(n: number): this {
    this.ensure(n);
    this.len += n;
    return this;
  }

  patchU32(at: number, v: number) {
    this.buf[at] = (v >>> 24) & 0xff;
    this.buf[at + 1] = (v >>> 16) & 0xff;
    this.buf[at + 2] = (v >>> 8) & 0xff;
    this.buf[at + 3] = v & 0xff;
  }

  /** Synchsafe integer (ID3v2 size encoding). */
  patchSynchsafe(at: number, v: number) {
    this.buf[at] = (v >>> 21) & 0x7f;
    this.buf[at + 1] = (v >>> 14) & 0x7f;
    this.buf[at + 2] = (v >>> 7) & 0x7f;
    this.buf[at + 3] = v & 0x7f;
  }

  /**
   * Write a synchsafe integer (ID3v2.3/2.4 tag and frame sizes): seven bits
   * per byte, so the high bit of every byte is always clear.
   *
   * Prefer this over `u32` + `patchSynchsafe`: `toBytes()` returns a copy, so
   * patching after the fact silently edits a buffer that never ships.
   */
  synchsafe(v: number): this {
    return this.u8(v >>> 21).u8(v >>> 14).u8(v >>> 7).u8(v);
  }

  toBytes(): Uint8Array {
    return this.buf.slice(0, this.len);
  }

  get length() {
    return this.len;
  }
}

/** Big-endian cursor over a byte window. Never throws on overrun. */
export class ByteReader {
  data: Uint8Array;
  pos: number;

  constructor(data: Uint8Array, pos = 0) {
    this.data = data;
    this.pos = pos;
  }

  get remaining() {
    return this.data.length - this.pos;
  }

  get eof() {
    return this.pos >= this.data.length;
  }

  private need(n: number): boolean {
    if (this.pos + n > this.data.length) return false;
    return true;
  }

  u8(): number {
    return this.need(1) ? this.data[this.pos++] : 0;
  }

  u16(): number {
    if (!this.need(2)) {
      this.pos = this.data.length;
      return 0;
    }
    const v = (this.data[this.pos] << 8) | this.data[this.pos + 1];
    this.pos += 2;
    return v;
  }

  u24(): number {
    const v = (this.u8() << 16) | (this.u8() << 8) | this.u8();
    return v;
  }

  u32(): number {
    if (!this.need(4)) {
      this.pos = this.data.length;
      return 0;
    }
    const v =
      this.data[this.pos] * 0x1000000 +
      ((this.data[this.pos + 1] << 16) |
        (this.data[this.pos + 2] << 8) |
        this.data[this.pos + 3]);
    this.pos += 4;
    return v;
  }

  /** ID3 synchsafe integer. */
  synchsafe(): number {
    const b = [this.u8(), this.u8(), this.u8(), this.u8()];
    return (b[0] & 0x7f) * 0x200000 + (b[1] & 0x7f) * 0x4000 + (b[2] & 0x7f) * 0x80 + (b[3] & 0x7f);
  }

  /** Little-endian 16-bit (RIFF chunk headers). */
  u16le(): number {
    if (!this.need(2)) {
      this.pos = this.data.length;
      return 0;
    }
    const v = this.data[this.pos] | (this.data[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }

  /** Little-endian 32-bit. Vorbis, MP4, APE and RIFF all use LE lengths. */
  u32le(): number {
    if (!this.need(4)) {
      this.pos = this.data.length;
      return 0;
    }
    const v =
      this.data[this.pos] +
      this.data[this.pos + 1] * 0x100 +
      this.data[this.pos + 2] * 0x10000 +
      this.data[this.pos + 3] * 0x1000000;
    this.pos += 4;
    return v;
  }

  u64le(): number {
    if (!this.need(8)) {
      this.pos = this.data.length;
      return 0;
    }
    const v = new DataView(this.data.buffer, this.data.byteOffset + this.pos, 8).getBigUint64(0, true);
    this.pos += 8;
    return Number(v);
  }

  u64(): number {
    const hi = this.u32();
    const lo = this.u32();
    return hi * 2 ** 32 + lo;
  }

  ascii(n: number): string {
    if (!this.need(n)) {
      this.pos = this.data.length;
      return "";
    }
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.data[this.pos + i]);
    this.pos += n;
    return s;
  }

  slice(n: number): Uint8Array {
    const n2 = Math.max(0, Math.min(n, this.remaining));
    const s = this.data.subarray(this.pos, this.pos + n2);
    this.pos += n2;
    return s;
  }

  /** Read `n` bytes and decode as UTF-8, dropping a trailing NUL terminator. */
  utf8(n: number): string {
    return trimNul(decodeUtf8(this.slice(n)));
  }

  /** Skip a UTF-16 string with the given byte length. */
  skipUtf16(bytes: number) {
    this.pos += bytes;
    if (this.pos > this.data.length) this.pos = this.data.length;
  }

  utf16(bytes: number): string {
    if (!this.need(bytes)) {
      this.pos = this.data.length;
      return "";
    }
    let s = "";
    for (let i = 0; i + 1 < bytes; i += 2) {
      s += String.fromCharCode((this.data[this.pos + i] << 8) | this.data[this.pos + i + 1]);
    }
    this.pos += bytes;
    return trimNul(s);
  }
}

export function decodeUtf8(b: Uint8Array): string {
  return new TextDecoder("utf-8").decode(b);
}

/** latin1/binary read: 0x80-0xFF map to U+0080-U+00FF. */
export function decodeLatin1(b: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) {
    s += String.fromCharCode(...b.subarray(i, i + chunk));
  }
  return s;
}

export function encodeLatin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function trimNul(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 0) end--;
  return s.slice(0, end);
}

export function concatBytes(...parts: Array<Uint8Array | number[]>): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p instanceof Uint8Array ? p : Uint8Array.from(p), at);
    at += p.length;
  }
  return out;
}

/** Opaque value kept so unknown frames survive a rewrite byte-for-byte. */
export function hexPreview(b: Uint8Array, max = 24): string {
  const head = b.subarray(0, max);
  let s = "";
  for (const byte of head) s += byte.toString(16).padStart(2, "0");
  return b.length > max ? `${s}… (${b.length} bytes)` : `${s} (${b.length} bytes)`;
}

export function toBase64(b: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) {
    s += String.fromCharCode(...b.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Minimal image sniffing + dimension probe. We only need enough to size
 * artwork for the UI and pick a container-legal mime type.
 */
export function probeImage(b: Uint8Array): { mime: string; width: number; height: number } {
  // PNG
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { mime: "image/png", width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // GIF
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { mime: "image/gif", width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  }
  // WebP (VP8X / VP8L / VP8)
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) {
    const chunk = String.fromCharCode(...b.subarray(12, 16));
    if (chunk === "VP8X") {
      return {
        mime: "image/webp",
        width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
        height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
      };
    }
    if (chunk === "VP8 ") {
      return {
        mime: "image/webp",
        width: (b[26] | (b[27] << 8)) & 0x3fff,
        height: (b[28] | (b[29] << 8)) & 0x3fff,
      };
    }
    return { mime: "image/webp", width: 0, height: 0 };
  }
  // JPEG — walk the segment list for a SOFn marker.
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return {
          mime: "image/jpeg",
          height: (b[i + 5] << 8) | b[i + 6],
          width: (b[i + 7] << 8) | b[i + 8],
        };
      }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2) break;
      i += 2 + len;
    }
    return { mime: "image/jpeg", width: 0, height: 0 };
  }
  // BMP (WAV artwork chunks occasionally carry these)
  if (b.length > 26 && b[0] === 0x42 && b[1] === 0x4d) {
    return {
      mime: "image/bmp",
      width: b[18] | (b[19] << 8) | (b[20] << 16) | (b[21] << 24),
      height: b[22] | (b[23] << 8) | (b[24] << 16) | (b[25] << 24),
    };
  }
  return { mime: "application/octet-stream", width: 0, height: 0 };
}