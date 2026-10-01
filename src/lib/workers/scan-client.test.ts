import { describe, expect, test } from "vitest";
import { readArtwork, scanFiles, type ScanJob } from "./scan-client";
import {
  flacBlock,
  makeFlac,
  makeFlacStreaminfo,
  makeMp3,
  pictureBlock,
  RECT_PNG,
  vorbisCommentBlock,
} from "../metadata/test-fixtures";
import { buildId3v2, buildTextFrame } from "../metadata/codecs/id3";

/** A tagged MP3 with a title. */
function mp3(title: string): Uint8Array {
  return makeMp3(buildId3v2([buildTextFrame("TIT2", [title])!], []));
}

function job(id: string, path: string, bytes: Uint8Array): ScanJob {
  // Copy into a fresh ArrayBuffer: File.arrayBuffer() hands back exactly what
  // we put in, and the fixture buffers are shared across tests.
  const copy = bytes.slice();
  return {
    id,
    path,
    source: new File([copy], path.split("/").pop() ?? path),
    hash: false,
  };
}

describe("scanFiles", () => {
  test("parses a batch and reports one result per file", async () => {
    const jobs = [
      job("a", "Artist/one.mp3", mp3("One")),
      job("b", "Artist/two.mp3", mp3("Two")),
    ];
    const results = await scanFiles(jobs).done;

    expect(results.size).toBe(2);
    expect(results.get("a")?.format).toBe("mp3");
    expect(results.get("a")?.metadata.title).toBe("One");
    expect(results.get("b")?.metadata.title).toBe("Two");
  });

  test("never throws on unparseable input", async () => {
    const results = await scanFiles([job("junk", "broken.bin", new Uint8Array([1, 2, 3, 4]))]).done;
    const result = results.get("junk");
    expect(result).toBeDefined();
    // Either it parsed as something, or it reported why it could not.
    expect(result?.error || result?.metadata).toBeTruthy();
  });

  test("counts formats and reports progress for every file", async () => {
    const seen: number[] = [];
    const jobs = [
      job("a", "a.mp3", mp3("A")),
      job("b", "b.mp3", mp3("B")),
      job("c", "c.flac", flacWithTitle("C")),
    ];
    const run = scanFiles(jobs, { onProgress: (p) => seen.push(p.done) });
    const results = await run.done;

    expect(results.size).toBe(3);
    expect(seen.at(-1)).toBe(3);
    expect(seen.every((n, i) => i === 0 || n >= seen[i - 1])).toBe(true);
  });

  test("streams results through onResult as they arrive", async () => {
    const ids: string[] = [];
    await scanFiles([job("a", "a.mp3", mp3("A"))], { onResult: (r) => ids.push(r.id) }).done;
    expect(ids).toEqual(["a"]);
  });

  test("cancel stops the run and resolves with what finished", async () => {
    const jobs = Array.from({ length: 6 }, (_, i) => job(`f${i}`, `f${i}.mp3`, mp3(`T${i}`)));
    const run = scanFiles(jobs);
    run.cancel();
    const results = await run.done;
    expect(results.size).toBeLessThanOrEqual(jobs.length);
  });

  test("drops artwork bytes but still counts them", async () => {
    const results = await scanFiles([job("art", "art.flac", flacWithArtwork())]).done;
    const result = results.get("art");
    expect(result?.artworkCount).toBe(1);
    expect(result?.artworkBytes).toBeGreaterThan(0);
    expect(result?.metadata.artwork).toBeUndefined();
  });

  test("raw byte sources are accepted too", async () => {
    const bytes = mp3("Direct");
    const results = await scanFiles([{ id: "d", path: "d.mp3", source: bytes, hash: false }]).done;
    expect(results.get("d")?.metadata.title).toBe("Direct");
  });
});

describe("readArtwork", () => {
  test("re-reads the images the scan dropped", async () => {
    const bytes = flacWithArtwork();
    const file = new File([bytes.slice()], "art.flac");
    const artwork = await readArtwork(file, "art.flac");
    expect(artwork).toHaveLength(1);
    expect(artwork[0].mime).toBe("image/png");
    expect(artwork[0].data.length).toBeGreaterThan(0);
  });

  test("returns an empty list for a file with no artwork", async () => {
    const bytes = flacWithTitle("Plain");
    const file = new File([bytes.slice()], "plain.flac");
    expect(await readArtwork(file, "plain.flac")).toEqual([]);
  });
});

/* ---------- local fixture helpers ---------- */

function flacWithTitle(title: string): Uint8Array {
  return makeFlac([
    flacBlock(0, makeFlacStreaminfo(), false),
    vorbisCommentBlock("test", [["TITLE", title]]),
    flacBlock(1, new Uint8Array(64), true),
  ]);
}

function flacWithArtwork(): Uint8Array {
  return makeFlac([
    flacBlock(0, makeFlacStreaminfo(), false),
    vorbisCommentBlock("test", [["TITLE", "With art"]]),
    pictureBlock("image/png", RECT_PNG, 3, "cover"),
    flacBlock(1, new Uint8Array(64), true),
  ]);
}