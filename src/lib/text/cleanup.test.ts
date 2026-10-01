import { describe, expect, test } from "vitest";
import {
  applyCleanupOps,
  applyTextOp,
  CLEANUP_OPS,
  normalizeDate,
  normalizeGenreName,
  smartTitleCase,
  TEXT_FIELDS,
  type CleanupOp,
} from "./cleanup";
import { applyReplace, previewReplace, type ReplaceRule } from "./find-replace";
import type { MusicMetadata } from "../metadata/types";

/** A shipped op with an explicit field list, so tests never drift by accident. */
const op = (id: string, fields: string[] = [], options: Record<string, string | number | boolean> = {}) =>
  ({
    ...(CLEANUP_OPS.find((o) => o.id === id) ?? CLEANUP_OPS[0]),
    id,
    fields,
    options,
    enabled: true,
  }) as CleanupOp;

describe("applyTextOp", () => {
  test("trim removes the edges, collapseSpaces squeezes runs", () => {
    expect(applyTextOp("  a   b  ", op("trim"))).toBe("a   b");
    expect(applyTextOp("  a   b  ", op("collapseSpaces"))).toBe(" a b ");
  });

  test("normalises to NFC and drops invisible characters", () => {
    expect(applyTextOp("a\u200bb\u200ec", op("normalizeUnicode"))).toBe("abc");
    expect(applyTextOp("cafe\u0301", op("normalizeUnicode"))).toBe("caf\u00e9");
  });

  test("converts curly quotes and dashes", () => {
    expect(applyTextOp("\u201cquoted\u201d \u2018x\u2019", op("convertQuotes"))).toBe('"quoted" \'x\'');
    expect(applyTextOp("a\u2013b\u2026", op("normalizePunctuation"))).toBe("a-b...");
  });

  test("decodes the HTML entities taggers sometimes write", () => {
    expect(applyTextOp("a &amp; b &mdash; caf&#233;", op("stripHtmlEntities"))).toBe(
      "a & b \u2014 caf\u00e9",
    );
  });

  test("title case leaves intentionally mixed-case words alone", () => {
    expect(applyTextOp("the iPhone song", op("titleCase"))).toBe("The iPhone Song");
    expect(smartTitleCase("a tale of two cities")).toBe("A Tale of Two Cities");
    expect(smartTitleCase("NAME")).toBe("Name");
  });

  test("removePrefixes only strips configured prefixes", () => {
    expect(applyTextOp("01 - Song", op("removePrefixes"))).toBe("01 - Song");
    expect(applyTextOp("01 - Song", op("removePrefixes", [], { prefixes: "01,02" }))).toBe("Song");
  });

  test("rewrites featuring credits into one style", () => {
    expect(applyTextOp("A (feat. B)", op("normalizeFeaturing"))).toBe("A (feat. B)");
    expect(applyTextOp("A ft B", op("normalizeFeaturing", [], { style: "feat." }))).toBe("A feat. B");
    expect(applyTextOp("A featuring B", op("normalizeFeaturing", [], { style: "feat." }))).toBe("A feat. B");
  });

  test("blank-ish values are emptied by removeEmptyTags", () => {
    expect(applyTextOp("   ", op("removeEmptyTags"))).toBe("");
    expect(applyTextOp("A", op("removeEmptyTags"))).toBe("A");
  });
});

describe("date and genre normalisation", () => {
  test("normalises the usual ISO-ish shapes", () => {
    expect(normalizeDate("1992/04/20", "year")).toBe("1992");
    expect(normalizeDate("1992-04-20", "year-month")).toBe("1992-04");
    expect(normalizeDate("1992-04-20", "full")).toBe("1992-04-20");
    expect(normalizeDate("1992-04-20", "auto")).toBe("1992-04-20");
  });

  test("pulls the year out of noisy text", () => {
    expect(normalizeDate("1998 (Remastered)", "auto")).toBe("1998");
  });

  test("leaves anything it cannot read alone rather than guessing", () => {
    expect(normalizeDate("not a date", "auto")).toBe("not a date");
    expect(normalizeDate("", "auto")).toBe("");
  });

  test("folds genre spelling variants onto one name", () => {
    expect(normalizeGenreName("r&b")).toBe(normalizeGenreName("R&B"));
    expect(normalizeGenreName("  Hip-Hop  ")).toBe("Hip-Hop");
  });
});

