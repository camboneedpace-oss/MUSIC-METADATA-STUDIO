/**
 * Translation layer between the unified model and Vorbis-style comments.
 *
 * FLAC, Ogg Vorbis, Opus, Speex and APEv2 all store the same shape of
 * key/value pairs with slightly different vocabularies, so they share this.
 */

import type { Artwork, MusicMetadata, RawTag } from "../types";
import { probeImage } from "../binary";
import {
  buildVorbisComment,
  decodePictureBlock,
  isMultiKey,
  parseVorbisComment,
  pictureToBase64Comment,
  splitVorbisPair,
  type VorbisComment,
} from "./vorbis";

export type CommentList = Array<[string, string]>;

/** Unified field → the set of comment keys we own for it. */
const FIELD_TO_KEYS: Array<[keyof MusicMetadata, string[]]> = [
  ["title", ["TITLE"]],
  ["artists", ["ARTIST"]],
  ["album", ["ALBUM"]],
  ["albumArtists", ["ALBUMARTIST", "ALBUM ARTIST"]],
  ["composers", ["COMPOSER"]],
  ["conductor", ["CONDUCTOR"]],
  ["album", ["ALBUM"]],
  ["genres", ["GENRE"]],
  ["grouping", ["GROUPING"]],
  ["comment", ["COMMENT", "DESCRIPTION"]],
  ["bpm", ["BPM", "TEMPO"]],
  ["key", ["KEY", "INITIALKEY"]],
  ["copyright", ["COPYRIGHT"]],
  ["publisher", ["PUBLISHER"]],
  ["label", ["LABEL"]],
  ["isrc", ["ISRC"]],
  ["barcode", ["BARCODE"]],
  ["catalogNumber", ["CATALOGNUMBER", "CATALOG"]],
  ["lyrics", ["LYRICS", "UNSYNCEDLYRICS"]],
  ["language", ["LANGUAGE"]],
  ["musicBrainzRecordingId", ["MUSICBRAINZ_TRACKID"]],
  ["musicBrainzReleaseId", ["MUSICBRAINZ_ALBUMID"]],
  ["musicBrainzReleaseGroupId", ["MUSICBRAINZ_RELEASEGROUPID"]],
  ["musicBrainzWorkId", ["MUSICBRAINZ_WORKID"]],
  ["replayGainTrackGain", ["REPLAYGAIN_TRACK_GAIN"]],
  ["replayGainTrackPeak", ["REPLAYGAIN_TRACK_PEAK"]],
  ["replayGainAlbumGain", ["REPLAYGAIN_ALBUM_GAIN"]],
  ["replayGainAlbumPeak", ["REPLAYGAIN_ALBUM_PEAK"]],
  ["encoderSettings", ["ENCODERSETTINGS"]],
];

const MANAGE_NUMERIC = new Set([
  "TRACKNUMBER",
  "TRACKTOTAL",
  "TOTALTRACKS",
  "DISCNUMBER",
  "DISCTOTAL",
  "TOTALDISCS",
  "YEAR",
  "DATE",
  "COMPILATION",
  "BPM",
]);

const MANAGE_KEYS = new Set<string>([
  ...FIELD_TO_KEYS.flatMap(([, keys]) => keys),
  ...MANAGE_NUMERIC,
]);

export interface CommentExtract {
  metadata: MusicMetadata;
  raw: RawTag[];
  artwork: Artwork[];
  warnings: string[];
}

