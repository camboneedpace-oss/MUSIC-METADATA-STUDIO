/**
 * AIFF / AIFC reader (no writer).
 *
 * AIFF stores text as plain `NAME` / `AUTH` / `(c) ` / `ANNO` chunks, which
 * is far too thin to carry a real tag. Files tagged by real tools carry an
 * `ID3 ` chunk instead, which is what we read.
 */

import { ByteReader } from "../binary";
import type { AudioProperties, ReadResult } from "../types";
import { extractId3, parseId3v2 } from "./id3";

export function isAiff(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  const form = String.fromCharCode(...b.subarray(0, 4));
  const type = String.fromCharCode(...b.subarray(8, 12));
  return form === "FORM" && (type === "AIFF" || type === "AIFC");
}

/** IEEE 754 80-bit extended, as used by the AIFF COMM chunk. */
export function readExtendedFloat(b: Uint8Array): number {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const exponent = dv.getUint16(0);
  const mantissaHi = dv.getUint32(2);
  const mantissaLo = dv.getUint32(6);
  if (exponent === 0 && mantissaHi === 0 && mantissaLo === 0) return 0;
  const mantissa = mantissaHi * 2 ** 32 + mantissaLo;
  const sign = exponent & 0x8000 ? -1 : 1;
  return sign * mantissa * 2 ** (exponent - 16383 - 63);
}

export function readAiff(head: Uint8Array): ReadResult | null {
  if (!isAiff(head)) return null;
  const warnings: string[] = [];
  const metadata = {} as ReadResult["metadata"];
  const raw: ReadResult["raw"] = [];
  const custom: Record<string, string> = {};
  let audio: AudioProperties = { container: "AIFF" };
  let codec = "PCM";
  let compression = "";

  const r = new ByteReader(head, 12);
  while (r.remaining > 8) {
    const type = r.ascii(4);
    const size = r.u32();
    if (size > r.remaining) {
      warnings.push(`Chunk \`${type}\` claims ${size} bytes but only ${r.remaining} remain`);
      break;
    }
    const data = r.slice(size).slice();
    if (size % 2 === 1 && r.remaining > 0) r.u8();

    switch (type) {
      case "COMM": {
        const cr = new ByteReader(data, 0);
        const channels = cr.u16();
        const frames = cr.u32();
        const bits = cr.u16();
        const sampleRate = readExtendedFloat(data.subarray(8, 18));
        if (type === "COMM" && data.length > 18) {
          compression = String.fromCharCode(...data.subarray(18)).trim();
        }
        codec = compression ? compression : "PCM";
        audio = {
          container: "AIFF",
          codec,
          lossless: !compression || compression === "NONE" || compression === "sowt",
          channels,
          bitDepth: bits,
          sampleRate: Math.round(sampleRate),
          duration: sampleRate > 0 ? frames / sampleRate : undefined,
          audioBytes: frames * channels * (bits / 8),
          bitrateMode: "CBR",
        };
        break;
      }
      case "NAME":
        metadata.title = decodeText(data);
        break;
      case "AUTH":
        (metadata.artists ??= []).push(decodeText(data));
        break;
      case "ANNO":
        if (!metadata.comment) metadata.comment = decodeText(data);
        break;
      case "ID3 ":
      case "id3 ": {
        const parsed = parseId3v2(data);
        if (parsed) {
          const ex = extractId3(parsed.frames, warnings, "AIFF ID3 chunk");
          for (const [k, v] of Object.entries(ex.metadata)) {
            if (k === "customFields") continue;
            if ((metadata as Record<string, unknown>)[k] === undefined) {
              (metadata as Record<string, unknown>)[k] = v;
            }
          }
          Object.assign(custom, ex.metadata.customFields ?? {});
          raw.push(...ex.raw);
        }
        break;
      }
      default:
        break;
    }
    raw.push({ key: type, values: [`${data.length} bytes`], binaryBytes: data.length });
  }

  if (Object.keys(custom).length) metadata.customFields = custom;
  if (metadata.artists?.length) metadata.artist = metadata.artists[0];
  if (metadata.genres?.length) metadata.genre = metadata.genres[0];

  return {
    metadata,
    raw,
    audio,
    formatInfo: { tagScheme: "AIFF chunks + ID3", preservedUnknown: true },
    warnings: [...warnings, "AIFF has no standard tag writer; use Save As to write a tagged copy"],
    layout: { headStart: 0, headEnd: head.length, tailStart: 0, tailEnd: 0, variant: { container: "aiff" } },
  };
}

function decodeText(b: Uint8Array): string {
  return new TextDecoder("utf-8").decode(b).replace(/\u0000+$/, "").trim();
}