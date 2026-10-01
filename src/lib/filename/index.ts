/**
 * Filename → tag parsing and tag → filename generation.
 *
 * Templates use `%token%` syntax. A literal `/` in a rename template creates
 * a folder boundary; a literal `\` escapes the next character. The two
 * directions share one token table so a template that works in one works in
 * the other.
 */

import type { MusicMetadata } from "../metadata/types";

export const TOKENS = [
  "artist", "albumartist", "album", "title", "track", "tracktotal", "disc",
  "disctotal", "year", "date", "genre", "comment", "label", "publisher",
  "composer", "conductor", "bpm", "key", "copyright", "isrc", "grouping",
  "compilation", "lyrics", "filename",
] as const;

export type Token = (typeof TOKENS)[number];

export const TOKEN_HELP: Record<Token, string> = {
  artist: "Primary artist",
  albumartist: "Album artist",
  album: "Album title",
  title: "Track title",
  track: "Track number",
  tracktotal: "Total tracks",
  disc: "Disc number",
  disctotal: "Total discs",
  year: "Release year",
  date: "Full date",
  genre: "Genre",
  comment: "Comment",
  label: "Label",
  publisher: "Publisher",
  composer: "Composer",
  conductor: "Conductor",
  bpm: "Beats per minute",
  key: "Musical key",
  copyright: "Copyright line",
  isrc: "ISRC code",
  grouping: "Content grouping",
  compilation: "Compilation flag",
  lyrics: "Lyrics",
  filename: "Current filename without extension",
};

export type TokenValue = string | number | undefined | null;

/** Resolve a token against a metadata object. */
export function tokenValue(m: MusicMetadata, token: Token, originalName?: string): TokenValue {
  switch (token) {
    case "artist":
      return m.artists?.join(" & ") ?? m.artist;
    case "albumartist":
      return m.albumArtists?.join(" & ") ?? m.albumArtist;
    case "album":
      return m.album;
    case "title":
      return m.title;
    case "track":
      return m.trackNumber;
    case "tracktotal":
      return m.trackTotal;
    case "disc":
      return m.discNumber;
    case "disctotal":
      return m.discTotal;
    case "year":
      return m.year;
    case "date":
      return m.date;
    case "genre":
      return m.genres?.join(" / ") ?? m.genre;
    case "comment":
      return m.comment;
    case "label":
      return m.label;
    case "publisher":
      return m.publisher;
    case "composer":
      return m.composers?.join(" & ") ?? m.composer;
    case "conductor":
      return m.conductor;
    case "bpm":
      return m.bpm;
    case "key":
      return m.key;
    case "copyright":
      return m.copyright;
    case "isrc":
      return m.isrc;
    case "grouping":
      return m.grouping;
    case "compilation":
      return m.compilation ? "Compilation" : undefined;
    case "lyrics":
      return m.lyrics;
    case "filename":
      return originalName ? stripExtension(originalName) : undefined;
    default:
      return undefined;
  }
}

export function stripExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/* ---------- tag → filename ---------- */

export interface GenerateOptions {
  /** `track` → `01`, `1` → `1`, empty → `00`. */
  trackPadding?: number;
  caseStyle?: "keep" | "upper" | "lower" | "title";
  /** Replace characters that are illegal on common filesystems. */
  sanitize?: boolean;
}

export interface GenerateResult {
  /** Path segments; more than one means sub-folders are requested. */
  segments: string[];
  /** The new basename without extension. */
  basename: string;
  missing: Token[];
}

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitizeSegment(s: string, fallback = "Unknown"): string {
  const cleaned = s
    .replace(ILLEGAL, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/, "")
    .trim();
  return cleaned.length ? cleaned : fallback;
}

function applyCase(s: string, style: GenerateOptions["caseStyle"]): string {
  switch (style) {
    case "upper":
      return s.toUpperCase();
    case "lower":
      return s.toLowerCase();
    case "title":
      return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    default:
      return s;
  }
}