export function extractComments(
  comment: VorbisComment,
  options: { pictureAsBase64: boolean },
): CommentExtract {
  // FLAC keeps pictures in PICTURE blocks, but a METADATA_BLOCK_PICTURE
  // comment is still legal there; Ogg has no blocks, so the comment form is
  // the only option. Both forms are read either way.
  const blockPictures = extractPictureBlocks(comment);
  const base64Pictures = extractCoverArtBase64(comment, options.pictureAsBase64);
  const metadata = {} as MusicMetadata;
  const raw: RawTag[] = [...blockPictures.raw, ...base64Pictures.raw];
  const artwork: Artwork[] = [...blockPictures.artwork, ...base64Pictures.artwork];
  const warnings: string[] = [...blockPictures.warnings, ...base64Pictures.warnings];
  const custom: Record<string, string> = {};

  for (const [key, value] of comment.comments) {
    const k = key.toUpperCase();
    if (k === "METADATA_BLOCK_PICTURE" || k === "COVERART") continue;

    switch (k) {
      case "TITLE":
        metadata.title = value;
        break;
      case "ARTIST":
        (metadata.artists ??= []).push(value);
        break;
      case "ALBUMARTIST":
      case "ALBUM ARTIST":
        (metadata.albumArtists ??= []).push(value);
        break;
      case "COMPOSER":
        (metadata.composers ??= []).push(value);
        break;
      case "CONDUCTOR":
        metadata.conductor = value;
        break;
      case "ALBUM":
        metadata.album = value;
        break;
      case "TRACKNUMBER": {
        const [n, t] = splitVorbisPair(value);
        metadata.trackNumber = n;
        if (t !== undefined) metadata.trackTotal = t;
        break;
      }
      case "TRACKTOTAL":
      case "TOTALTRACKS":
        metadata.trackTotal = Number.parseInt(value, 10) || undefined;
        break;
      case "DISCNUMBER": {
        const [n, t] = splitVorbisPair(value);
        metadata.discNumber = n;
        if (t !== undefined) metadata.discTotal = t;
        break;
      }
      case "DISCTOTAL":
      case "TOTALDISCS":
        metadata.discTotal = Number.parseInt(value, 10) || undefined;
        break;
      case "DATE":
        metadata.date = value;
        if (/^\d{4}/.test(value)) metadata.year = Number.parseInt(value.slice(0, 4), 10);
        break;
      case "YEAR": {
        const n = Number.parseInt(value, 10);
        if (Number.isFinite(n)) {
          metadata.year = n;
          if (!metadata.date) metadata.date = String(n);
        }
        break;
      }
      case "GENRE":
        (metadata.genres ??= []).push(value);
        break;
      case "GROUPING":
        metadata.grouping = value;
        break;
      case "COMMENT":
      case "DESCRIPTION":
        metadata.comment = value;
        break;
      case "BPM":
      case "TEMPO": {
        const n = Math.round(Number.parseFloat(value));
        if (Number.isFinite(n)) metadata.bpm = n;
        break;
      }
      case "KEY":
      case "INITIALKEY":
        metadata.key = value;
        break;
      case "COPYRIGHT":
        metadata.copyright = value;
        break;
      case "PUBLISHER":
        metadata.publisher = value;
        break;
      case "LABEL":
        metadata.label = value;
        break;
      case "ISRC":
        metadata.isrc = value;
        break;
      case "BARCODE":
        metadata.barcode = value;
        break;
      case "CATALOGNUMBER":
      case "CATALOG":
        metadata.catalogNumber = value;
        break;
      case "LYRICS":
      case "UNSYNCEDLYRICS":
        metadata.lyrics = value;
        break;
      case "LANGUAGE":
        metadata.language = value;
        break;
      case "COMPILATION":
        metadata.compilation = /^(1|yes|true)$/i.test(value);
        break;
      case "MUSICBRAINZ_TRACKID":
        metadata.musicBrainzRecordingId = value;
        break;
      case "MUSICBRAINZ_ALBUMID":
        metadata.musicBrainzReleaseId = value;
        break;
      case "MUSICBRAINZ_RELEASEGROUPID":
        metadata.musicBrainzReleaseGroupId = value;
        break;
      case "MUSICBRAINZ_WORKID":
        metadata.musicBrainzWorkId = value;
        break;
      case "REPLAYGAIN_TRACK_GAIN":
        metadata.replayGainTrackGain = value;
        break;
      case "REPLAYGAIN_TRACK_PEAK":
        metadata.replayGainTrackPeak = value;
        break;
      case "REPLAYGAIN_ALBUM_GAIN":
        metadata.replayGainAlbumGain = value;
        break;
      case "REPLAYGAIN_ALBUM_PEAK":
        metadata.replayGainAlbumPeak = value;
        break;
      case "ENCODER":
        metadata.encoder = value;
        break;
      case "ENCODERSETTINGS":
        metadata.encoderSettings = value;
        break;
      default:
        // AcoustID fingerprints, MusicIP PUID, label IDs, custom user keys.
        custom[key] = value;
        break;
    }
    raw.push({ key, values: [value] });
  }

  metadata.artwork = artwork;
  if (Object.keys(custom).length) metadata.customFields = custom;
  return { metadata, raw, artwork, warnings };
}

/**
 * Legacy `Cover Art (front)=<base64>` field: bare image bytes, no picture
 * header. `METADATA_BLOCK_PICTURE` is handled by extractPictureBlocks.
 */
function extractCoverArtBase64(comment: VorbisComment, enabled: boolean) {
  const artwork: Artwork[] = [];
  const raw: RawTag[] = [];
  const warnings: string[] = [];
  if (!enabled) return { metadata: {} as MusicMetadata, raw, artwork, warnings };
  for (const [key, value] of comment.comments) {
    if (key.toUpperCase() !== "COVERART") continue;
    try {
      const bin = atob(value);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const probed = probeImage(bytes);
      artwork.push({
        id: `cover-${Math.random().toString(36).slice(2, 10)}`,
        data: bytes,
        mime: probed.mime,
        role: "front",
        width: probed.width,
        height: probed.height,
        bytes: bytes.length,
      });
      raw.push({ key, values: [probed.mime] });
    } catch {
      warnings.push("COVERART field is not valid base64; ignored");
    }
  }
  return { metadata: {} as MusicMetadata, raw, artwork, warnings };
}

