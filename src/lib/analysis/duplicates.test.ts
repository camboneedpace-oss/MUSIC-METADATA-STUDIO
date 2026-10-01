import { describe, expect, test } from "vitest";
import { bestMember, findDuplicates, tagSignature } from "./duplicates";
import {
  buildPlaylist,
  DEFAULT_PLAYLIST_OPTIONS,
  evaluateSmartPlaylist,
  matchesSmartRule,
  trackPath,
  type SmartPlaylist,
} from "../playlists";
import { BUILTIN_TEMPLATES, DEFAULT_EXPORT_OPTIONS, renderTemplate, runExport, toCsv } from "../exports";
import type { LibraryFile } from "../library/types";

let counter = 0;
/** A stable fixture: only `name`/`id` vary, so tag signatures are comparable. */
function file(overrides: Partial<LibraryFile> & { metadata?: LibraryFile["metadata"] } = {}): LibraryFile {
  counter += 1;
  return {
    id: `f${counter}`,
    name: `track${counter}.flac`,
    folder: "Artist/Album",
    size: 20_000_000,
    modifiedAt: 1_700_000_000_000,
    file: new File([], "x"),
    writable: true,
    format: "flac",
    metadata: {
      title: "Untitled",
      artist: "Artist",
      artists: ["Artist"],
      album: "Album",
      albumArtists: ["Artist"],
      genres: ["Ambient"],
      year: 1992,
      trackNumber: 1,
      trackTotal: 3,
      isrc: "GBAYE0601498",
      barcode: "731456011622",
      catalogNumber: "DED-001",
      artwork: [],
      ...overrides.metadata,
    },
    onDisk: {},
    audio: {
      duration: 300,
      bitrate: 940,
      sampleRate: 44100,
      channels: 2,
      bitDepth: 16,
      lossless: true,
      ...(overrides.audio ?? {}),
    },
    raw: [],
    warnings: [],
    tagScheme: "Vorbis Comment",
    tagStatus: "clean",
    dirty: false,
    addedAt: 1_700_000_000_000,
    ...overrides,
  } as LibraryFile;
}

describe("tagSignature", () => {
  test("ignores fields that do not identify a track", () => {
    const a = file({ name: "a.flac" });
    const b = file({ name: "b.flac" });
    expect(tagSignature(a)).toBe(tagSignature(b));
  });

  test("changes when a tag that identifies the track changes", () => {
    const a = file();
    const b = file({ metadata: { title: "Different" } });
    expect(tagSignature(a)).not.toBe(tagSignature(b));
  });
});

describe("findDuplicates", () => {
  test("groups files that share an exact content hash", () => {
    const hash = "a".repeat(64);
    const group = findDuplicates([file({ contentHash: hash }), file({ contentHash: hash })], {
      kinds: ["exact"],
    });
    expect(group).toHaveLength(1);
    expect(group[0].kind).toBe("exact");
    expect(group[0].members).toHaveLength(2);
  });

  test("groups files whose tags say they are the same recording", () => {
    const shared = { title: "Xtal", artist: "Aphex Twin", artists: ["Aphex Twin"] };
    const group = findDuplicates(
      [
        file({ name: "x.flac", metadata: shared, audio: { duration: 331, bitrate: 940, sampleRate: 44100, lossless: true } }),
        file({ name: "y.flac", metadata: shared, audio: { duration: 331, bitrate: 1411, sampleRate: 44100, lossless: false } }),
      ],
      { kinds: ["metadata"] },
    );
    expect(group).toHaveLength(1);
    expect(group[0].members).toHaveLength(2);
  });

  test("returns nothing for a library of distinct tracks", () => {
    const files = [file(), file(), file()];
    expect(findDuplicates(files, { kinds: ["exact", "fingerprint"] })).toHaveLength(0);
  });
});

describe("bestMember", () => {
  test("prefers lossless, then the larger file", () => {
    const lossy = file({ size: 5_000_000, audio: { bitrate: 320, lossless: false } });
    const losslessSmall = file({ size: 8_000_000, audio: { bitrate: 700, lossless: true } });
    const losslessBig = file({ size: 20_000_000, audio: { bitrate: 900, lossless: true } });
    expect(bestMember([lossy, losslessSmall]).size).toBe(8_000_000);
    expect(bestMember([lossy, losslessSmall, losslessBig]).size).toBe(20_000_000);
  });
});

