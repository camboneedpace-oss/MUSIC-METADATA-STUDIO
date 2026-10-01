/**
 * Unified metadata model.
 *
 * Every format codec translates to/from this shape. Nothing above this
 * layer is allowed to know that MP3 has `TPE1` or that MP4 has `©nam`.
 */

export type FormatId =
  | "mp3"
  | "aac"
  | "m4a"
  | "m4b"
  | "mp4"
  | "ogg"
  | "opus"
  | "spx"
  | "flac"
  | "alac"
  | "wav"
  | "aiff"
  | "aif"
  | "ape"
  | "wma"
  | "mpc"
  | "wv"
  | "tta"
  | "tak"
  | "ofr"
  | "ofs"
  | "mkv"
  | "mka"
  | "webm"
  | "dsf"
  | "dff"
  | "wvp"
  | "aifc";

export const ALL_FORMAT_IDS: FormatId[] = [
  "mp3", "aac", "m4a", "m4b", "mp4", "ogg", "opus", "spx", "flac", "alac",
  "wav", "aiff", "aif", "aifc", "ape", "wma", "mpc", "wv", "tta", "tak",
  "ofr", "ofs", "mkv", "mka", "webm", "dsf", "dff", "wvp",
];

export type ArtworkRole =
  | "front"
  | "back"
  | "disc"
  | "artist"
  | "leaflet"
  | "other";

export const ARTWORK_ROLE_LABELS: Record<ArtworkRole, string> = {
  front: "Front Cover",
  back: "Back Cover",
  disc: "Disc",
  artist: "Artist",
  leaflet: "Leaflet",
  other: "Other",
};

export interface Artwork {
  id: string;
  /** Raw image bytes (the container's native encoding). */
  data: Uint8Array;
  mime: string;
  role: ArtworkRole;
  description?: string;
  width: number;
  height: number;
  bytes: number;
  /** Set when the image carries a dominant colour, for placeholder tints. */
  dominant?: string;
}

/** Fields that may legitimately hold several values in one container. */
export type MultiField =
  | "artists"
  | "genres"
  | "albumArtists"
  | "composers"
  | "conductors"
  | "labels";

/**
 * The unified model. Absent key = "no opinion". An empty string or empty
 * array = "explicitly cleared". That distinction is what makes batch
 * editing and undo honest.
 */
export interface MusicMetadata {
  title?: string;
  /** Primary artists. Formats that only allow one value read the first. */
  artists?: string[];
  artist?: string;
  album?: string;
  albumArtists?: string[];
  albumArtist?: string;
  composers?: string[];
  composer?: string;
  conductor?: string;
  trackNumber?: number;
  trackTotal?: number;
  discNumber?: number;
  discTotal?: number;
  year?: number;
  date?: string;
  genres?: string[];
  genre?: string;
  grouping?: string;
  comment?: string;
  compilation?: boolean;
  bpm?: number;
  key?: string;
  copyright?: string;
  publisher?: string;
  label?: string;
  isrc?: string;
  barcode?: string;
  catalogNumber?: string;
  lyrics?: string;
  language?: string;
  musicBrainzRecordingId?: string;
  musicBrainzReleaseId?: string;
  musicBrainzReleaseGroupId?: string;
  musicBrainzWorkId?: string;
  replayGainTrackGain?: string;
  replayGainTrackPeak?: string;
  replayGainAlbumGain?: string;
  replayGainAlbumPeak?: string;
  /** Software that last wrote the file. */
  encoder?: string;
  /** Free-form encoder settings string, e.g. `-V 2`. */
  encoderSettings?: string;
  artwork?: Artwork[];
  customFields?: Record<string, string>;
}

export interface AudioProperties {
  /** Seconds. */
  duration?: number;
  bitrate?: number;
  /** "CBR" | "VBR" | "?" */
  bitrateMode?: "CBR" | "VBR" | "?";
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  codec?: string;
  container?: string;
  encoder?: string;
  encoderSettings?: string;
  lossless?: boolean;
  /** Bytes of compressed audio (file size minus tags/padding). */
  audioBytes?: number;
}

export type TagStatus = "clean" | "modified" | "unsupported" | "error";

export interface RawTag {
  /** Native frame/comment/atom key, e.g. `TPE1`, `ALBUM`, `©nam`. */
  key: string;
  /** Raw native value(s). Kept verbatim so nothing is lost on round-trip. */
  values: string[];
  description?: string;
  /** Native binary payload for frames we render but do not interpret. */
  binaryBytes?: number;
}