function extractPictureBlocks(comment: VorbisComment) {
  const artwork: Artwork[] = [];
  const warnings: string[] = [];
  const raw: RawTag[] = [];
  for (const [key, value] of comment.comments) {
    if (key.toUpperCase() !== "METADATA_BLOCK_PICTURE") continue;
    try {
      const art = decodePictureBlock(base64ToBytes(value));
      if (art) {
        artwork.push(art);
        raw.push({ key, values: [art.mime], description: art.role });
      }
    } catch {
      warnings.push("METADATA_BLOCK_PICTURE is not valid base64; ignored");
    }
  }
  return { metadata: {} as MusicMetadata, raw, artwork, warnings };
}

function base64ToBytes(v: string): Uint8Array {
  const bin = atob(v);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Build the comment list for a write, preserving unknown keys. */
export function composeComments(
  metadata: MusicMetadata,
  preserved: CommentList,
  options: { pictureAsBase64: boolean },
): CommentList {
  const out: CommentList = [];
  const managed = new Set(MANAGE_KEYS);

  const push = (key: string, value: string | undefined) => {
    if (value !== undefined && value !== "") out.push([key, value]);
  };
  const pushNum = (key: string, value: number | undefined) => {
    if (value !== undefined && Number.isFinite(value)) out.push([key, String(value)]);
  };

  push("TITLE", metadata.title);
  if (metadata.artists?.length) for (const a of metadata.artists) push("ARTIST", a);
  push("ALBUM", metadata.album);
  if (metadata.albumArtists?.length) for (const a of metadata.albumArtists) push("ALBUMARTIST", a);
  if (metadata.composers?.length) for (const c of metadata.composers) push("COMPOSER", c);
  push("CONDUCTOR", metadata.conductor);
  if (metadata.genres?.length) for (const g of metadata.genres) push("GENRE", g);
  pushNum("TRACKNUMBER", metadata.trackNumber);
  pushNum("TRACKTOTAL", metadata.trackTotal);
  pushNum("DISCNUMBER", metadata.discNumber);
  pushNum("DISCTOTAL", metadata.discTotal);
  if (metadata.date) push("DATE", metadata.date);
  else pushNum("YEAR", metadata.year);
  push("GROUPING", metadata.grouping);
  push("COMMENT", metadata.comment);
  pushNum("BPM", metadata.bpm);
  push("KEY", metadata.key);
  push("COPYRIGHT", metadata.copyright);
  push("PUBLISHER", metadata.publisher);
  push("LABEL", metadata.label);
  push("ISRC", metadata.isrc);
  push("BARCODE", metadata.barcode);
  push("CATALOGNUMBER", metadata.catalogNumber);
  push("LYRICS", metadata.lyrics);
  push("LANGUAGE", metadata.language);
  push("MUSICBRAINZ_TRACKID", metadata.musicBrainzRecordingId);
  push("MUSICBRAINZ_ALBUMID", metadata.musicBrainzReleaseId);
  push("MUSICBRAINZ_RELEASEGROUPID", metadata.musicBrainzReleaseGroupId);
  push("MUSICBRAINZ_WORKID", metadata.musicBrainzWorkId);
  push("REPLAYGAIN_TRACK_GAIN", metadata.replayGainTrackGain);
  push("REPLAYGAIN_TRACK_PEAK", metadata.replayGainTrackPeak);
  push("REPLAYGAIN_ALBUM_GAIN", metadata.replayGainAlbumGain);
  push("REPLAYGAIN_ALBUM_PEAK", metadata.replayGainAlbumPeak);
  if (metadata.compilation !== undefined) push("COMPILATION", metadata.compilation ? "1" : "0");
  push("ENCODERSETTINGS", metadata.encoderSettings);

  for (const [k, v] of Object.entries(metadata.customFields ?? {})) {
    if (k.startsWith("_")) continue;
    if (managed.has(k.toUpperCase())) continue;
    push(k, v);
  }

  for (const [k, v] of preserved) {
    if (managed.has(k.toUpperCase())) continue;
    out.push([k, v]);
  }

  if (metadata.artwork?.length) {
    for (const art of metadata.artwork) {
      if (options.pictureAsBase64) {
        out.push(pictureToBase64Comment(art));
      }
    }
  }

  return out;
}

export { buildVorbisComment, parseVorbisComment, isMultiKey };
export type { VorbisComment };