describe("applyCleanupOps", () => {
  const metadata: MusicMetadata = {
    title: "  xtal  ",
    artist: "Aphex Twin",
    artists: ["Aphex Twin"],
    album: "Selected Ambient Works",
    genres: ["Electronic"],
    year: 1992,
    trackNumber: 2,
  };

  test("reports a before/after pair for each change", () => {
    const { metadata: next, changes } = applyCleanupOps(metadata, [op("trim", ["title"])]);
    expect(next.title).toBe("xtal");
    expect(changes).toEqual([{ field: "title", before: "  xtal  ", after: "xtal" }]);
  });

  test("does not touch fields the ops do not list", () => {
    const { metadata: next, changes } = applyCleanupOps(metadata, [op("trim", ["comment"])]);
    expect(next.title).toBe("  xtal  ");
    expect(changes).toEqual([]);
  });

  test("leaves the input object alone", () => {
    applyCleanupOps(metadata, [op("trim", ["title"])]);
    expect(metadata.title).toBe("  xtal  ");
  });

  test("disabled ops are skipped", () => {
    const disabled = { ...op("trim", ["title"]), enabled: false };
    const { changes } = applyCleanupOps(metadata, [disabled]);
    expect(changes).toEqual([]);
  });

  test("every shipped op is documented", () => {
    for (const o of CLEANUP_OPS) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.description.length).toBeGreaterThan(0);
      expect(Array.isArray(o.fields)).toBe(true);
    }
    expect(TEXT_FIELDS.length).toBeGreaterThan(5);
  });
});

describe("applyReplace", () => {
  const value = (result: ReturnType<typeof applyReplace>) =>
    "value" in result ? result.value : (() => { throw new Error(result.error); })();

  test("replaces every occurrence", () => {
    expect(value(applyReplace("ab ab", "ab", "cd"))).toBe("cd cd");
  });

  test("`once` stops after the first hit", () => {
    expect(value(applyReplace("ab ab", "ab", "cd", { once: true }))).toBe("cd ab");
  });

  test("honours whole-field matching", () => {
    expect(value(applyReplace("Live", "live", "Studio", { wholeField: true }))).toBe("Studio");
    expect(value(applyReplace("Live at Home", "live", "Studio", { wholeField: true }))).toBe(
      "Live at Home",
    );
  });

  test("is case-insensitive unless asked otherwise", () => {
    expect(value(applyReplace("Live", "live", "x"))).toBe("x");
    expect(value(applyReplace("Live", "live", "x", { caseSensitive: true }))).toBe("Live");
  });

  test("supports capture groups in regex mode", () => {
    expect(value(applyReplace("Disc 1", "Disc (\\d+)", "CD $1", { regex: true }))).toBe("CD 1");
  });

  test("treats the pattern literally when regex is off", () => {
    expect(value(applyReplace("a.b", "a.b", "X"))).toBe("X");
    expect(value(applyReplace("axb", "a.b", "X"))).toBe("axb");
  });

  test("reports an invalid pattern instead of throwing", () => {
    const result = applyReplace("x", "(unclosed", "y", { regex: true });
    expect("error" in result).toBe(true);
  });

  test("an empty pattern is a no-op", () => {
    expect(value(applyReplace("x", "", "y"))).toBe("x");
  });
});

describe("previewReplace", () => {
  const rule: ReplaceRule = {
    id: "r1",
    find: "Live",
    replace: "Studio",
    scopes: ["title", "artists"],
    options: {},
    enabled: true,
  };

  test("returns per-field before/after without mutating", () => {
    const metadata: MusicMetadata = { title: "Live at Home", artists: ["Live"], album: "Live" };
    const preview = previewReplace(metadata, "Live.mp3", rule);
    expect(preview.error).toBeUndefined();
    expect(preview.changes.map((c) => c.field).sort()).toEqual(["artists", "title"]);
    expect(preview.metadata.album).toBe("Live");
    expect(metadata.title).toBe("Live at Home");
  });

  test("can rewrite the filename as well as the tags", () => {
    const preview = previewReplace({ title: "x" }, "Live.mp3", { ...rule, scopes: ["filename"] });
    expect(preview.filename).toBe("Studio.mp3");
  });
});