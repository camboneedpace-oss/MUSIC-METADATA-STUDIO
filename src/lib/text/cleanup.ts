/**
 * Metadata cleanup engine.
 *
 * Every operation is a pure `string -> string` transform (or a numeric
 * normaliser) so the same code powers the live preview in the Cleanup tool
 * and the batch run inside an Action Group.
 */

import type { MusicMetadata } from "../metadata/types";

export type CleanupOpId =
  | "trim"
  | "collapseSpaces"
  | "normalizeUnicode"
  | "normalizePunctuation"
  | "convertQuotes"
  | "normalizeApostrophes"
  | "titleCase"
  | "sentenceCase"
  | "upperCase"
  | "lowerCase"
  | "removePrefixes"
  | "normalizeFeaturing"
  | "removeDuplicateValues"
  | "removeEmptyTags"
  | "normalizeTrackNumbers"
  | "normalizeDiscNumbers"
  | "normalizeDates"
  | "normalizeGenre"
  | "stripHtmlEntities"
  | "collapseSeparators";

export interface CleanupOp {
  id: CleanupOpId;
  label: string;
  description: string;
  /** Text fields this op applies to. Empty = all text fields. */
  fields: string[];
  /** Numeric fields this op applies to. */
  numeric?: string[];
  /** Per-op configuration. */
  options?: Record<string, string | number | boolean>;
  enabled: boolean;
}

export const TEXT_FIELDS = [
  "title", "artists", "album", "albumArtists", "composers", "conductor",
  "genres", "grouping", "comment", "label", "publisher", "copyright",
  "catalogNumber", "isrc", "barcode", "language", "lyrics", "customFields",
] as const;

export const CLEANUP_OPS: CleanupOp[] = [
  { id: "trim", label: "Trim whitespace", description: "Remove leading and trailing spaces from every text field.", fields: [...TEXT_FIELDS], enabled: true },
  { id: "collapseSpaces", label: "Collapse repeated spaces", description: "Turn runs of spaces and tabs into a single space.", fields: [...TEXT_FIELDS], enabled: true },
  { id: "normalizeUnicode", label: "Normalise Unicode (NFC)", description: "Recompose decomposed characters so accented letters and CJK compare equal everywhere.", fields: [...TEXT_FIELDS], enabled: true },
  { id: "stripHtmlEntities", label: "Decode HTML entities", description: "Replace &amp; &#39; and friends with the characters they stand for.", fields: [...TEXT_FIELDS], enabled: false },
  { id: "convertQuotes", label: "Convert smart quotes", description: 'Replace “ ” ‘ ’ with straight quotes.', fields: ["title", "album", "comment", "grouping", "genres"], enabled: false },
  { id: "normalizeApostrophes", label: "Normalise apostrophes", description: "Replace the typographic apostrophe with U+0027.", fields: ["title", "album", "artists", "genres", "comment"], enabled: true },
  { id: "normalizePunctuation", label: "Normalise dashes and ellipses", description: "Replace en/em dashes and the ellipsis character with ASCII equivalents.", fields: ["title", "album", "comment"], enabled: false },
  { id: "collapseSeparators", label: "Tidy surrounding punctuation", description: "Remove duplicated punctuation and trailing separators.", fields: ["title", "album"], enabled: false },
  { id: "titleCase", label: "Title Case", description: "Capitalise each word. Words already carrying capitals are left alone.", fields: ["title", "album"], enabled: false },
  { id: "sentenceCase", label: "Sentence case", description: "Capitalise the first letter and lower-case the rest.", fields: ["title", "album"], enabled: false },
  { id: "upperCase", label: "UPPER CASE", description: "Upper-case the whole value.", fields: ["title", "album"], enabled: false },
  { id: "lowerCase", label: "lower case", description: "Lower-case the whole value.", fields: ["title", "album"], enabled: false },
  {
    id: "removePrefixes",
    label: "Remove unwanted prefixes",
    description: "Strip leading noise such as “01 -” or [FLAC] before a real title.",
    fields: ["title"],
    options: { prefixes: "[FLAC] [MP3] 00- 01- 001 - " },
    enabled: true,
  },
  {
    id: "normalizeFeaturing",
    label: "Normalise featuring artists",
    description: 'Rewrite feat. / ft. / featuring into a consistent “feat.” form.',
    fields: ["title", "artists"],
    options: { style: "feat." },
    enabled: false,
  },
  { id: "removeDuplicateValues", label: "Remove duplicate values", description: "Drop repeated entries inside multi-value fields, case-insensitively.", fields: ["artists", "genres", "albumArtists", "composers"], enabled: true },
  { id: "removeEmptyTags", label: "Remove empty tags", description: "Clear fields that hold only whitespace or empty separators.", fields: [...TEXT_FIELDS], enabled: true },
  { id: "normalizeTrackNumbers", label: "Normalise track numbers", description: "Strip leading zeros and non-numeric suffixes from track numbers.", fields: [], numeric: ["trackNumber", "trackTotal"], enabled: true },
  { id: "normalizeDiscNumbers", label: "Normalise disc numbers", description: "Strip leading zeros and non-numeric suffixes from disc numbers.", fields: [], numeric: ["discNumber", "discTotal"], enabled: false },
  {
    id: "normalizeDates",
    label: "Normalise dates",
    description: "Reduce every date to YYYY, YYYY-MM or YYYY-MM-DD depending on how much information it carries.",
    fields: ["date"],
    options: { style: "auto" },
    enabled: true,
  },
  {
    id: "normalizeGenre",
    label: "Normalise genre names",
    description: "Map common spellings onto a single canonical genre list.",
    fields: ["genres"],
    options: { list: "canonical" },
    enabled: false,
  },
];

