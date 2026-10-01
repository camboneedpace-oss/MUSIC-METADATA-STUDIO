import { describe, expect, it, afterEach, vi } from "vitest";
import {
  albumGroupKey,
  artworkKey,
  fullArtworkUrl,
  groupByAlbum,
  isArtworkMimeSupported,
  loadThumbnail,
  releaseArtworkCache,
  thumbnailCacheSize,
  transformArtwork,
  dominantColour,
  ARTWORK_ROLES,
  THUMBNAIL_SIZES,
} from "./index";
import type { Artwork } from "../metadata/types";

/* ---------- fixtures ---------- */

/** A PNG-shaped buffer: signature plus enough bytes to look like an image. */
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function art(over: Partial<Artwork> = {}): Artwork {
  return {
    id: "art-1",
    data: PNG,
    mime: "image/png",
    role: "front",
    width: 600,
    height: 600,
    bytes: PNG.length,
    ...over,
  };
}

/** A bitmap stand-in so transforms can be exercised without a real decoder. */
function stubBitmap(width: number, height: number) {
  const created: Array<{ w: number; h: number; sx: number; sy: number; sw: number; sh: number }> = [];
  const blobs: Blob[] = [];
  vi.stubGlobal("createImageBitmap", async () => ({
    width,
    height,
    close: () => {},
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        imageSmoothingQuality: "",
        fillStyle: "",
        drawImage: (_b: unknown, sx: number, sy: number, sw: number, sh: number) => {
          created.push({ w: width, h: height, sx, sy, sw, sh });
        },
        fillRect: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray([10, 20, 30, 255]) }),
      }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb) {
    const blob = new Blob([new Uint8Array(64)], { type: "image/webp" });
    blobs.push(blob);
    cb(blob);
  });
  return { created, blobs };
}

let revoked = 0;
function stubUrls() {
  revoked = 0;
  let n = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(Object.create(URL), {
      createObjectURL: () => `blob:mock-${n++}`,
      revokeObjectURL: () => {
        revoked++;
      },
    }),
  );
}

