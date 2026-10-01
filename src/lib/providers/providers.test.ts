import { describe, expect, it, vi } from "vitest";
import {
  buildLucene,
  coverArtUrls,
  toFullRelease,
  toRelease,
} from "./musicbrainz";
import {
  matchAlbum,
  matchFileToRelease,
  similarity,
} from "./matching";
import {
  DEFAULT_PROVIDER_SETTINGS,
  ProviderError,
  RateLimiter,
  buildUserAgent,
  toArtwork,
  withRetry,
} from "./types";
import type { LibraryFile } from "../library/types";
import type { Release } from "./types";

/* ---------- fixtures ---------- */

function file(metadata: LibraryFile["metadata"], audio: LibraryFile["audio"] = {}): LibraryFile {
  return {
    id: "f1",
    name: "01 - track.mp3",
    folder: "Album",
    size: 1024,
    modifiedAt: 0,
    file: new File([], "01 - track.mp3"),
    writable: true,
    format: "mp3",
    metadata,
    onDisk: metadata,
    audio,
    raw: [],
    warnings: [],
    tagScheme: "ID3v2",
    tagStatus: "clean",
    dirty: false,
    addedAt: 0,
  };
}

function release(over: Partial<Release> = {}): Release {
  return {
    id: "mbid-1",
    source: "musicbrainz",
    title: "Blue Album",
    artists: ["Pink Floyd"],
    year: 1973,
    barcode: "724381076420",
    catalogNumber: "CDS 74642",
    trackCount: 2,
    discCount: 1,
    artworkUrls: [],
    tracks: [
      { position: 1, title: "Speak to Me", length: 306 },
      { position: 2, title: "Breathe", length: 383 },
    ],
    ...over,
  };
}

/* ---------- similarity ---------- */

describe("similarity", () => {
  it("scores identical strings as 1", () => {
    expect(similarity("Pink Floyd", "Pink Floyd")).toBe(1);
  });

  it("ignores case, punctuation and leading articles", () => {
    expect(similarity("The Beatles", "Beatles")).toBe(1);
    expect(similarity("  Pink Floyd!  ", "pink floyd")).toBe(1);
  });

  it("treats an elision as a different word rather than pretending it matches", () => {
    // "Night!" vs "night" must not score as an exact hit.
    expect(similarity("Hard Day's Night", "Hard Days Night")).toBeLessThan(1);
    expect(similarity("Hard Day's Night", "Hard Days Night")).toBeGreaterThan(0.5);
  });

  it("scores disjoint strings near zero", () => {
    expect(similarity("Pink Floyd", "Beethoven")).toBeLessThan(0.2);
  });

  it("returns 0 when either side is empty after normalisation", () => {
    expect(similarity("", "Anything")).toBe(0);
    expect(similarity("The", "The")).toBe(0);
  });

  it("survives non-latin scripts", () => {
    expect(similarity("宇多田ヒカル", "宇多田ヒカル")).toBe(1);
  });
});

/* ---------- matching ---------- */

describe("matchFileToRelease", () => {
  it("is confident when every strong signal agrees", () => {
    const result = matchFileToRelease(
      file(
        {
          title: "Speak to Me",
          artists: ["Pink Floyd"],
          album: "Blue Album",
          trackNumber: 1,
          trackTotal: 2,
          year: 1973,
          barcode: "724381076420",
          catalogNumber: "CDS 74642",
        },
        { duration: 306 },
      ),
      release(),
    );
    expect(result.confidence).toBeGreaterThanOrEqual(92);
    expect(result.verdict).toMatch(/very likely/i);
    expect(result.blockers).toEqual([]);
  });

  it("treats an identical barcode as decisive even when strings differ", () => {
    const result = matchFileToRelease(
      file({ title: "Totally Different", barcode: "724381076420" }),
      release(),
    );
    const barcode = result.signals.find((s) => s.label === "Barcode");
    expect(barcode?.score).toBe(1);
    expect(barcode?.weight).toBe(6);
  });

  it("blocks a match when the barcodes disagree", () => {
    const result = matchFileToRelease(file({ title: "Speak to Me", barcode: "000000000000" }), release());
    expect(result.blockers.join(" ")).toMatch(/different pressing/i);
    // A zero on a weight-6 signal has to hurt.
    expect(result.confidence).toBeLessThan(92);
  });

  it("reports 'not available' rather than failing when a signal is missing", () => {
    const result = matchFileToRelease(file({ title: "Speak to Me" }), release());
    const duration = result.signals.find((s) => s.label === "Duration");
    expect(duration?.score).toBe(0.5);
    expect(duration?.detail).toMatch(/not available/i);
  });

  it("sorts signals strongest first", () => {
    const result = matchFileToRelease(file({ title: "Speak to Me", artists: ["Pink Floyd"] }), release());
    const weights = result.signals.map((s) => s.score * s.weight);
    for (let i = 1; i < weights.length; i++) expect(weights[i]).toBeLessThanOrEqual(weights[i - 1]);
  });

  it("resolves the release track by title when the track number does not match", () => {
    const result = matchFileToRelease(
      file({ title: "Breathe", artists: ["Pink Floyd"], trackNumber: 99 }),
      release(),
    );
    // Track 99 does not exist, so the title has to be measured against the
    // track the file actually names — not blindly against the first track.
    expect(result.signals.find((s) => s.label === "Track title")?.score).toBe(1);
  });

  it("does not report certainty for a weak match", () => {
    const result = matchFileToRelease(file({ title: "Unrelated", artists: ["Someone"] }), release());
    expect(result.confidence).toBeLessThan(60);
    expect(result.verdict).toMatch(/weak/i);
  });
});

