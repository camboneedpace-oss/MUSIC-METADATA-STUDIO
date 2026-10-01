/**
 * ASF / WMA reader (no writer).
 *
 * WMA keeps text in the Content Description Object (flat UTF-16 fields) and
 * the Extended Content Description Object (typed, named descriptors). Both
 * are read; both are shown in the raw tag view.
 */

import { ByteReader } from "../binary";
import type { AudioProperties, ReadResult } from "../types";

export function isAsf(b: Uint8Array): boolean {
  // ASF header GUID: 75 B2 26 30 668E 11CF A6D9 00AA0062CE6C
  if (b.length < 16) return false;
  return (
    b[0] === 0x75 && b[1] === 0xb2 && b[2] === 0x26 && b[3] === 0x30 &&
    b[4] === 0x66 && b[5] === 0x8e && b[6] === 0x11 && b[7] === 0xcf &&
    b[8] === 0xa6 && b[9] === 0xd9 && b[10] === 0x00 && b[11] === 0xaa
  );
}

function guid(b: Uint8Array, at: number): string {
  const hex = Array.from(b.subarray(at, at + 16))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("-");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 24)}-${hex.slice(24, 32)}`;
}

const CDO = "75b22633-668e-11cf-a6d9-00aa0062ce6c";
const ECDO = "d2d0a440-e307-11d2-97f0-00a0c95ea850";
const FPO = "8cabdca1-a947-11cf-8ee4-00c00c205365";
const SPO = "b7dc0791-a9b7-11cf-8ee6-00c00c205365";

export function readAsf(head: Uint8Array): ReadResult | null {
  if (!isAsf(head)) return null;
  const warnings: string[] = [];
  const metadata = {} as ReadResult["metadata"];
  const raw: ReadResult["raw"] = [];
  const custom: Record<string, string> = {};
  let audio: AudioProperties = { container: "ASF", codec: "WMA" };

  const r = new ByteReader(head, 16);
  const objectCount = r.u32();
  void objectCount;

  for (let i = 0; i < objectCount; i++) {
    if (r.remaining < 24) break;
    const objectGuid = guid(head, r.pos);
    const size = Number(r.u64());
    if (size < 24 || r.pos + size > head.length) {
      warnings.push("ASF object extends past the header we read; metadata may be incomplete");
      break;
    }
    const body = head.subarray(r.pos + 24, r.pos + size);

    if (objectGuid === CDO) {
      const cr = new ByteReader(body, 0);
      const lens = [cr.u16(), cr.u16(), cr.u16(), cr.u16(), cr.u16()];
      const values = lens.map((n) => cr.utf16(n * 2));
      const [title, author, copyright, description, rating] = values;
      if (title) metadata.title = title;
      if (author) metadata.artists = [author];
      if (copyright) metadata.copyright = copyright;
      if (description && !metadata.comment) metadata.comment = description;
      if (rating) custom.Rating = rating;
      raw.push({ key: "ContentDescription", values: values.filter(Boolean) });
    } else if (objectGuid === ECDO) {
      const er = new ByteReader(body, 0);
      const count = er.u16();
      for (let c = 0; c < count; c++) {
        const nameLen = er.u16();
        const name = er.utf16(nameLen * 2);
        const valueType = er.u16();
        const valueLen = er.u16();
        const value =
          valueType === 0 ? "" : er.utf16(valueLen * 2);
        if (valueType !== 0 && valueType !== 2) er.u8();
        applyExtended(name, value, metadata as Record<string, unknown>, custom);
        raw.push({ key: name, values: [value] });
      }
    } else if (objectGuid === FPO) {
      const fr = new ByteReader(body, 0);
      fr.u32();
      fr.u32(); // creation date
      fr.u64(); // data packets
      fr.u64(); // send duration (100ns)
      fr.u64(); // preroll (ms)
      const flags = fr.u32();
      const minPacket = fr.u32();
      const maxPacket = fr.u32();
      const maxBitrate = fr.u32();
      if (maxBitrate > 0) audio.bitrate = maxBitrate * 8;
      void flags;
      void minPacket;
      void maxPacket;
      raw.push({ key: "FileProperties", values: [`maxBitrate=${maxBitrate * 8}`] });
    } else if (objectGuid === SPO) {
      const sr = new ByteReader(body, 0);
      sr.u16(); // stream type
      const errorType = sr.u16();
      void errorType;
      sr.u64(); // time offset
      const typeLen = sr.u32();
      const type = sr.ascii(typeLen).replace(/\u0000+$/, "");
      const errorLen = sr.u32();
      void errorLen;
      const flags = sr.u32();
      // Units are bytes; WMA is always 16 kHz, 2 channels.
      const unitSize = sr.u32();
      void flags;
      audio = {
        ...audio,
        codec: type === "Windows Media Audio 9 Professional" ? "WMA Pro" : "WMA",
        container: "ASF",
        sampleRate: 16000,
        channels: 2,
        bitDepth: 16,
        lossless: false,
      };
      void unitSize;
      raw.push({ key: "StreamProperties", values: [type] });
    }
    r.pos += size;
  }

  if (Object.keys(custom).length) metadata.customFields = custom;
  if (metadata.artists?.length) metadata.artist = metadata.artists[0];
  if (metadata.genres?.length) metadata.genre = metadata.genres[0];

  return {
    metadata,
    raw,
    audio,
    formatInfo: { tagScheme: "ASF", preservedUnknown: true },
    warnings: [...warnings, "WMA has no writer in this build; export a copy to save changes"],
    layout: { headStart: 0, headEnd: head.length, tailStart: 0, tailEnd: 0, variant: { container: "asf" } },
  };
}

function applyExtended(
  name: string,
  value: string,
  metadata: Record<string, unknown>,
  custom: Record<string, string>,
) {
  void custom;
  switch (name) {
    case "WM/AlbumTitle":
      metadata.album = value;
      break;
    case "WM/AlbumArtist":
      metadata.albumArtists = [value];
      break;
    case "WM/Genre":
      metadata.genres = [value];
      break;
    case "WM/TrackNumber":
      metadata.trackNumber = Number.parseInt(value, 10) || undefined;
      break;
    case "WM/PartOfSet":
      metadata.discNumber = Number.parseInt(value, 10) || undefined;
      break;
    case "WM/Year":
      metadata.year = Number.parseInt(value, 10) || undefined;
      metadata.date = value;
      break;
    case "WM/Composer":
      metadata.composers = [value];
      break;
    case "WM/Conductor":
      metadata.conductor = value;
      break;
    case "WM/Writer":
      metadata.publisher = value;
      break;
    case "WM/Lyrics":
      metadata.lyrics = value;
      break;
    case "WM/ContentGroupDescription":
      metadata.grouping = value;
      break;
    case "WM/SharedUserRating":
      break;
    case "WM/BeatsPerMinute":
      metadata.bpm = Number.parseInt(value, 10) || undefined;
      break;
    case "WM/ISRC":
      metadata.isrc = value;
      break;
    case "WM/Barcode":
      metadata.barcode = value;
      break;
    case "WM/CatalogNo":
      metadata.catalogNumber = value;
      break;
    case "WM/Provider":
    case "WM/EncodedBy":
      metadata.encoder = value;
      break;
    case "MusicBrainz/Album Id":
      metadata.musicBrainzReleaseId = value;
      break;
    case "MusicBrainz/Track Id":
      metadata.musicBrainzRecordingId = value;
      break;
    default:
      custom[name] = value;
      break;
  }
}