afterEach(() => {
  releaseArtworkCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ---------- constants ---------- */

describe("constants", () => {
  it("lists the standard cover roles", () => {
    expect(ARTWORK_ROLES).toContain("front");
    expect(ARTWORK_ROLES).toContain("back");
  });

  it("keeps thumbnail sizes ascending", () => {
    expect([...THUMBNAIL_SIZES].sort((a, b) => a - b)).toEqual([...THUMBNAIL_SIZES]);
  });
});

/* ---------- cache keys ---------- */

describe("artworkKey", () => {
  it("is stable for identical input", () => {
    expect(artworkKey(art())).toBe(artworkKey(art()));
  });

  it("changes when the pixels change", () => {
    const other = art({ data: Uint8Array.from([...PNG, 0x99]), bytes: PNG.length + 1 });
    expect(artworkKey(other)).not.toBe(artworkKey(art()));
  });

  it("changes when the role changes", () => {
    expect(artworkKey(art({ role: "back" }))).not.toBe(artworkKey(art()));
  });

  it("does not hash every byte of a large image", () => {
    const big = art({ data: new Uint8Array(4 * 1024 * 1024).fill(7), bytes: 4 * 1024 * 1024 });
    const started = performance.now();
    expect(artworkKey(big)).toBeTruthy();
    expect(performance.now() - started).toBeLessThan(50);
  });
});

/* ---------- object url cache ---------- */

describe("url cache", () => {
  it("reuses one object url per image", () => {
    stubUrls();
    const a = fullArtworkUrl(art());
    const b = fullArtworkUrl(art());
    expect(a).toBe(b);
  });

  it("revokes everything it created when released", async () => {
    stubUrls();
    fullArtworkUrl(art());
    await loadThumbnail(art({ data: new Uint8Array(8192).fill(3) }), 48);
    expect(thumbnailCacheSize()).toBeGreaterThan(0);
    releaseArtworkCache();
    expect(thumbnailCacheSize()).toBe(0);
    expect(revoked).toBeGreaterThan(0);
  });
});

/* ---------- thumbnails ---------- */

describe("loadThumbnail", () => {
  it("de-duplicates concurrent requests for the same image", async () => {
    stubUrls();
    const large = art({ data: new Uint8Array(9000).fill(5), bytes: 9000 });
    const [a, b] = await Promise.all([loadThumbnail(large, 96), loadThumbnail(large, 96)]);
    expect(a).toBe(b);
  });

  it("falls back to the full image when decoding is unavailable", async () => {
    stubUrls();
    // createImageBitmap is absent, so the full-size url is the honest answer.
    const url = await loadThumbnail(art({ data: new Uint8Array(9000).fill(9), bytes: 9000 }), 32);
    expect(url).toBe(fullArtworkUrl(art({ data: new Uint8Array(9000).fill(9), bytes: 9000 })));
  });

  it("returns the full image for a tiny payload without decoding it", async () => {
    stubUrls();
    const decoded = vi.fn();
    vi.stubGlobal("createImageBitmap", decoded);
    await loadThumbnail(art(), 48);
    expect(decoded).not.toHaveBeenCalled();
  });
});

/* ---------- container support ---------- */

describe("isArtworkMimeSupported", () => {
  it("limits MP4 covr atoms to JPEG and PNG", () => {
    expect(isArtworkMimeSupported("mp4", "image/jpeg")).toBe(true);
    expect(isArtworkMimeSupported("mp4", "image/png")).toBe(true);
    expect(isArtworkMimeSupported("mp4", "image/webp")).toBe(false);
    expect(isArtworkMimeSupported("mp4", "image/gif")).toBe(false);
  });

  it("allows any supported format in ID3 and Vorbis pictures", () => {
    expect(isArtworkMimeSupported("mp3", "image/webp")).toBe(true);
    expect(isArtworkMimeSupported("flac", "image/webp")).toBe(true);
    expect(isArtworkMimeSupported("vorbis", "image/png")).toBe(true);
  });

  it("rejects a type it cannot identify at all", () => {
    expect(isArtworkMimeSupported("flac", "image/gif")).toBe(false);
    expect(isArtworkMimeSupported("mp3", "application/pdf")).toBe(false);
  });

  it("accepts the common jpeg spelling", () => {
    expect(isArtworkMimeSupported("mp4", "image/jpg")).toBe(true);
  });
});

/* ---------- transforms ---------- */

describe("transformArtwork", () => {
  it("keeps the original bytes when the browser cannot decode images", async () => {
    const result = await transformArtwork(art(), { maxSize: 100 });
    expect(result.data).toBe(art().data);
    expect(result.warning).toMatch(/unavailable|could not be decoded/i);
  });

  it("keeps the original bytes when the image cannot be decoded", async () => {
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("corrupt");
    });
    const result = await transformArtwork(art(), { maxSize: 100 });
    expect(result.data).toBe(art().data);
    expect(result.warning).toMatch(/could not be decoded/i);
  });

  it("scales the long edge down to maxSize", async () => {
    const { created } = stubBitmap(1000, 500);
    const result = await transformArtwork(art(), { maxSize: 100 });
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
    expect(created[0].sw).toBe(1000);
    expect(created[0].sh).toBe(500);
  });

  it("never upscales", async () => {
    stubBitmap(50, 50);
    const result = await transformArtwork(art(), { maxSize: 500 });
    expect(result.width).toBe(50);
    expect(result.height).toBe(50);
  });

  it("crops to a centred square when asked", async () => {
    const { created } = stubBitmap(800, 400);
    const result = await transformArtwork(art(), { cropSquare: true, maxSize: 100 });
    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
    expect(created[0].sw).toBe(400);
    expect(created[0].sh).toBe(400);
    expect(created[0].sx).toBe(200);
    expect(created[0].sy).toBe(0);
  });

  it("reports the encoded size it produced", async () => {
    stubBitmap(400, 400);
    const result = await transformArtwork(art(), { maxSize: 100, outputMime: "image/webp" });
    expect(result.mime).toBe("image/webp");
    expect(result.bytes).toBe(64);
  });

  it("keeps the original when the encoder fails", async () => {
    stubBitmap(400, 400);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb) {
      cb(null);
    });
    const result = await transformArtwork(art(), { maxSize: 100 });
    expect(result.data).toBe(art().data);
    expect(result.warning).toMatch(/encoding failed/i);
  });
});

/* ---------- dominant colour ---------- */

describe("dominantColour", () => {
  it("returns null when decoding is unavailable", async () => {
    await expect(dominantColour(art())).resolves.toBeNull();
  });

  it("averages the sampled pixels", async () => {
    stubBitmap(64, 64);
    await expect(dominantColour(art())).resolves.toBe("rgb(10, 20, 30)");
  });
});

/* ---------- grouping ---------- */

describe("album grouping", () => {
  it("normalises case and surrounding space", () => {
    expect(albumGroupKey("  Pink Floyd ", " Blue Album ")).toBe(albumGroupKey("pink floyd", "blue album"));
  });

  it("keeps different albums apart", () => {
    expect(albumGroupKey("A", "B")).not.toBe(albumGroupKey("A", "C"));
  });

  it("prefers the album artist over a differing track artist", () => {
    const map = groupByAlbum([
      { metadata: { artists: ["Guest One"], albumArtists: ["Pink Floyd"], album: "Blue" } },
      { metadata: { artists: ["Guest Two"], albumArtists: ["Pink Floyd"], album: "Blue" } },
    ]);
    expect(map.size).toBe(1);
    expect([...map.values()][0]).toHaveLength(2);
  });

  it("does not merge different artists that share an album title", () => {
    const map = groupByAlbum([
      { metadata: { artists: ["Pink Floyd"], album: "Greatest Hits" } },
      { metadata: { artists: ["The Cure"], album: "Greatest Hits" } },
    ]);
    expect(map.size).toBe(2);
  });

  it("files an untagged file under an empty album", () => {
    const map = groupByAlbum([{ metadata: {} }]);
    expect(map.size).toBe(1);
    expect([...map.keys()][0]).toBe(albumGroupKey("", ""));
  });
});