describe("matchAlbum", () => {
  it("averages confidence and unions blockers across the album", () => {
    const files = [
      file({ title: "Speak to Me", artists: ["Pink Floyd"], album: "Blue Album" }),
      file({ title: "Breathe", artists: ["Pink Floyd"], album: "Blue Album" }),
    ];
    const plan = matchAlbum(files, release());
    expect(plan.fileIds).toEqual(["f1", "f1"]);
    expect(plan.confidence).toBeGreaterThan(0);
  });

  it("surfaces a blocker seen on any track", () => {
    const files = [
      file({ title: "Speak to Me", barcode: "111" }),
      file({ title: "Breathe", barcode: "222" }),
    ];
    const plan = matchAlbum(files, release());
    expect(plan.blockers.length).toBeGreaterThan(0);
  });

  it("handles an empty album without dividing by zero", () => {
    expect(matchAlbum([], release()).confidence).toBe(0);
  });
});

/* ---------- Lucene ---------- */

describe("buildLucene", () => {
  it("combines artist and album into one clause", () => {
    expect(buildLucene({ artist: "Pink Floyd", album: "Blue Album" })).toBe(
      'artist:"Pink Floyd" AND release:"Blue Album"',
    );
  });

  it("falls back to recording when there is no album", () => {
    expect(buildLucene({ artist: "Pink Floyd", title: "Breathe" })).toBe(
      'artist:"Pink Floyd" AND recording:"Breathe"',
    );
  });

  it("searches by barcode or catalog number alone", () => {
    expect(buildLucene({ barcode: "724381076420" })).toBe('barcode:"724381076420"');
    expect(buildLucene({ catalogNumber: "CDS 74642" })).toBe('catno:"CDS 74642"');
  });

  it("short-circuits to an id lookup", () => {
    expect(buildLucene({ musicBrainzId: "abc-123", artist: "Ignored" })).toBe("rid:abc-123");
  });

  it("strips characters that would break out of a quoted phrase", () => {
    const query = buildLucene({ artist: 'Evil" OR album:*' });
    expect(query.startsWith('artist:"')).toBe(true);
    expect(query.endsWith('"')).toBe(true);
    // Exactly the two delimiters: nothing escaped into the query language.
    expect(query.split('"')).toHaveLength(3);
    expect(query).not.toContain(" OR ");
    expect(query).not.toContain("\\");
  });

  it("returns an empty string when there is nothing to search for", () => {
    expect(buildLucene({})).toBe("");
  });

  it("appends a label filter", () => {
    expect(buildLucene({ artist: "X", label: "Harvest" })).toContain('label:"Harvest"');
  });
});

/* ---------- response mapping ---------- */

describe("toRelease", () => {
  const searchHit = {
    id: "mbid-1",
    title: "Blue Album",
    date: "1973-06-01",
    country: "GB",
    status: "Official",
    barcode: "724381076420",
    "artist-credit": [{ name: "Pink Floyd" }],
    media: [{ format: "CD", "track-count": 5 }, { format: "CD", "track-count": 5 }],
    "label-info": [{ "catalog-number": "CDS 74642", label: { name: "Harvest" } }],
  };

  it("maps the fields a search result can carry", () => {
    const r = toRelease(searchHit);
    expect(r.source).toBe("musicbrainz");
    expect(r.artists).toEqual(["Pink Floyd"]);
    expect(r.year).toBe(1973);
    expect(r.label).toBe("Harvest");
    expect(r.catalogNumber).toBe("CDS 74642");
    expect(r.barcode).toBe("724381076420");
    expect(r.trackCount).toBe(10);
    expect(r.discCount).toBe(2);
    expect(r.formats).toEqual(["CD"]);
    expect(r.url).toContain("mbid-1");
    expect(searchHit.media && r.media).toBe("CD");
  });

  it("joins multi-artist credits with their join phrases", () => {
    const r = toRelease({
      ...searchHit,
      "artist-credit": [
        { name: "David Bowie", joinphrase: " & " },
        { name: "Peter Gabriel", joinphrase: " & " },
        { name: "Phil Collins" },
      ],
    });
    expect(r.artists).toEqual(["David Bowie & Peter Gabriel & Phil Collins"]);
  });

  it("falls back to a placeholder when there is no artist credit", () => {
    expect(toRelease({ ...searchHit, "artist-credit": undefined }).artists).toEqual(["Unknown Artist"]);
  });

  it("leaves the year undefined for an unparseable date", () => {
    expect(toRelease({ ...searchHit, date: "unknown" }).year).toBeUndefined();
    expect(toRelease({ ...searchHit, date: undefined }).year).toBeUndefined();
  });

  it("always offers cover art urls for a release id", () => {
    expect(coverArtUrls("abc")).toEqual([
      "https://coverartarchive.org/release/abc/front-500",
      "https://coverartarchive.org/release/abc/front-1200",
    ]);
  });
});

