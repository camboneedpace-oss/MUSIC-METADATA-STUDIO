/**
 * Find & replace engine.
 *
 * Deliberately separate from the cleanup ops: replacement is driven by the
 * user, may be regular expressions, and must be previewable before anything
 * is written.
 */

import type { MusicMetadata } from "../metadata/types";

export type ReplaceScope =
  | "filename"
  | "title"
  | "artists"
  | "album"
  | "albumArtists"
  | "genres"
  | "comment"
  | "customFields"
  | "allText";

export interface ReplaceOptions {
  caseSensitive?: boolean;
  wholeField?: boolean;
  regex?: boolean;
  unicode?: boolean;
  /** Replace only the first hit instead of every hit. */
  once?: boolean;
  /** Treat the pattern literally even when regex is off. */
  literal?: boolean;
}

export interface ReplaceRule {
  id: string;
  find: string;
  replace: string;
  scopes: ReplaceScope[];
  options: ReplaceOptions;
  enabled: boolean;
}

export interface ReplaceHit {
  field: string;
  index: number;
  before: string;
  after: string;
  match: string;
}

export const SCOPE_LABELS: Record<ReplaceScope, string> = {
  filename: "Filename",
  title: "Title",
  artists: "Artist",
  album: "Album",
  albumArtists: "Album Artist",
  genres: "Genre",
  comment: "Comment",
  customFields: "Custom fields",
  allText: "All text tags",
};

const ALL_TEXT_FIELDS: ReplaceScope[] = [
  "title", "artists", "album", "albumArtists", "genres", "comment", "customFields",
];

function buildRegex(find: string, options: ReplaceOptions): RegExp | null {
  if (!find) return null;
  const source = options.regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = `${options.caseSensitive ? "" : "i"}${options.unicode ? "u" : ""}${options.once ? "" : "g"}`;
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

export function applyReplace(
  value: string,
  find: string,
  replace: string,
  options: ReplaceOptions = {},
): { value: string; hits: ReplaceHit[] } | { error: string } {
  if (!find) return { value, hits: [] };
  if (options.wholeField) {
    // Compose the anchors here; buildRegex would escape them a second time.
    const re = buildRegex(find, { ...options, once: true });
    if (!re) return { error: "Invalid pattern" };
    const anchored = new RegExp(`^(?:${re.source})$`, re.flags);
    if (!anchored.test(value)) return { value, hits: [] };
    return {
      value: replace,
      hits: [{ field: "", index: 0, before: value, after: replace, match: value }],
    };
  }
  const re = buildRegex(find, options);
  if (!re) return { error: "Invalid regular expression" };
  const hits: ReplaceHit[] = [];
  const next = value.replace(re, (...args) => {
    const matched = String(args[0]);
    // Support `$1` back-references in the replacement when regex mode is on.
    const resolved = options.regex
      ? replace.replace(/\$(\d+)/g, (_, d: string) => String(args[Number(d)] ?? ""))
      : replace;
    hits.push({ field: "", index: 0, before: value, after: "", match: matched });
    return resolved;
  });
  return { value: next, hits: hits.map((h) => ({ ...h, after: next })) };
}

export interface ReplacePreview {
  metadata: MusicMetadata;
  filename?: string;
  changes: Array<{ field: string; before: string; after: string }>;
  hits: number;
  error?: string;
}

export function previewReplace(
  metadata: MusicMetadata,
  filename: string,
  rule: ReplaceRule,
): ReplacePreview {
  const changes: Array<{ field: string; before: string; after: string }> = [];
  let hits = 0;
  const next: MusicMetadata = { ...metadata };
  const scopes: ReplaceScope[] =
    rule.scopes.length === 0 ? ALL_TEXT_FIELDS : rule.scopes;
  const want = (scope: ReplaceScope) => scopes.includes(scope) || scopes.includes("allText");

  const handleString = (field: string, value: string): string | undefined => {
    const r = applyReplace(value, rule.find, rule.replace, rule.options);
    if ("error" in r) throw new Error(r.error);
    if (r.value === value) return undefined;
    hits += r.hits.length;
    changes.push({ field, before: value, after: r.value });
    return r.value;
  };

  const handleArray = (values: string[], label: string): string[] | undefined => {
    let changed = false;
    const out: string[] = [];
    for (const v of values) {
      const r = applyReplace(v, rule.find, rule.replace, rule.options);
      if ("error" in r) throw new Error(r.error);
      hits += r.hits.length;
      if (r.value !== v) {
        changed = true;
        changes.push({ field: label, before: v, after: r.value });
      }
      out.push(r.value);
    }
    return changed ? out : undefined;
  };

  try {
    if (want("title") && next.title) {
      const v = handleString("title", next.title);
      if (v !== undefined) next.title = v;
    }
    if (want("artists") && next.artists) {
      const v = handleArray(next.artists, "artists");
      if (v) next.artists = v;
    }
    if (want("album") && next.album) {
      const v = handleString("album", next.album);
      if (v !== undefined) next.album = v;
    }
    if (want("albumArtists") && next.albumArtists) {
      const v = handleArray(next.albumArtists, "albumArtists");
      if (v) next.albumArtists = v;
    }
    if (want("genres") && next.genres) {
      const v = handleArray(next.genres, "genres");
      if (v) next.genres = v;
    }
    if (want("comment") && next.comment) {
      const v = handleString("comment", next.comment);
      if (v !== undefined) next.comment = v;
    }
    if (want("customFields") && next.customFields) {
      const custom: Record<string, string> = {};
      let changed = false;
      for (const [k, v] of Object.entries(next.customFields)) {
        const r = handleString(`customFields.${k}`, v);
        custom[k] = r ?? v;
        if (r !== undefined) changed = true;
      }
      if (changed) next.customFields = custom;
    }

    let outName: string | undefined;
    if (want("filename")) {
      const r = handleString("filename", filename);
      if (r !== undefined) outName = r;
    }

    return { metadata: next, filename: outName, changes, hits };
  } catch (err) {
    return {
      metadata,
      changes,
      hits,
      error: (err as Error).message,
    };
  }
}