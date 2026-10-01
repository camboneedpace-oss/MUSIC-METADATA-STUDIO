/**
 * Global search and the advanced filter model.
 *
 * The query language is deliberately small and predictable:
 *
 *   artist:"Daft Punk" AND format:flac
 *   year:>=2020 genre:electronic
 *   hasartwork:false -comment:"live"
 *
 * Everything a filter chip sets is compiled into the same expression, so the
 * chips and the search box can be used together without surprises.
 */

import type { FileRecord } from "../library/types";

export type QueryOp = "=" | "!=" | ">" | ">=" | "<" | "<=" | "~";
export type FieldName =
  | "artist" | "album" | "albumartist" | "title" | "genre" | "year" | "date"
  | "format" | "bitrate" | "samplerate" | "channels" | "bitdepth" | "duration"
  | "size" | "folder" | "filename" | "label" | "composer" | "comment"
  | "grouping" | "isrc" | "barcode" | "catalog" | "bpm" | "key" | "track"
  | "disc" | "tagstatus" | "modified" | "hasartwork" | "modifiedflag"
  | "lossless" | "custom";

export const FIELD_LABELS: Record<FieldName, string> = {
  artist: "Artist",
  album: "Album",
  albumartist: "Album Artist",
  title: "Title",
  genre: "Genre",
  year: "Year",
  date: "Date",
  format: "Format",
  bitrate: "Bitrate",
  samplerate: "Sample Rate",
  channels: "Channels",
  bitdepth: "Bit Depth",
  duration: "Duration",
  size: "File Size",
  folder: "Folder",
  filename: "Filename",
  label: "Label",
  composer: "Composer",
  comment: "Comment",
  grouping: "Grouping",
  isrc: "ISRC",
  barcode: "Barcode",
  catalog: "Catalog Number",
  bpm: "BPM",
  key: "Key",
  track: "Track",
  disc: "Disc",
  tagstatus: "Tag Status",
  modified: "Modified",
  hasartwork: "Artwork",
  modifiedflag: "Unsaved Changes",
  lossless: "Lossless",
  custom: "Custom Field",
};

export type FilterValue = string | number | boolean | string[];

export interface FilterClause {
  field: FieldName;
  op: QueryOp;
  value: FilterValue;
  /** For `custom`, which custom-field key this applies to. */
  customKey?: string;
}

export interface FilterGroup {
  /** All / any / none */
  mode: "all" | "any";
  clauses: FilterClause[];
}

export const EMPTY_FILTER: FilterGroup = { mode: "all", clauses: [] };

/* ---------- query parsing ---------- */

export interface ParsedQuery {
  /** Free text that was not attached to a field. */
  text: string[];
  clauses: FilterClause[];
  error?: string;
}

const FIELD_NAMES = new Set<string>(Object.keys(FIELD_LABELS));
const COMPARATORS = [">=", "<=", "!=", ">", "<", "=", "~"];

export function parseQuery(input: string): ParsedQuery {
  const result: ParsedQuery = { text: [], clauses: [] };
  const tokens = tokenizeQuery(input);
  let expectingValue = false;

  for (const token of tokens) {
    if (token === "AND" || token === "OR" || token === "NOT") continue;

    if (token.startsWith("-") && !expectingValue) {
      token.slice(1);
    }

    const negated = !expectingValue && token.startsWith("-") && token.length > 1;
    const body = negated ? token.slice(1) : token;

    if (!expectingValue) {
      const m = /^([a-zA-Z_][a-zA-Z0-9_]*):(.*)$/.exec(body);
      if (m && FIELD_NAMES.has(m[1].toLowerCase())) {
        const field = m[1].toLowerCase() as FieldName;
        let value = m[2];
        let op: QueryOp = "~";
        for (const c of COMPARATORS) {
          if (value.startsWith(c)) {
            op = c as QueryOp;
            value = value.slice(c.length);
            break;
          }
        }
        const unquoted = stripQuotes(value);
        result.clauses.push({ field, op, value: coerce(field, unquoted) });
        if (negated) result.clauses[result.clauses.length - 1].op = negateOp(op);
        continue;
      }
    }

    const unquoted = stripQuotes(body);
    if (unquoted) result.text.push(unquoted);
    expectingValue = false;
  }

  return result;
}

function negateOp(op: QueryOp): QueryOp {
  switch (op) {
    case "=":
    case "~":
      return "!=";
    case ">":
      return "<=";
    case ">=":
      return "<";
    case "<":
      return ">=";
    case "<=":
      return ">";
    default:
      return "!=";
  }
}