describe("toFullRelease", () => {
  it("flattens media into a track list with disc numbers", () => {
    const r = toFullRelease({
      id: "mbid-1",
      title: "Blue Album",
      date: "1973",
      "artist-credit": [{ name: "Pink Floyd" }],
      media: [
        { position: 1, track: [{ id: "r1", number: "1", position: 1, title: "Speak to Me", length: 306 }] },
        { position: 2, track: [{ id: "r2", position: 1, title: "Breathe", recording: { id: "rec2", title: "Breathe", length: 383 } }] },
      ],
    });
    expect(r.tracks).toHaveLength(2);
    expect(r.tracks[0]).toMatchObject({ position: 1, title: "Speak to Me", length: 306, discNumber: 1 });
    expect(r.tracks[1]).toMatchObject({ position: 1, title: "Breathe", length: 383, discNumber: 2 });
    expect(r.trackCount).toBe(2);
    expect(r.albumArtist).toBe("Pink Floyd");
  });

  it("falls back to the track id when there is no recording block", () => {
    const r = toFullRelease({ id: "m", title: "t", media: [{ track: [{ id: "tid", position: 3, title: "x" }] }] });
    expect(r.tracks[0].recordingId).toBe("tid");
    expect(r.tracks[0].position).toBe(3);
  });
});

/* ---------- transport ---------- */

describe("RateLimiter", () => {
  it("serialises calls so none overlap", async () => {
    const limiter = new RateLimiter(0);
    const order: string[] = [];
    const make = (tag: string) => async () => {
      order.push(`${tag}:start`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`${tag}:end`);
    };
    await Promise.all([limiter.run(make("a")), limiter.run(make("b"))]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("keeps running after a rejected task", async () => {
    const limiter = new RateLimiter(0);
    await expect(limiter.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
  });

  it("waits the minimum interval between calls", async () => {
    const limiter = new RateLimiter(40);
    const started = Date.now();
    await limiter.run(async () => "first");
    await limiter.run(async () => "second");
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
  });
});

describe("withRetry", () => {
  it("returns the first success without waiting", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx and succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new ProviderError("server", "mb", 503);
      return "ok";
    });
    const waits: number[] = [];
    await expect(withRetry(fn, 3, (w) => waits.push(w))).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([400, 800]);
  });

  it("does not retry a 4xx that will never succeed", async () => {
    const fn = vi.fn(async () => {
      throw new ProviderError("bad request", "mb", 400);
    });
    await expect(withRetry(fn)).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does retry a 429", async () => {
    const fn = vi.fn(async () => {
      throw new ProviderError("slow down", "mb", 429);
    });
    await expect(withRetry(fn, 2)).rejects.toThrow("slow down");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after the attempt budget", async () => {
    const fn = vi.fn(async () => {
      throw new ProviderError("down", "mb", 500);
    });
    await expect(withRetry(fn, 2)).rejects.toThrow("down");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("user agent", () => {
  it("identifies the app", () => {
    expect(buildUserAgent({})).toContain("UniversalMusicMetadataStudio");
    expect(buildUserAgent({})).toBe(DEFAULT_PROVIDER_SETTINGS.userAgentApp);
  });

  it("appends contact details when supplied", () => {
    expect(buildUserAgent({}, "me@example.com")).toContain("me@example.com");
  });
});

describe("toArtwork", () => {
  it("maps candidates into empty artwork placeholders", () => {
    const art = toArtwork([
      { id: "1", url: "https://x/front.jpg", thumbUrl: "https://x/t.jpg", width: 500, height: 500, type: "Front" },
    ]);
    expect(art).toHaveLength(1);
    expect(art[0]).toMatchObject({ id: "1", mime: "image/jpeg", role: "front", width: 500, height: 500, bytes: 0 });
    expect(art[0].data).toHaveLength(0);
  });
});