export interface FileFormatInfo {
  /** Native tag scheme that was actually read. */
  tagScheme: string;
  /** e.g. "ID3v2.4", "Vorbis Comment", "MP4 ilst", "APEv2". */
  tagVersion?: string;
  /** Unknown tags are preserved verbatim and rewritten untouched. */
  preservedUnknown: boolean;
}

export interface ReadResult {
  metadata: MusicMetadata;
  raw: RawTag[];
  audio: AudioProperties;
  formatInfo: FileFormatInfo;
  /** Non-fatal problems: unsupported frames, truncated tags, bad pictures. */
  warnings: string[];
  /** Exact byte windows needed for a surgical rewrite. */
  layout: TagLayout;
}

export interface TagLayout {
  /** Absolute [start, end) of the leading tag block. */
  headStart: number;
  headEnd: number;
  /** Absolute [start, end) of a trailing tag block (ID3v1 / APEv2). */
  tailStart: number;
  tailEnd: number;
  /** Format-specific facts needed to serialise the same tag again. */
  variant: Record<string, string | number | boolean>;
}

export interface WriteResult {
  /** The full file bytes after the write. */
  bytes: Uint8Array;
  bytesWritten: number;
  warnings: string[];
}

/* ---------- capability matrix ---------- */

export interface FormatCapabilities {
  read: boolean;
  write: boolean;
  artwork: boolean;
  chapters: boolean;
  lyrics: boolean;
  /** Multi-value tags the container can actually store. */
  multiValue: boolean;
  /** True when the container stores losslessly-compressed audio. */
  lossless: boolean;
  notes: string;
}

export const FORMAT_CAPABILITIES: Record<FormatId, FormatCapabilities> = {
  mp3: { read: true, write: true, artwork: true, chapters: true, lyrics: true, multiValue: true, lossless: false, notes: "ID3v1, ID3v2.2/3/4 with APIC, USLT, TXXX, COMM, UFID, RVA2." },
  aac: { read: true, write: true, artwork: false, chapters: false, lyrics: true, multiValue: false, lossless: false, notes: "ADTS/ADIF ID3v2. No artwork container on raw AAC streams." },
  m4a: { read: true, write: true, artwork: true, chapters: true, lyrics: true, multiValue: true, lossless: false, notes: "MP4 ilst atoms: ©nam ©ART ©alb aART trkn disk covr ©day ©gen." },
  m4b: { read: true, write: true, artwork: true, chapters: true, lyrics: true, multiValue: true, lossless: false, notes: "Audiobook MP4. Same ilst mapping as M4A." },
  mp4: { read: true, write: true, artwork: true, chapters: true, lyrics: true, multiValue: true, lossless: false, notes: "Video MP4. Audio metadata read from the ilst." },
  ogg: { read: true, write: true, artwork: true, chapters: false, lyrics: true, multiValue: true, lossless: false, notes: "Vorbis Comment header; METADATA_BLOCK_PICTURE base64." },
  opus: { read: true, write: true, artwork: true, chapters: false, lyrics: true, multiValue: true, lossless: false, notes: "OpusComment header, same key set as Vorbis Comment." },
  spx: { read: true, write: true, artwork: true, chapters: false, lyrics: false, multiValue: true, lossless: false, notes: "Speex header. No standardised lyrics frame." },
  flac: { read: true, write: true, artwork: true, chapters: false, lyrics: true, multiValue: true, lossless: true, notes: "Vorbis Comment + METADATA_BLOCK_PICTURE + CUESHEET." },
  alac: { read: true, write: true, artwork: true, chapters: true, lyrics: true, multiValue: true, lossless: true, notes: "ALAC inside MP4. ilst atoms, lossless PCM payload." },
  wav: { read: true, write: true, artwork: false, chapters: false, lyrics: false, multiValue: false, lossless: true, notes: "RIFF INFO chunks (INAM/IART/IPRD…). Lyrics via optional id3 chunk." },
  aiff: { read: true, write: false, artwork: false, chapters: false, lyrics: false, multiValue: false, lossless: true, notes: "AIFF FORM/ID3 chunk is read. No writer yet — export a copy instead." },
  aif: { read: true, write: false, artwork: false, chapters: false, lyrics: false, multiValue: false, lossless: true, notes: "Alias for AIFF." },
  aifc: { read: true, write: false, artwork: false, chapters: false, lyrics: false, multiValue: false, lossless: true, notes: "Compressed AIFF variant." },
  ape: { read: true, write: true, artwork: true, chapters: false, lyrics: false, multiValue: false, lossless: true, notes: "APEv2 tag block before or after audio. No lyric frame in APEv2." },
  wma: { read: true, write: false, artwork: true, chapters: false, lyrics: false, multiValue: false, lossless: false, notes: "ASF extended content description read. Writer not implemented." },
  mpc: { read: true, write: true, artwork: true, chapters: false, lyrics: false, multiValue: true, lossless: false, notes: "Musepack SV7 APEv2 tag. Lossless (Hybrid) variants exist." },
  wv: { read: true, write: true, artwork: true, chapters: false, lyrics: false, multiValue: true, lossless: true, notes: "WavPack APEv2 tag." },
  tta: { read: true, write: true, artwork: true, chapters: false, lyrics: false, multiValue: true, lossless: true, notes: "TTA ID3v1/ID3v2 or APEv2 depending on writer; we read both." },
  tak: { read: true, write: false, artwork: true, chapters: false, lyrics: false, multiValue: false, lossless: true, notes: "TAK APEv2 read. Writer not implemented." },
  ofr: { read: true, write: true, artwork: true, chapters: false, lyrics: false, multiValue: true, lossless: true, notes: "OptimFROG APEv2 tag." },
  ofs: { read: true, write: true, artwork: true, chapters: false, lyrics: false, multiValue: true, lossless: true, notes: "OptimFROG APEv2 tag." },
  wvp: { read: true, write: true, artwork: true, chapters: false, lyrics: false, multiValue: true, lossless: true, notes: "WavPack variant id." },
  mkv: { read: false, write: false, artwork: false, chapters: true, lyrics: false, multiValue: false, lossless: false, notes: "Video container. Read via the Matroska tag path only when audio-only." },
  mka: { read: false, write: false, artwork: false, chapters: false, lyrics: false, multiValue: false, lossless: false, notes: "Matroska audio. Not yet supported." },
  webm: { read: false, write: false, artwork: false, chapters: false, lyrics: false, multiValue: false, lossless: false, notes: "WebM audio. Not yet supported." },
  dsf: { read: true, write: false, artwork: false, chapters: false, lyrics: false, multiValue: false, lossless: true, notes: "DSD stream file. ID3v2 at head. Writer not implemented." },
  dff: { read: true, write: false, artwork: false, chapters: false, lyrics: false, multiValue: false, lossless: true, notes: "DSDIFF container. Not yet supported." },
};

