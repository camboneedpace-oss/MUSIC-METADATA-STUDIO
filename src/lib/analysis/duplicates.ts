/**
 * Duplicate detection.
 *
 * Three independent signals, reported separately so the user can tell a
 * bit-for-bit copy from two different masters of the same recording:
 *
 *  1. Exact   — SHA-256 over the whole file.
 *  2. Tag     — artist + album + track + duration.
 *  3. Audio   — an AcoustID-style fingerprint, only available when the file
 *               carries one or the local agent can decode the audio.
 */

import type { DuplicateGroup } from "../library/types";
import type { LibraryFile } from "../library/types";

export interface DuplicateCandidate extends DuplicateGroup {
  /** Per-member detail for the group table. */
  entries: Array<{
    fileId: string;
    name: string;
    folder: string;
    size: number;
    format: string;
    bitrate?: number;
    lossless: boolean;
    duration?: number;
  }>;
  /** Bytes that would be reclaimed by keeping one file. */
  reclaimable: number;
}

/** FNV-1a over the tag payload — a cheap synchronous fallback for grouping. */
export function tagSignature(file: LibraryFile): string {
  const m = file.metadata;
  const parts = [
    (m.albumArtists?.[0] ?? m.albumArtist ?? m.artists?.[0] ?? m.artist ?? "").trim().toLowerCase(),
    (m.album ?? "").trim().toLowerCase(),
    (m.trackNumber ?? "").toString(),
    (m.title ?? "").trim().toLowerCase(),
    file.audio.duration !== undefined ? Math.round(file.audio.duration) : "",
  ];
  return parts.join("|");
}

/** Group key that deliberately excludes the title, so region variants match. */
function looseTagSignature(file: LibraryFile): string {
  const m = file.metadata;
  return [
    (m.albumArtists?.[0] ?? m.albumArtist ?? m.artists?.[0] ?? m.artist ?? "").trim().toLowerCase(),
    (m.album ?? "").trim().toLowerCase(),
    file.audio.duration !== undefined ? Math.round(file.audio.duration / 2) : "",
  ].join("|");
}

export function fingerprintOf(file: LibraryFile): string | null {
  return file.metadata.customFields?.ACOUSTID_FINGERPRINT ?? null;
}

export function findDuplicates(
  files: LibraryFile[],
  options: { kinds?: Array<DuplicateCandidate["kind"]> } = {},
): DuplicateCandidate[] {
  const kinds = options.kinds ?? ["exact", "metadata", "fingerprint"];
  const groups: DuplicateCandidate[] = [];

  if (kinds.includes("exact")) {
    const byHash = groupBy(files.filter((f) => f.contentHash), (f) => f.contentHash!);
    for (const [key, members] of byHash) {
      if (members.length < 2) continue;
      groups.push(buildGroup("exact", `sha256:${key.slice(0, 12)}`, members));
    }
  }

  if (kinds.includes("fingerprint")) {
    const byPrint = groupBy(files.filter((f) => fingerprintOf(f)), (f) => fingerprintOf(f)!);
    for (const [key, members] of byPrint) {
      if (members.length < 2) continue;
      groups.push(buildGroup("fingerprint", `acoustid:${key}`, members));
    }
  }

  if (kinds.includes("metadata")) {
    const byTag = groupBy(files, tagSignature);
    for (const [key, members] of byTag) {
      if (members.length < 2) continue;
      if (key.split("|").filter(Boolean).length < 3) continue;
      groups.push(buildGroup("metadata", key, members));
    }
  }

  // Collapse groups that describe the same set of files, keeping the strongest
  // signal so an exact duplicate is never buried under a metadata match.
  const rank: Record<DuplicateCandidate["kind"], number> = { fingerprint: 3, exact: 2, metadata: 1 };
  const byMembers = new Map<string, DuplicateCandidate>();
  for (const g of groups) {
    const key = [...g.members].sort().join(",");
    const existing = byMembers.get(key);
    if (!existing || rank[g.kind] > rank[existing.kind]) byMembers.set(key, g);
  }
  void looseTagSignature;

  return [...byMembers.values()].sort((a, b) => b.reclaimable - a.reclaimable);
}

function buildGroup(
  kind: DuplicateCandidate["kind"],
  key: string,
  members: LibraryFile[],
): DuplicateCandidate {
  const entries = members.map((f) => ({
    fileId: f.id,
    name: f.name,
    folder: f.folder,
    size: f.size,
    format: f.format,
    bitrate: f.audio.bitrate,
    lossless: Boolean(f.audio.lossless),
    duration: f.audio.duration,
  }));
  const totalBytes = members.reduce((n, f) => n + f.size, 0);
  const best = bestMember(members);
  return {
    id: `${kind}:${key}`,
    kind,
    key,
    members: members.map((f) => f.id),
    entries,
    totalBytes,
    reclaimable: totalBytes - best.size,
  };
}

/** The copy we would keep: lossless beats lossy, then size, then duration. */
export function bestMember(members: LibraryFile[]): LibraryFile {
  return [...members].sort((a, b) => {
    if (Boolean(a.audio.lossless) !== Boolean(b.audio.lossless)) {
      return a.audio.lossless ? -1 : 1;
    }
    if (a.size !== b.size) return b.size - a.size;
    return (b.audio.duration ?? 0) - (a.audio.duration ?? 0);
  })[0];
}

export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}