export function generateFilename(
  template: string,
  metadata: MusicMetadata,
  originalName = "",
  options: GenerateOptions = {},
): GenerateResult {
  const padding = options.trackPadding ?? 2;
  const missing = new Set<Token>();
  const segments: string[] = [];
  let current = "";

  const pushToken = (rawToken: string) => {
    const token = rawToken.toLowerCase() as Token;
    const value = tokenValue(metadata, token, originalName);
    let text: string;
    if (value === undefined || value === null || value === "") {
      missing.add(token);
      text = "";
    } else if ((token === "track" || token === "disc") && typeof value === "number") {
      text = String(value).padStart(padding, "0");
    } else {
      text = String(value);
    }
    current += applyCase(text, options.caseStyle);
  };

  const parsed = tokenize(template);
  for (const part of parsed) {
    if (part.kind === "literal") {
      if (part.value === "/") {
        segments.push(current);
        current = "";
      } else {
        current += part.value;
      }
    } else {
      pushToken(part.token);
    }
  }
  segments.push(current);

  const sanitized = options.sanitize === false ? segments : segments.map((s) => sanitizeSegment(s));
  return {
    segments: sanitized.filter((s, i) => s !== "" || i === sanitized.length - 1),
    basename: sanitized[sanitized.length - 1] ?? "",
    missing: [...missing],
  };
}

