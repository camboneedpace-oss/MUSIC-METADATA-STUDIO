/**
 * Playlist generation.
 *
 * Four formats, two path styles. M3U is the lingua franca; PLS and XSPF carry
 * extra metadata that some players use for grouping.
 */

import type { LibraryFile } from "../library/types";

export type PlaylistFormat = "m3u" | "m3u8" | "pls" | "xspf";

export const PLAYLIST_FORMATS: Array<{ id: PlaylistFormat; label: string; extension: string }> = [
  { id: "m3u", label: "M3U", extension: ".m3u" },
  { id: "m3u8", label: "M3U8 (UTF-8)", extension: ".m3u8" },
  { id: "pls", label: "PLS", extension: ".pls" },
  { id: "xspf", label: "XSPF", extension: ".xspf" },
];

export interface PlaylistOptions {
  format: PlaylistFormat;
  /** Relative paths are portable across machines; absolute ones are not. */
  paths: "relative" | "absolute";
  /** Base directory for relative paths. */
  basePath?: string;
  /** Write `#EXTM3U` headers and per-track metadata. */
  extended: boolean;
  /** Seconds of "no file" padding, required by XSPF and honoured by M3U8. */
  gapless?: boolean;
}

export const DEFAULT_PLAYLIST_OPTIONS: PlaylistOptions = {
  format: "m3u8",
  paths: "absolute",
  extended: true,
};

export function trackPath(file: LibraryFile, options: PlaylistOptions): string {
  const full = `${file.folder}/${file.name}`.replace(/^\/+/, "");
  if (options.paths === "absolute") return `/${full}`;
  const base = (options.basePath ?? "").replace(/\/+$/, "");
  if (!base) return full;
  return `${base}/${file.name}`;
}

export function buildPlaylist(files: LibraryFile[], options: PlaylistOptions): string {
  switch (options.format) {
    case "m3u":
    case "m3u8":
      return buildM3u(files, options);
    case "pls":
      return buildPls(files, options);
    case "xspf":
      return buildXspf(files, options);
    default:
      return buildM3u(files, options);
  }
}

function playlistTitle(file: LibraryFile): string {
  const m = file.metadata;
  const artist = m.artists?.join(", ") ?? m.artist ?? "Unknown Artist";
  const title = m.title ?? stripExtension(file.name);
  return `${artist} - ${title}`;
}

function stripExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

function escapeM3u(s: string): string {
  return s.replace(/\r?\n/g, " ").trim();
}

function buildM3u(files: LibraryFile[], options: PlaylistOptions): string {
  const lines: string[] = [];
  if (options.extended) lines.push("#EXTM3U");
  if (options.extended && files.length) {
    const first = files[0].metadata;
    const artist = first.artists?.join(", ") ?? first.artist ?? "";
    const album = first.album ?? "";
    if (artist) lines.push(`#PLAYLIST:${escapeM3u(album ? `${artist} — ${album}` : artist)}`);
  }
  files.forEach((file, i) => {
    if (options.extended) {
      lines.push(`#EXTINF:${Math.round(file.audio.duration ?? -1)},${escapeM3u(playlistTitle(file))}`);
      if (file.metadata.album) lines.push(`#EXTALB:${escapeM3u(file.metadata.album)}`);
      if (file.metadata.trackNumber !== undefined) lines.push(`#EXTTRACK:${file.metadata.trackNumber}`);
      if (file.audio.duration !== undefined) lines.push(`#EXTBYT:${file.size}`);
      void i;
    }
    lines.push(trackPath(file, options));
  });
  return lines.join("\n") + "\n";
}

