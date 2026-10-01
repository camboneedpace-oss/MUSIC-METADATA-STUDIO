import { describe, expect, test } from "vitest";
import {
  generateFilename,
  parseFilename,
  sanitizeSegment,
  RENAME_TEMPLATES,
  TOKENS,
} from "./index";
import type { MusicMetadata } from "../metadata/types";

const meta: MusicMetadata = {
  title: "Xtal",
  artist: "Aphex Twin",
  artists: ["Aphex Twin"],
  album: "Selected Ambient Works 85-92",
  albumArtist: "Aphex Twin",
  albumArtists: ["Aphex Twin"],
  trackNumber: 2,
  trackTotal: 13,
  discNumber: 1,
  year: 1992,
  date: "1992-04-20",
  genres: ["Electronic", "Ambient"],
  genre: "Electronic",
};

describe("generateFilename", () => {
  test("expands tokens and pads track numbers", () => {
    const result = generateFilename("%track% - %artist% - %title%", meta);
    expect(result.basename).toBe("02 - Aphex Twin - Xtal");
    expect(result.missing).toEqual([]);
  });

  test("creates folder segments from slashes", () => {
    const result = generateFilename("%artist%/%album%/%track% %title%", meta);
    expect(result.segments).toEqual(["Aphex Twin", "Selected Ambient Works 85-92", "02 Xtal"]);
    expect(result.basename).toBe("02 Xtal");
  });

  test("reports tokens with no value", () => {
    const result = generateFilename("%track% %composer% %title%", { title: "Solo" });
    expect(result.missing).toEqual(["track", "composer"]);
    expect(result.basename).not.toContain("undefined");
  });

  test("honours letter case", () => {
    expect(generateFilename("%artist%", meta, "", { caseStyle: "upper" }).basename).toBe("APHEX TWIN");
    expect(generateFilename("%artist%", meta, "", { caseStyle: "lower" }).basename).toBe("aphex twin");
    expect(generateFilename("%artist%", meta, "", { caseStyle: "title" }).basename).toBe("Aphex Twin");
  });

  test("respects track padding width", () => {
    expect(generateFilename("%track%", meta, "", { trackPadding: 3 }).basename).toBe("002");
  });

  test("joins multi-value fields with a separator", () => {
    expect(generateFilename("%genre%", meta, "", { sanitize: false }).basename).toBe("Electronic / Ambient");
  });

  test("sanitising stops a tag value from creating a folder", () => {
    expect(generateFilename("%genre%", meta).basename).toBe("Electronic Ambient");
    expect(generateFilename("%genre%", meta).segments).toHaveLength(1);
  });

  test("compilation token is empty when the flag is off", () => {
    expect(generateFilename("%compilation%%title%", meta).basename).toBe("Xtal");
    expect(generateFilename("%compilation% %title%", { ...meta, compilation: true }).basename).toBe("Compilation Xtal");
  });

  test("escapes a literal percent with a backslash", () => {
    const result = generateFilename("100\\% %title%", meta);
    expect(result.basename).toBe("100% Xtal");
  });

  test("every shipped template resolves without throwing", () => {
    for (const preset of RENAME_TEMPLATES) {
      const result = generateFilename(preset.template, meta);
      expect(result.basename.length).toBeGreaterThan(0);
      expect(result.basename).not.toContain("%");
    }
  });

  test("every documented token is recognised by the tokenizer", () => {
    for (const token of TOKENS) {
      const result = generateFilename(`%${token}%`, meta, "original name.mp3");
      expect(result.basename).not.toContain(`%${token}%`);
    }
  });
});

describe("sanitizeSegment", () => {
  test("replaces characters that are illegal on common filesystems", () => {
    expect(sanitizeSegment('AC/DC: Back?')).toBe("AC DC Back");
  });

  test("collapses whitespace and trims trailing dots", () => {
    expect(sanitizeSegment("  a   b . . ")).toBe("a b");
  });

  test("falls back when nothing survives", () => {
    expect(sanitizeSegment("///")).toBe("Unknown");
    expect(sanitizeSegment("", "Untitled")).toBe("Untitled");
  });
});

describe("parseFilename", () => {
  test("reads a numbered artist-title pattern back into tags", () => {
    const parsed = parseFilename("02 - Aphex Twin - Xtal.mp3", "%track% - %artist% - %title%");
    expect(parsed.values).toMatchObject({ track: "02", artist: "Aphex Twin", title: "Xtal" });
    // Coverage counts the characters tokens claimed; literal separators in the
    // template are not attributed to anything.
    expect(parsed.coverage).toBeGreaterThan(0.7);
    expect(parsed.error).toBeUndefined();
  });

  test("reports what the pattern failed to consume", () => {
    const parsed = parseFilename("Aphex Twin - Xtal.mp3", "%track% - %artist% - %title%");
    expect(parsed.error).toBeTruthy();
    expect(parsed.coverage).toBe(0);
  });

  test("an unparsable filename returns the whole stem as leftover", () => {
    const parsed = parseFilename("Xtal [remaster].mp3", "%artist% - %title%");
    expect(parsed.values).toEqual({});
    expect(parsed.coverage).toBe(0);
    expect(parsed.leftover).toBe("Xtal [remaster]");
    expect(parsed.error).toBeTruthy();
  });

  test("round-trips a generated filename back into tags", () => {
    const template = "%artist% - %title%";
    const generated = generateFilename(template, meta);
    const parsed = parseFilename(`${generated.basename}.mp3`, template);
    expect(parsed.values.artist).toBe("Aphex Twin");
    expect(parsed.values.title).toBe("Xtal");
  });

  test("does not invent a track number that is not there", () => {
    const parsed = parseFilename("Xtal.mp3", "%track% %title%");
    expect(parsed.values.track).toBeUndefined();
  });
});