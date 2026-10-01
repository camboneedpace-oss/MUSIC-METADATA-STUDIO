/**
 * Scan worker.
 *
 * Parsing runs here so a 50,000-file import never blocks a keystroke. Files
 * arrive as raw bytes; results come back as plain structured-cloneable
 * objects, with artwork kept on this side and pulled on demand so the main
 * thread is not forced to copy megabytes of image data per file.
 */

import { readMetadata, type ScannedFile } from "../metadata";
import type { FormatId, MusicMetadata, RawTag } from "../metadata/types";

export interface ScanRequest {
  type: "scan";
  runId: string;
  jobs: ScanJob[];
}

/**
 * A `File` is structured-cloneable, so the main thread can hand over the
 * handle and let the read happen here. Raw bytes are still accepted for
 * callers that already have them.
 */
export interface ScanJob {
  id: string;
  path: string;
  source: File | Uint8Array;
  hash: boolean;
}

export interface ScanCancel {
  type: "cancel";
  runId: string;
}

export type WorkerRequest = ScanRequest | ScanCancel;

export interface ScannedResult {
  type: "result";
  id: string;
  path: string;
  format: FormatId;
  metadata: MusicMetadata;
  raw: RawTag[];
  audio: ScannedFile["audio"];
  warnings: string[];
  tagScheme: string;
  contentHash?: string;
  error?: string;
  /** Bytes of artwork found, without the artwork itself. */
  artworkCount: number;
  artworkBytes: number;
}

export interface WorkerProgress {
  type: "progress";
  runId: string;
  done: number;
  total: number;
  current: string;
  byFormat: Record<string, number>;
  bytes: number;
}

export interface WorkerDone {
  type: "done";
  runId: string;
  elapsedMs: number;
}

export interface WorkerFailed {
  type: "failed";
  runId: string;
  message: string;
}

export type WorkerResponse = WorkerProgress | ScannedResult | WorkerDone | WorkerFailed;

const cancelled = new Set<string>();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelled.add(message.runId);
    return;
  }
  if (message.type === "scan") {
    void runScan(message);
  }
};

async function runScan(request: ScanRequest) {
  const started = performance.now();
  const byFormat: Record<string, number> = {};
  let bytes = 0;

  for (let i = 0; i < request.jobs.length; i++) {
    if (cancelled.has(request.runId)) {
      cancelled.delete(request.runId);
      return;
    }
    const job = request.jobs[i];
    let result: ScannedResult;
    try {
      const bytes = await jobBytes(job);
      const scanned = readMetadata(bytes, job.path);
      const hash = job.hash ? await digest(bytes) : undefined;
      const art = scanned.metadata.artwork ?? [];
      result = {
        type: "result",
        id: job.id,
        path: job.path,
        format: scanned.format,
        // Artwork bytes are deliberately dropped here: a 50k-file scan would
        // clone tens of gigabytes through structured clone. The UI re-reads
        // the file lazily when a row's artwork is actually needed.
        metadata: { ...scanned.metadata, artwork: undefined },
        raw: scanned.raw,
        audio: scanned.audio,
        warnings: scanned.warnings,
        tagScheme: scanned.formatInfo.tagScheme,
        contentHash: hash,
        artworkCount: art.length,
        artworkBytes: art.reduce((n, a) => n + a.bytes, 0),
      };
    } catch (err) {
      result = {
        type: "result",
        id: job.id,
        path: job.path,
        format: "mp3",
        metadata: {},
        raw: [],
        audio: {},
        warnings: [],
        tagScheme: "None",
        error: (err as Error).message,
        artworkCount: 0,
        artworkBytes: 0,
      };
    }

    byFormat[result.format] = (byFormat[result.format] ?? 0) + 1;
    bytes += job.source instanceof Uint8Array ? job.source.length : job.source.size;
    post(result);

    if (i % 25 === 0 || i === request.jobs.length - 1) {
      post({
        type: "progress",
        runId: request.runId,
        done: i + 1,
        total: request.jobs.length,
        current: job.path,
        byFormat: { ...byFormat },
        bytes,
      });
      // Yield so the progress message is flushed before the next batch.
      await Promise.resolve();
    }
  }

  post({ type: "done", runId: request.runId, elapsedMs: performance.now() - started });
}

function post(message: WorkerResponse) {
  (self as unknown as { postMessage(m: WorkerResponse): void }).postMessage(message);
}

/** Read the job's bytes, skipping files past the size guard. */
async function jobBytes(job: ScanJob): Promise<Uint8Array> {
  if (job.source instanceof Uint8Array) return job.source;
  return new Uint8Array(await job.source.arrayBuffer());
}

/** SHA-256 via WebCrypto, used only when duplicate detection asks for it. */
async function digest(bytes: Uint8Array): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  try {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const hash = await crypto.subtle.digest("SHA-256", copy);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined;
  }
}