function buildPls(files: LibraryFile[], options: PlaylistOptions): string {
  const lines = ["[playlist]"];
  files.forEach((file, i) => {
    const n = i + 1;
    lines.push(`File${n}=${trackPath(file, options)}`);
    lines.push(`Title${n}=${escapeM3u(playlistTitle(file))}`);
    if (file.audio.duration !== undefined) lines.push(`Length${n}=${Math.round(file.audio.duration)}`);
  });
  lines.push(`NumberOfEntries=${files.length}`);
  lines.push("Version=2");
  return lines.join("\n") + "\n";
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildXspf(files: LibraryFile[], options: PlaylistOptions): string {
  const first = files[0]?.metadata;
  const playlistArtist = first?.artists?.join(", ") ?? first?.artist ?? "Playlist";
  const playlistName = first?.album ?? "Playlist";
  const tracks = files
    .map((file) => {
      const m = file.metadata;
      const creator = (m.artists?.join(", ") ?? m.artist ?? "").trim();
      const parts = [
        "    <track>",
        `      <location>${xmlEscape(trackPath(file, options))}</location>`,
      ];
      if (m.title) parts.push(`      <title>${xmlEscape(m.title)}</title>`);
      if (creator) parts.push(`      <creator>${xmlEscape(creator)}</creator>`);
      if (m.album) parts.push(`      <album>${xmlEscape(m.album)}</album>`);
      if (m.trackNumber !== undefined) parts.push(`      <trackNum>${m.trackNumber}</trackNum>`);
      if (file.audio.duration !== undefined) {
        parts.push(`      <duration>${Math.round(file.audio.duration * 1000)}</duration>`);
      }
      parts.push("    </track>");
      return parts.join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>${xmlEscape(playlistName)}</title>
  <creator>${xmlEscape(playlistArtist)}</creator>
  <trackList>
${tracks}
  </trackList>
</playlist>
`;
}

/* ---------- smart playlists ---------- */

export interface SmartPlaylistRule {
  field: string;
  op: "=" | "!=" | ">" | ">=" | "<" | "<=";
  value: string | number;
}

export interface SmartPlaylist {
  id: string;
  name: string;
  /** all / any */
  mode: "all" | "any";
  rules: SmartPlaylistRule[];
  format: PlaylistFormat;
  paths: "relative" | "absolute";
}

function numericField(file: LibraryFile, field: string): number | undefined {
  switch (field) {
    case "year": return file.metadata.year;
    case "bitrate": return file.audio.bitrate;
    case "samplerate": return file.audio.sampleRate;
    case "channels": return file.audio.channels;
    case "bitdepth": return file.audio.bitDepth;
    case "duration": return file.audio.duration;
    case "size": return file.size;
    case "track": return file.metadata.trackNumber;
    case "disc": return file.metadata.discNumber;
    case "bpm": return file.metadata.bpm;
    default: return undefined;
  }
}

function stringField(file: LibraryFile, field: string): string[] {
  const m = file.metadata;
  switch (field) {
    case "artist": return m.artists ?? [];
    case "albumartist": return m.albumArtists ?? [];
    case "album": return m.album ? [m.album] : [];
    case "title": return m.title ? [m.title] : [];
    case "genre": return m.genres ?? [];
    case "format": return [file.format];
    case "label": return m.label ? [m.label] : [];
    case "composer": return m.composers ?? [];
    case "folder": return [file.folder];
    default: return [];
  }
}

export function matchesSmartRule(file: LibraryFile, rule: SmartPlaylistRule): boolean {
  const numeric = numericField(file, rule.field);
  if (numeric !== undefined) {
    const target = Number(rule.value);
    if (!Number.isFinite(target)) return false;
    switch (rule.op) {
      case "=": return numeric === target;
      case "!=": return numeric !== target;
      case ">": return numeric > target;
      case ">=": return numeric >= target;
      case "<": return numeric < target;
      case "<=": return numeric <= target;
      default: return false;
    }
  }
  if (rule.field === "lossless") {
    const want = String(rule.value).toLowerCase() === "true";
    return Boolean(file.audio.lossless) === want;
  }
  if (rule.field === "hasartwork") {
    const want = String(rule.value).toLowerCase() === "true";
    return ((file.metadata.artwork ?? []).length > 0) === want;
  }
  const values = stringField(file, rule.field).map((v) => v.toLowerCase());
  const target = String(rule.value).toLowerCase();
  switch (rule.op) {
    case "=":
      return values.includes(target);
    case "!=":
      return !values.includes(target);
    case ">":
      return values.some((v) => v > target);
    case ">=":
      return values.some((v) => v >= target);
    case "<":
      return values.some((v) => v < target);
    case "<=":
      return values.some((v) => v <= target);
    default:
      return false;
  }
}

export function evaluateSmartPlaylist(files: LibraryFile[], playlist: SmartPlaylist): LibraryFile[] {
  if (!playlist.rules.length) return [];
  return files.filter((file) =>
    playlist.mode === "any"
      ? playlist.rules.some((r) => matchesSmartRule(file, r))
      : playlist.rules.every((r) => matchesSmartRule(file, r)),
  );
}