describe("playlists", () => {
  const files = [file({ name: "one.flac" }), file({ name: "two.flac" })];

  test("builds an extended M3U with EXTINF durations", () => {
    const text = buildPlaylist(files, { ...DEFAULT_PLAYLIST_OPTIONS, format: "m3u" });
    expect(text).toContain("#EXTM3U");
    expect(text.split("#EXTINF:")[1]).toMatch(/^\d+,/);
    expect(text).toContain("one.flac");
    expect(text.trim().split("\n").at(-1)).toContain("two.flac");
  });

  test("plain M3U omits the header comments", () => {
    const text = buildPlaylist(files, { ...DEFAULT_PLAYLIST_OPTIONS, format: "m3u", extended: false });
    expect(text).not.toContain("#EXTM3U");
    expect(text).not.toContain("#EXTINF");
  });

  test("PLS pairs FileN with TitleN", () => {
    const text = buildPlaylist(files, { ...DEFAULT_PLAYLIST_OPTIONS, format: "pls" });
    expect(text).toMatch(/NumberOfEntries=2/);
    const file1 = /File1=(.+)/.exec(text)?.[1];
    const title1 = /Title1=(.+)/.exec(text)?.[1];
    expect(title1).toBeTruthy();
    expect(file1).toContain("one.flac");
  });

  test("XSPF is well-formed XML with the right namespace", () => {
    const text = buildPlaylist(files, { ...DEFAULT_PLAYLIST_OPTIONS, format: "xspf" });
    expect(text).toContain('<?xml version="1.0"');
    expect(text).toContain("http://xspf.org/ns/0/");
    expect(text.trimEnd().endsWith("</playlist>")).toBe(true);
  });

  test("relative paths are portable, absolute paths are not", () => {
    const relative = trackPath(files[0], {
      ...DEFAULT_PLAYLIST_OPTIONS,
      paths: "relative",
      basePath: "/music",
    });
    const absolute = trackPath(files[0], { ...DEFAULT_PLAYLIST_OPTIONS, paths: "absolute" });
    expect(relative).toBe("/music/one.flac");
    expect(absolute.startsWith("/")).toBe(true);
  });
});

describe("smart playlists", () => {
  const rules: SmartPlaylist = {
    id: "sp",
    name: "Lossless ambient",
    mode: "all",
    rules: [
      { field: "genre", op: "=", value: "Ambient" },
      { field: "year", op: ">=", value: 1990 },
    ],
    format: "m3u8",
    paths: "relative",
  };

  test("evaluates every rule when the mode is all", () => {
    expect(evaluateSmartPlaylist([file()], rules)).toHaveLength(1);
    expect(evaluateSmartPlaylist([file({ metadata: { year: 1989 } })], rules)).toHaveLength(0);
    expect(evaluateSmartPlaylist([file({ metadata: { genres: ["Rock"] } })], rules)).toHaveLength(0);
  });

  test("switches to any-of semantics when asked", () => {
    const loose = { ...rules, mode: "any" as const };
    // The genre rule fails, the year rule passes: all → 0, any → 1.
    const rock = file({ metadata: { genres: ["Rock"], year: 1995 } });
    expect(evaluateSmartPlaylist([rock], rules)).toHaveLength(0);
    expect(evaluateSmartPlaylist([rock], loose)).toHaveLength(1);
  });

  test("an unknown field never matches", () => {
    expect(matchesSmartRule(file(), { field: "nonsense", op: "=", value: "x" })).toBe(false);
  });
});

describe("exports", () => {
  const files = [file({ name: "one.flac" }), file({ name: "two.flac" })];

  test("CSV has a header and one row per file", () => {
    const csv = toCsv(files, DEFAULT_EXPORT_OPTIONS);
    const rows = csv.trim().split("\r\n");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Title");
    expect(rows[1]).toContain(files[0].metadata.title);
  });

  test("CSV quotes cells that contain the delimiter", () => {
    const csv = toCsv([file({ metadata: { title: "A, B" } })], DEFAULT_EXPORT_OPTIONS);
    expect(csv).toContain('"A, B"');
  });

  test("every built-in template renders without throwing", () => {
    const exportedAt = new Date("2020-01-02T03:04:05Z");
    for (const template of BUILTIN_TEMPLATES) {
      const output = runExport(files, template, DEFAULT_EXPORT_OPTIONS, exportedAt);
      expect(typeof output).toBe("string");
      expect(output.length).toBeGreaterThan(0);
    }
  });

  test("the record block repeats for every file", () => {
    const text = renderTemplate(
      "{{#tracks}}{{title}}|{{/tracks}}",
      files,
      { delimiter: ",", exportedAt: new Date(0) },
    );
    expect(text).toBe(`${files[0].metadata.title}|${files[1].metadata.title}|`);
  });

  test("plain placeholders resolve inside the record block", () => {
    const text = renderTemplate("{{#tracks}}{{artist}}|{{/tracks}}", files, {
      delimiter: ",",
      exportedAt: new Date(0),
    });
    expect(text).toBe("Artist|Artist|");
  });
});