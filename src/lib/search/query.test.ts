import { describe, expect, test } from "vitest";
import { matchesClause, matchesText, parseQuery } from "./query";
import type { FileRecord } from "../library/types";

function record(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: "f1",
    name: "01 - Aphex Twin - Xtal.mp3",
    folder: "Aphex Twin/Selected Ambient Works",
    size: 8_000_000,
    modifiedAt: 1_700_000_000_000,
    file: new File([], "x"),
    writable: true,
    format: "mp3",
    metadata: {
      title: "Xtal",
      artist: "Aphex Twin",
      artists: ["Aphex Twin"],
      album: "Selected Ambient Works 85-92",
      albumArtist: "Aphex Twin",
      genres: ["Electronic", "Ambient"],
      year: 1992,
      trackNumber: 2,
      trackTotal: 13,
      isrc: "GBAYE0601498",
      artwork: [],
    },
    onDisk: {},
    audio: { duration: 331, bitrate: 320, sampleRate: 44100, channels: 2, bitDepth: 16, lossless: false },
    raw: [],
    warnings: [],
    tagScheme: "ID3v2.4",
    tagStatus: "clean",
    dirty: false,
    addedAt: Date.now(),
    ...overrides,
  } as FileRecord;
}

describe("parseQuery", () => {
  test("splits free text from field clauses", () => {
    const parsed = parseQuery('xtal artist:"Aphex Twin"');
    expect(parsed.text).toEqual(["xtal"]);
    expect(parsed.clauses).toHaveLength(1);
    expect(parsed.clauses[0]).toMatchObject({ field: "artist", op: "~", value: "Aphex Twin" });
  });

  test("reads comparison operators", () => {
    const parsed = parseQuery("year:>=2000 bitrate:>320 samplerate:<48000");
    expect(parsed.clauses.map((c) => c.op)).toEqual([">=", ">", "<"]);
    expect(parsed.clauses.map((c) => c.value)).toEqual([2000, 320, 48000]);
  });

  test("coerces booleans for hasartwork and lossless", () => {
    expect(parseQuery("hasartwork:false").clauses[0].value).toBe(false);
    expect(parseQuery("lossless:true").clauses[0].value).toBe(true);
    expect(parseQuery("lossless:no").clauses[0].value).toBe(false);
  });

  test("negation flips the operator", () => {
    expect(parseQuery('-comment:"live"').clauses[0].op).toBe("!=");
    expect(parseQuery('-year:>2000').clauses[0].op).toBe("<=");
  });

  test("ignores unknown field prefixes and keeps them as text", () => {
    const parsed = parseQuery("bogus:value");
    expect(parsed.clauses).toHaveLength(0);
    expect(parsed.text).toEqual(["bogus:value"]);
  });
});

describe("matching", () => {
  test("free text hits multiple fields", () => {
    expect(matchesText(record(), ["xtal"])).toBe(true);
    expect(matchesText(record(), ["ambient"])).toBe(true);
    expect(matchesText(record(), ["selected"])).toBe(true);
    expect(matchesText(record(), ["nonesuch"])).toBe(false);
  });

  test("requires every free-text term", () => {
    expect(matchesText(record(), ["xtal", "aphex"])).toBe(true);
    expect(matchesText(record(), ["xtal", "portishead"])).toBe(false);
  });

  test("field clauses match multi-value fields", () => {
    expect(matchesClause(record(), { field: "artist", op: "=", value: "Aphex Twin" })).toBe(true);
    expect(matchesClause(record(), { field: "genre", op: "~", value: "ambient" })).toBe(true);
    expect(matchesClause(record(), { field: "artist", op: "=", value: "Boards of Canada" })).toBe(false);
  });

  test("numeric comparisons", () => {
    expect(matchesClause(record(), { field: "year", op: "<", value: 2000 })).toBe(true);
    expect(matchesClause(record(), { field: "year", op: ">=", value: 2000 })).toBe(false);
    expect(matchesClause(record(), { field: "bitrate", op: ">=", value: 320 })).toBe(true);
  });

  test("an absent field only satisfies a negated clause", () => {
    const sparse = record({ metadata: { title: "Only A Title" } });
    expect(matchesClause(sparse, { field: "composer", op: "!=", value: "anyone" })).toBe(true);
    expect(matchesClause(sparse, { field: "composer", op: "~", value: "anyone" })).toBe(false);
  });

  test("hasartwork and lossless are boolean predicates", () => {
    expect(matchesClause(record(), { field: "hasartwork", op: "=", value: false })).toBe(true);
    expect(matchesClause(record(), { field: "lossless", op: "=", value: false })).toBe(true);
    expect(matchesClause(record(), { field: "lossless", op: "=", value: true })).toBe(false);
  });

  test("filename and folder search", () => {
    expect(matchesClause(record(), { field: "filename", op: "~", value: "xtal" })).toBe(true);
    expect(matchesClause(record(), { field: "folder", op: "~", value: "selected ambient" })).toBe(true);
  });
});