/* ---------- canonical genre map ---------- */

export const CANONICAL_GENRES = [
  "Ambient", "Blues", "Classical", "Country", "Dance", "Disco", "Drum & Bass",
  "Dub", "Dubstep", "Electronic", "Experimental", "Folk", "Funk", "Hip-Hop",
  "House", "Indie", "Industrial", "Jazz", "Krautrock", "Metal", "New Age",
  "Opera", "Pop", "Post-Punk", "Post-Rock", "Progressive Rock", "Punk",
  "R&B", "Rap", "Reggae", "Rock", "Shoegaze", "Soul", "Soundtrack",
  "Techno", "Trance", "Trip-Hop", "World",
];

const GENRE_ALIASES: Record<string, string> = {
  "hip hop": "Hip-Hop",
  "hiphop": "Hip-Hop",
  "hip-hop": "Hip-Hop",
  rnb: "R&B",
  "r & b": "R&B",
  "r&b": "R&B",
  drum: "Drum & Bass",
  dnb: "Drum & Bass",
  "drum'n'bass": "Drum & Bass",
  "drum and bass": "Drum & Bass",
  "drum & bass": "Drum & Bass",
  "electronic dance music": "Electronic",
  edm: "Electronic",
  electro: "Electronic",
  techno: "Techno",
  house: "House",
  progressive: "Progressive Rock",
  "prog rock": "Progressive Rock",
  "post punk": "Post-Punk",
  "post rock": "Post-Rock",
  "trip hop": "Trip-Hop",
  triphop: "Trip-Hop",
  "rhythm and blues": "R&B",
  "rhythm & blues": "R&B",
  "rock & roll": "Rock",
  "rock and roll": "Rock",
  "rock'n'roll": "Rock",
  "alternative rock": "Rock",
  alt: "Rock",
  "classic rock": "Rock",
  "new age": "New Age",
  "newage": "New Age",
  "sci-fi": "Electronic",
  "science fiction": "Electronic",
  "downtempo": "Ambient",
  "chillout": "Ambient",
  "chill-out": "Ambient",
  "kraut-rock": "Krautrock",
  "rap ": "Rap",
  "hip hop/rap": "Hip-Hop",
};

/* ---------- individual operations ---------- */

const FEAT_RE = /\s*\((?:feat|ft|featuring|ft\.)\s+([^)]*)\)\s*/gi;
const FEAT_INLINE = /\s+(?:feat|ft|featuring)\.?\s+/gi;