/** Split a template into literals and tokens, honouring backslash escapes. */
export function tokenize(template: string): Array<{ kind: "literal"; value: string } | { kind: "token"; token: string }> {
  const out: Array<{ kind: "literal"; value: string } | { kind: "token"; token: string }> = [];
  let literal = "";
  let i = 0;
  while (i < template.length) {
    if (template[i] === "\\" && i + 1 < template.length) {
      literal += template[i + 1];
      i += 2;
      continue;
    }
    if (template[i] === "%") {
      const end = template.indexOf("%", i + 1);
      if (end === -1) {
        literal += template[i];
        i++;
        continue;
      }
      if (literal) {
        out.push({ kind: "literal", value: literal });
        literal = "";
      }
      out.push({ kind: "token", token: template.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    literal += template[i];
    i++;
  }
  if (literal) out.push({ kind: "literal", value: literal });
  return out;
}

export function hasExtension(template: string): boolean {
  return /\.([a-z0-9]{1,5})$/i.test(template);
}

/* ---------- filename → tags ---------- */

export interface ParseOptions {
  /** Try patterns in order; the first that consumes the most wins. */
  greedy?: boolean;
  /** Match without anchoring so leading noise is tolerated. */
  loose?: boolean;
}

export interface ParseResult {
  values: Partial<Record<Token, string>>;
  /** Fraction of the filename the pattern consumed, 0..1. */
  coverage: number;
  /** Text that no token claimed. */
  leftover: string;
  error?: string;
}

const DEFAULT_PATTERN = "%track% - %artist% - %title%";

export function parseFilename(
  filename: string,
  template: string,
  options: ParseOptions = {},
): ParseResult {
  const stem = stripExtension(filename);
  const plan = scanTemplate(template);
  const { regex, names } = compileTemplate(plan);

  const anchored = options.loose ? "" : "^";
  const suffix = options.loose ? "" : "$";
  let match: RegExpExecArray | null = null;
  try {
    match = new RegExp(`${anchored}${regex}${suffix}`, "iu").exec(stem);
  } catch {
    return { values: {}, coverage: 0, leftover: stem, error: "Template is not a valid pattern" };
  }

  if (!match) {
    if (options.greedy) return tryAlternatives(stem, plan);
    return {
      values: {},
      coverage: 0,
      leftover: stem,
      error: `Filename does not match “${template}”`,
    };
  }

  const values: Partial<Record<Token, string>> = {};
  let consumed = 0;
  names.forEach((name, i) => {
    const value = (match?.[i + 1] ?? "").trim();
    if (value) {
      values[name.toLowerCase() as Token] = value;
      consumed += value.length;
    }
  });

  return { values, coverage: stem.length ? consumed / stem.length : 0, leftover: "" };
}

function compileTemplate(plan: TemplatePlan): { regex: string; names: string[] } {
  const names: string[] = [];
  let regex = "";
  for (const piece of plan) {
    if (piece.kind === "literal") {
      regex += escapeRegExp(piece.value);
    } else {
      names.push(piece.token);
      // Lazy capture: the literal that follows pins the boundary.
      regex += "(.+?)";
    }
  }
  return { regex, names };
}

function tryAlternatives(stem: string, plan: TemplatePlan): ParseResult {
  // Trim leading/trailing tokens and retry; this is what makes common
  // patterns like "%track% - %artist% - %title%" work on "01 - A - B (Remix)".
  for (let trim = 1; trim <= 2; trim++) {
    let start = 0;
    let end = plan.length;
    while (start < end && plan[start].kind === "token") start++;
    while (end > start && plan[end - 1].kind === "token") end--;
    const sliced = plan.slice(start, end);
    if (sliced.length === plan.length) break;
    let re = "";
    const local: string[] = [];
    for (const piece of sliced) {
      if (piece.kind === "literal") re += escapeRegExp(piece.value);
      else {
        local.push(piece.token);
        re += "(.+?)";
      }
    }
    try {
      const m = new RegExp(`^${re}$`, "iu").exec(stem);
      if (m) {
        const values: Partial<Record<Token, string>> = {};
        local.forEach((name, i) => {
          const v = (m[i + 1] ?? "").trim();
          if (v) values[name.toLowerCase() as Token] = v;
        });
        return { values, coverage: 1, leftover: "" };
      }
    } catch {
      break;
    }
  }
  return {
    values: {},
    coverage: 0,
    leftover: stem,
    error: "Filename does not match any attempted pattern",
  };
}

type TemplatePlan = Array<{ kind: "literal"; value: string } | { kind: "token"; token: string }>;

function scanTemplate(template: string): TemplatePlan {
  const plan: TemplatePlan = [];
  let literal = "";
  let i = 0;
  while (i < template.length) {
    if (template[i] === "\\" && i + 1 < template.length) {
      literal += template[i + 1];
      i += 2;
      continue;
    }
    if (template[i] === "%") {
      const end = template.indexOf("%", i + 1);
      if (end === -1) {
        literal += template[i];
        i++;
        continue;
      }
      if (literal) {
        plan.push({ kind: "literal", value: literal });
        literal = "";
      }
      plan.push({ kind: "token", token: template.slice(i + 1, end).toLowerCase() });
      i = end + 1;
      continue;
    }
    literal += template[i];
    i++;
  }
  if (literal) plan.push({ kind: "literal", value: literal });
  return plan;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const RENAME_TEMPLATES: Array<{ label: string; template: string }> = [
  { label: "Artist - Title", template: "%artist% - %title%" },
  { label: "Track - Title", template: "%track% - %title%" },
  { label: "Disc-Track - Title", template: "%disc%-%track% - %title%" },
  { label: "Track. Title", template: "%track%. %title%" },
  { label: "Album / Track - Title", template: "%album%/%track% - %title%" },
  {
    label: "Album artist / Year - Album / Track - Title",
    template: "%albumartist%/%year% - %album%/%disc%-%track% - %title%",
  },
];

export const PARSE_PATTERNS: Array<{ label: string; template: string }> = [
  { label: "Track - Artist - Title", template: DEFAULT_PATTERN },
  { label: "Artist - Title", template: "%artist% - %title%" },
  { label: "Track - Title", template: "%track% - %title%" },
  { label: "Track. Title", template: "%track%. %title%" },
  { label: "Artist - Album - Track - Title", template: "%artist% - %album% - %track% - %title%" },
];

/** Suggest a pattern for a filename, used to bootstrap the parser UI. */
export function guessPattern(filename: string): string | null {
  const stem = stripExtension(filename);
  const leading = /^(\d{1,3})\s*[-._)\]]\s+/.exec(stem);
  if (!leading) return null;
  const rest = stem.slice(leading[0].length);
  const parts = rest.split(/\s+-\s+/);
  if (parts.length === 2) return `%track% - %artist% - %title%`;
  if (parts.length === 1) return `%track% - %title%`;
  return `%track% - %artist% - %album% - %title%`;
}