/** Extensions mapped to a format id. Longest match wins. */
export const EXTENSION_MAP: Record<string, FormatId> = {
  mp3: "mp3", mp2: "mp3",
  aac: "aac", adts: "aac", adif: "aac",
  m4a: "m4a", m4b: "m4b", mp4: "mp4", m4v: "mp4",
  ogg: "ogg", oga: "ogg", opus: "opus", spx: "spx",
  flac: "flac",
  wav: "wav", wave: "wav",
  aiff: "aiff", aif: "aif", aifc: "aifc",
  ape: "ape", mac: "ape",
  wma: "wma",
  mpc: "mpc", "mp+": "mpc", mpp: "mpc",
  wv: "wv", wvp: "wvp",
  tta: "tta", tak: "tak",
  ofr: "ofr", ofs: "ofs",
  mkv: "mkv", mka: "mka", webm: "webm",
  dsf: "dsf", dff: "dff",
};

export const AUDIO_EXTENSIONS = Object.keys(EXTENSION_MAP);

export function formatFromPath(path: string): FormatId | null {
  const m = /\.([a-z0-9+\-]+)$/i.exec(path);
  if (!m) return null;
  return EXTENSION_MAP[m[1].toLowerCase()] ?? null;
}

export const LOSSLESS_FORMATS = new Set<FormatId>(
  (Object.keys(FORMAT_CAPABILITIES) as FormatId[]).filter(
    (f) => FORMAT_CAPABILITIES[f].lossless,
  ),
);

export function isLossless(format: FormatId): boolean {
  return FORMAT_CAPABILITIES[format]?.lossless ?? false;
}

/* ---------- human formatting ---------- */

export function formatDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0
    ? `${h}:${mm}:${String(s).padStart(2, "0")}`
    : `${mm}:${String(s).padStart(2, "0")}`;
}

export function formatBitrate(bps?: number): string {
  if (!bps || !Number.isFinite(bps)) return "—";
  return `${Math.round(bps / 1000)} kbps`;
}

export function formatBytes(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatSampleRate(hz?: number): string {
  if (!hz) return "—";
  return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`;
}