export function applyTextOp(value: string, op: CleanupOp): string {
  const opts = op.options ?? {};
  switch (op.id) {
    case "trim":
      return value.trim();
    case "collapseSpaces":
      return value.replace(/[ \t ]{2,}/g, " ");
    case "normalizeUnicode":
      // NFC plus a sweep of invisible characters that break comparisons and
      // sort order between taggers.
      return value
        .normalize("NFC")
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "");
    case "stripHtmlEntities":
      return decodeEntities(value);
    case "convertQuotes":
      return value.replace(/[“”„]/g, '"').replace(/[‘’‚]/g, "'");
    case "normalizeApostrophes":
      return value.replace(/[ʼ‘`´]/g, "'");
    case "normalizePunctuation":
      return value
        .replace(/[–—]/g, "-")
        .replace(/…/g, "...")
        .replace(/ /g, " ");
    case "collapseSeparators":
      return value
        .replace(/[,;]\s*([,;.])/g, "$1")
        .replace(/\s*([,;])\s*([,;])/g, "$1$2")
        .replace(/[\s,;:-]+$/, "");
    case "titleCase":
      return smartTitleCase(value);
    case "sentenceCase":
      return value.toLowerCase().replace(/^\p{L}/u, (c) => c.toUpperCase());
    case "upperCase":
      return value.toUpperCase();
    case "lowerCase":
      return value.toLowerCase();
    case "removePrefixes": {
      const prefixes = String(opts.prefixes ?? "")
        .split(/[,|]/)
        .map((p) => p.trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
      let out = value;
      let changed = true;
      while (changed) {
        changed = false;
        for (const p of prefixes) {
          if (out.toLowerCase().startsWith(p.toLowerCase())) {
            out = out.slice(p.length).trim();
            changed = true;
          }
        }
      }
      return out.replace(/^[-–—_:,\s]+/, "").trim();
    }
    case "normalizeFeaturing": {
      const style = String(opts.style ?? "feat.");
      return value
        .replace(FEAT_RE, (_, names: string) => ` (${style} ${names.trim()})`)
        .replace(FEAT_INLINE, ` ${style} `)
        .replace(/\s{2,}/g, " ");
    }
    case "removeDuplicateValues":
      return value;
    case "removeEmptyTags":
      return /[\s,;/|]+/.test(value) ? "" : value;
    case "normalizeDates":
      return normalizeDate(value, (opts.style as "auto" | "year" | "year-month" | "full") ?? "auto");
    case "normalizeGenre":
      return normalizeGenreName(value);
    default:
      return value;
  }
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–",
    mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => named[name.toLowerCase()] ?? m);
}

const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on",
  "or", "per", "the", "to", "v", "via", "vs",
]);

export function smartTitleCase(value: string): string {
  // Preserve intentional casing: if the word already mixes case, leave it.
  return value.replace(/\b[\p{L}\p{N}'’.-]+/gu, (word, offset: number, whole: string) => {
    if (/[A-Z]/.test(word) && /[a-z]/.test(word)) return word;
    const lower = word.toLowerCase();
    const isEdge = offset === 0 || offset + word.length >= whole.length;
    if (!isEdge && SMALL_WORDS.has(lower.replace(/[.]/g, ""))) return lower;
    return lower.replace(/\p{L}/u, (c) => c.toUpperCase());
  });
}

export function normalizeDate(value: string, style: "auto" | "year" | "year-month" | "full"): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  // YYYY
  const yearOnly = /(\d{4})/.exec(trimmed);
  if (!yearOnly) return trimmed;

  // YYYY-MM-DD (any separator)
  const iso = /(\d{4})[-/.\s](\d{1,2})[-/.\s](\d{1,2})/.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    if (style === "year") return y;
    if (style === "year-month") return `${y}-${m.padStart(2, "0")}`;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const yearMonth = /(\d{4})[-/.\s](\d{1,2})(?!\d)/.exec(trimmed);
  if (yearMonth) {
    const [, y, m] = yearMonth;
    if (style === "year") return y;
    return `${y}-${m.padStart(2, "0")}`;
  }
  // Free text that contains nothing but a year plus noise ("1998 (Remaster)").
  if (/^[^\d]*\d{4}[^\d]*$/.test(trimmed) && style !== "full") return yearOnly[1];
  return trimmed;
}

export function normalizeGenreName(value: string): string {
  const key = value.trim().toLowerCase();
  if (GENRE_ALIASES[key]) return GENRE_ALIASES[key];
  const match = CANONICAL_GENRES.find((g) => g.toLowerCase() === key);
  return match ?? value.trim();
}

export function normalizeNumber(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

/* ---------- applying ops to a whole record ---------- */

export interface CleanupChange {
  field: string;
  before: unknown;
  after: unknown;
}

export function applyCleanupOps(
  metadata: MusicMetadata,
  ops: CleanupOp[],
): { metadata: MusicMetadata; changes: CleanupChange[] } {
  const next: MusicMetadata = { ...metadata };
  const changes: CleanupChange[] = [];
  const enabled = ops.filter((o) => o.enabled);

  for (const op of enabled) {
    for (const field of op.fields.length ? op.fields : []) {
      if (field === "customFields") {
        const custom = { ...(next.customFields ?? {}) };
        let touched = false;
        for (const [k, v] of Object.entries(custom)) {
          const after = applyTextOp(v, op);
          if (after !== v) {
            custom[k] = after;
            touched = true;
          }
        }
        if (touched) {
          changes.push({ field: "customFields", before: { ...(next.customFields ?? {}) }, after: { ...custom } });
          next.customFields = custom;
        }
        continue;
      }

      const value = (next as Record<string, unknown>)[field];
      if (Array.isArray(value)) {
        const seen = new Set<string>();
        let touched = false;
        const after: string[] = [];
        for (const entry of value) {
          let nextEntry = applyTextOp(entry, op);
          if (op.id === "removeDuplicateValues") {
            const key = nextEntry.trim().toLowerCase();
            if (seen.has(key)) {
              touched = true;
              continue;
            }
            seen.add(key);
          }
          if (nextEntry !== entry) touched = true;
          if (nextEntry.trim()) after.push(nextEntry);
          else touched = true;
        }
        if (touched) {
          changes.push({ field, before: [...value], after });
          (next as Record<string, unknown>)[field] = after;
        }
      } else if (typeof value === "string") {
        const after = applyTextOp(value, op);
        if (after !== value) {
          changes.push({ field, before: value, after });
          (next as Record<string, unknown>)[field] = after;
        }
      }
    }

    for (const field of op.numeric ?? []) {
      const value = (next as Record<string, unknown>)[field] as number | undefined;
      const after = normalizeNumber(value);
      if (after !== value) {
        changes.push({ field, before: value, after });
        (next as Record<string, unknown>)[field] = after;
      }
    }
  }

  // A date change keeps the year field consistent.
  if (changes.some((c) => c.field === "date") && typeof next.date === "string") {
    const y = /(\d{4})/.exec(next.date);
    if (y) next.year = Number.parseInt(y[1], 10);
  }

  return { metadata: next, changes };
}