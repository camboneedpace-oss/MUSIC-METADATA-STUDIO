/**
 * Metadata matching.
 *
 * Scores a local file against an online release using signals of wildly
 * different reliability. An exact barcode or catalog number is close to
 * proof; artist string similarity is a hint. Weights reflect that, and the
 * result is always a suggestion the user must accept — nothing here writes.
 */

import type { LibraryFile } from "../library/types";
import type { Release } from "./types";

export interface MatchSignal {
  label: string;
  score: number;
  weight: number;
  detail: string;
}

export interface MatchResult {
  confidence: number;
  signals: MatchSignal[];
  /** Human-readable reasons, strongest first. */
  verdict: string;
  /** Conflicts that make the match unsafe despite a high score. */
  blockers: string[];
}

/** Cheap string similarity: token-set + normalised Levenshtein blend. */
export function similarity(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFC")
      .replace(/\b(the|a|an|and|of|in|on)\b/g, " ")
      .replace(/[^a-z0-9Ѐ-ӿ一-鿿]+/g, " ")
      .trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;

  const tokensA = new Set(x.split(/\s+/));
  const tokensB = new Set(y.split(/\s+/));
  let shared = 0;
  for (const t of tokensA) if (tokensB.has(t)) shared++;
  const jaccard = shared / (tokensA.size + tokensB.size - shared);

  return Math.max(jaccard * 0.7 + 0.3 * (1 - levenshtein(x, y) / Math.max(x.length, y.length)), jaccard);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

function numericSignal(
  label: string,
  actual: number | undefined,
  expected: number | undefined,
  weight: number,
  tolerance = 0,
  unit = "",
): MatchSignal {
  if (actual === undefined || expected === undefined) {
    return { label, score: 0.5, weight, detail: "not available on both sides" };
  }
  const delta = Math.abs(actual - expected);
  const ok = delta <= tolerance;
  return {
    label,
    score: ok ? 1 : delta <= (tolerance || 1) * 4 ? 0.5 : 0,
    weight,
    detail: ok
      ? `matches${unit ? ` within ${tolerance}${unit}` : ""}`
      : `local ${actual}${unit} vs release ${expected}${unit}`,
  };
}

export function matchFileToRelease(file: LibraryFile, release: Release): MatchResult {
  const m = file.metadata;
  const signals: MatchSignal[] = [];
  const blockers: string[] = [];

  const fileArtist = (m.artists?.[0] ?? m.artist ?? "").trim();
  const releaseArtist = release.artists.join(" & ");
  const artistScore = similarity(fileArtist, releaseArtist);
  signals.push({
    label: "Artist",
    score: artistScore,
    weight: 3,
    detail: artistScore === 1 ? "exact" : `${Math.round(artistScore * 100)}% similar`,
  });

  const albumScore = similarity(m.album ?? "", release.title);
  signals.push({
    label: "Album",
    score: albumScore,
    weight: 2.5,
    detail: albumScore === 1 ? "exact" : albumScore > 0 ? `${Math.round(albumScore * 100)}% similar` : "no local album",
  });

  const releaseTitle = releaseTrackFor(file, release)?.title ?? release.tracks[0]?.title ?? "";
  const titleScore = similarity(m.title ?? "", releaseTitle);
  signals.push({
    label: "Track title",
    score: titleScore,
    weight: 2.5,
    detail: titleScore === 1 ? "exact" : `${Math.round(titleScore * 100)}% similar`,
  });

  signals.push(numericSignal("Track number", m.trackNumber, releaseTrackFor(file, release)?.position, 2));
  signals.push(
    numericSignal("Duration", file.audio.duration, releaseTrackFor(file, release)?.length, 1.5, 3, "s"),
  );

  if (release.trackCount !== undefined) {
    signals.push({
      label: "Track count",
      score: m.trackTotal === undefined ? 0.5 : m.trackTotal === release.trackCount ? 1 : 0.2,
      weight: 1,
      detail: `release has ${release.trackCount} tracks`,
    });
  }
  if (release.discCount !== undefined && release.discCount > 1) {
    signals.push({
      label: "Disc count",
      score: (m.discTotal ?? 1) === release.discCount ? 1 : 0.3,
      weight: 1,
      detail: `release has ${release.discCount} discs`,
    });
  }
  if (release.year) {
    signals.push({
      label: "Year",
      score: m.year === undefined ? 0.5 : m.year === release.year ? 1 : Math.abs(m.year - release.year) <= 1 ? 0.6 : 0.1,
      weight: 1.5,
      detail: `release year ${release.year}`,
    });
  }
  if (release.barcode) {
    const same = Boolean(m.barcode) && m.barcode === release.barcode;
    signals.push({
      label: "Barcode",
      score: same ? 1 : 0,
      weight: 6,
      detail: same ? "identical" : m.barcode ? `local ${m.barcode}` : "no local barcode",
    });
    if (m.barcode && !same) blockers.push("Barcodes differ — this is likely a different pressing");
  }
  if (release.catalogNumber) {
    const localCat = m.catalogNumber ?? "";
    const same = Boolean(m.catalogNumber) && normaliseCat(localCat) === normaliseCat(release.catalogNumber);
    signals.push({
      label: "Catalog number",
      score: same ? 1 : 0,
      weight: 4,
      detail: same ? "identical" : m.catalogNumber ? `local ${m.catalogNumber}` : "no local catalog number",
    });
  }

  const totalWeight = signals.reduce((n, s) => n + s.weight, 0);
  const raw = signals.reduce((n, s) => n + s.score * s.weight, 0) / (totalWeight || 1);
  // A perfect score on weak signals should not read as certainty.
  const confidence = Math.round(raw * 100);

  const sorted = [...signals].sort((a, b) => b.score * b.weight - a.score * a.weight);
  const verdict =
    confidence >= 92 ? "Very likely the same release"
    : confidence >= 80 ? "Probable match"
    : confidence >= 60 ? "Possible match — review before applying"
    : "Weak match";

  return { confidence, signals: sorted, verdict, blockers };
}

function normaliseCat(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function releaseTrackFor(file: LibraryFile, release: Release) {
  if (!release.tracks.length) return undefined;
  const number = file.metadata.trackNumber;
  if (number !== undefined) {
    const exact = release.tracks.find((t) => t.position === number);
    if (exact) return exact;
  }
  return release.tracks.find((t) => similarity(file.metadata.title ?? "", t.title) > 0.85);
}

export interface AlbumMatchPlan {
  fileIds: string[];
  release: Release;
  confidence: number;
  blockers: string[];
}

/** Match a whole album at once: a 10/10 track match is far stronger evidence. */
export function matchAlbum(
  files: LibraryFile[],
  release: Release,
): AlbumMatchPlan {
  const results = files.map((f) => matchFileToRelease(f, release));
  const confidence = Math.round(results.reduce((n, r) => n + r.confidence, 0) / (results.length || 1));
  const blockers = [...new Set(results.flatMap((r) => r.blockers))];
  return { fileIds: files.map((f) => f.id), release, confidence, blockers };
}