function coerce(field: FieldName, raw: string): FilterValue {
  if (field === "hasartwork" || field === "lossless" || field === "modifiedflag") {
    return !/^(false|no|0)$/i.test(raw);
  }
  const numeric: FieldName[] = [
    "year", "bitrate", "samplerate", "channels", "bitdepth", "duration", "size", "bpm", "track", "disc",
  ];
  if (numeric.includes(field)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  return raw;
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

/** Split on whitespace, keeping quoted phrases together. */
export function tokenizeQuery(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of input) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

/* ---------- evaluation ---------- */

function matchValue(haystack: string, op: QueryOp, needle: FilterValue): boolean {
  if (typeof needle === "boolean") return needle;
  const target = String(needle);
  switch (op) {
    case "=":
      return haystack.toLowerCase() === target.toLowerCase();
    case "!=":
      return haystack.toLowerCase() !== target.toLowerCase();
    case "~":
      return haystack.toLowerCase().includes(target.toLowerCase());
    default: {
      const a = Number(haystack);
      const b = Number(target);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      if (op === ">") return a > b;
      if (op === ">=") return a >= b;
      if (op === "<") return a < b;
      return a <= b;
    }
  }
}

function fieldValues(record: FileRecord, field: FieldName, customKey?: string): string[] {
  const m = record.metadata;
  switch (field) {
    case "artist": return m.artists ?? (m.artist ? [m.artist] : []);
    case "album": return m.album ? [m.album] : [];
    case "albumartist": return m.albumArtists ?? (m.albumArtist ? [m.albumArtist] : []);
    case "title": return m.title ? [m.title] : [];
    case "genre": return m.genres ?? (m.genre ? [m.genre] : []);
    case "composer": return m.composers ?? (m.composer ? [m.composer] : []);
    case "label": return m.label ? [m.label] : [];
    case "year": return m.year !== undefined ? [String(m.year)] : [];
    case "date": return m.date ? [m.date] : [];
    case "track": return m.trackNumber !== undefined ? [String(m.trackNumber)] : [];
    case "disc": return m.discNumber !== undefined ? [String(m.discNumber)] : [];
    case "bpm": return m.bpm !== undefined ? [String(m.bpm)] : [];
    case "key": return m.key ? [m.key] : [];
    case "comment": return m.comment ? [m.comment] : [];
    case "grouping": return m.grouping ? [m.grouping] : [];
    case "isrc": return m.isrc ? [m.isrc] : [];
    case "barcode": return m.barcode ? [m.barcode] : [];
    case "catalog": return m.catalogNumber ? [m.catalogNumber] : [];
    case "format": return [record.format];
    case "bitrate": return record.audio.bitrate ? [String(record.audio.bitrate)] : [];
    case "samplerate": return record.audio.sampleRate ? [String(record.audio.sampleRate)] : [];
    case "channels": return record.audio.channels ? [String(record.audio.channels)] : [];
    case "bitdepth": return record.audio.bitDepth ? [String(record.audio.bitDepth)] : [];
    case "duration": return record.audio.duration !== undefined ? [String(record.audio.duration)] : [];
    case "size": return [String(record.size)];
    case "folder": return [record.folder];
    case "filename": return [record.name];
    case "modified": return [String(record.modifiedAt)];
    case "tagstatus": return [record.tagStatus];
    case "hasartwork": return [String((record.metadata.artwork ?? []).length > 0)];
    case "modifiedflag": return [String(record.dirty)];
    case "lossless": return [String(Boolean(record.audio.lossless))];
    case "custom": {
      const key = customKey ?? "";
      const v = m.customFields?.[key];
      return v ? [v] : [];
    }
    default:
      return [];
  }
}

export function matchesClause(record: FileRecord, clause: FilterClause): boolean {
  if (clause.field === "hasartwork") {
    const has = (record.metadata.artwork ?? []).length > 0;
    return clause.value ? has : !has;
  }
  if (clause.field === "lossless") {
    return clause.value ? Boolean(record.audio.lossless) : !record.audio.lossless;
  }
  if (clause.field === "modifiedflag") {
    return clause.value ? record.dirty : !record.dirty;
  }
  const values = fieldValues(record, clause.field, clause.customKey);
  if (!values.length) return clause.op === "!=";
  return values.some((v) => matchValue(v, clause.op, clause.value));
}

export function matchesFilter(record: FileRecord, filter: FilterGroup): boolean {
  if (!filter.clauses.length) return true;
  return filter.mode === "any"
    ? filter.clauses.some((c) => matchesClause(record, c))
    : filter.clauses.every((c) => matchesClause(record, c));
}

/** Everything a free-text search looks at, pre-joined per record. */
const haystackCache = new WeakMap<FileRecord, string>();

export function haystack(record: FileRecord): string {
  const cached = haystackCache.get(record);
  if (cached !== undefined) return cached;
  const m = record.metadata;
  const text = [
    record.name,
    m.title,
    m.artist,
    m.album,
    m.albumArtist,
    m.artists?.join(" "),
    m.albumArtists?.join(" "),
    m.genres?.join(" "),
    m.genre,
    m.composer,
    m.composers?.join(" "),
    m.conductor,
    m.label,
    m.publisher,
    m.comment,
    m.grouping,
    m.isrc,
    m.barcode,
    m.catalogNumber,
    record.format,
    m.year !== undefined ? String(m.year) : "",
    Object.values(m.customFields ?? {}).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  haystackCache.set(record, text);
  return text;
}

export function matchesText(record: FileRecord, terms: string[]): boolean {
  if (!terms.length) return true;
  const text = haystack(record);
  return terms.every((t) => text.includes(t.toLowerCase()));
}

/* ---------- saved views ---------- */

export interface SavedView {
  id: string;
  name: string;
  query: string;
  filter: FilterGroup;
  sort: Array<{ column: string; desc: boolean }>;
  createdAt: number;
}

export function describeClause(clause: FilterClause): string {
  const label = FIELD_LABELS[clause.field] ?? clause.field;
  const key = clause.field === "custom" && clause.customKey ? `.${clause.customKey}` : "";
  const op = clause.op === "~" ? ":" : ` ${clause.op} `;
  const value = Array.isArray(clause.value) ? clause.value.join(", ") : String(clause.value);
  return `${label}${key}${op}${value}`;
}