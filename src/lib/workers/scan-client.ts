/**
 * Scan client.
 *
 * Owns a pool of scan workers and hands results back keyed by file id. Runs are
 * cancellable and degrade to main-thread parsing when Workers are unavailable,
 * so the app still works in a test runner or an old browser.
 *
 * Files are posted as `File` objects rather than as bytes: the structured
 * clone of a `File` is cheap, so the read happens inside the worker instead of
 * stalling the main thread on `arrayBuffer()`.
 */

import { readMetadata } from "../metadata";
import type { ScannedResult, ScanJob, WorkerResponse } from "./scan.worker";
import type { FormatId, MusicMetadata, RawTag } from "../metadata/types";

export type { ScannedResult };
export type { ScanJob };

export interface ScanProgress {
  done: number;
  total: number;
  current: string;
  byFormat: Record<string, number>;
  bytes: number;
}

export interface ScanRun {
  /** Resolves with every result that arrived before completion. */
  done: Promise<Map<string, ScannedResult>>;
  /** Drops any results still in flight and stops the workers. */
  cancel(): void;
}

export interface ScanOptions {
  /** Upper bound on parallel workers. Clamped to at least 1. */
  workers?: number;
  /** Compute a content hash so exact-duplicate detection can use it. */
  hash?: boolean;
  onProgress?: (progress: ScanProgress) => void;
  /** Called as results arrive, so the table can fill in as we go. */
  onResult?: (result: ScannedResult) => void;
}

let runCounter = 0;

function workerSupported(): boolean {
  return typeof Worker !== "undefined" && typeof URL !== "undefined";
}

/** Split jobs into `n` contiguous chunks; one chunk per worker. */
function chunk<T>(items: T[], n: number): T[][] {
  const size = Math.max(1, Math.ceil(items.length / n));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function scanFiles(jobs: ScanJob[], options: ScanOptions = {}): ScanRun {
  const workerCount = Math.max(1, Math.min(16, options.workers ?? 2));
  const runId = `scan-${Date.now().toString(36)}-${(runCounter += 1)}`;

  // A single worker buys nothing over the inline path and costs a thread
  // switch per batch, so only pool when there is more than one.
  if (!workerSupported() || workerCount === 1) {
    return scanOnMainThread(jobs, options);
  }

  return scanInWorkers(jobs, { ...options, workers: workerCount }, runId);
}

/* ------------------------------------------------------------------ workers */

function scanInWorkers(jobs: ScanJob[], options: ScanOptions, runId: string): ScanRun {
  const results = new Map<string, ScannedResult>();
  const byFormat: Record<string, number> = {};
  let done = 0;
  let bytes = 0;
  let settled = false;
  let outstanding = 0;
  let resolveDone!: (map: Map<string, ScannedResult>) => void;

  const done_ = new Promise<Map<string, ScannedResult>>((resolve) => {
    resolveDone = resolve;
  });

  const workers: Worker[] = [];
  const batches = chunk(jobs, options.workers ?? 2);

  const finish = () => {
    if (settled) return;
    settled = true;
    for (const worker of workers) worker.terminate();
    resolveDone(results);
  };

  const onMessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if ("runId" in message && message.runId !== runId) return;
    switch (message.type) {
      case "progress":
        // Only the cursor and byte count come from here; `done` is the count
        // of results we have actually applied, so the bar cannot overshoot.
        bytes = Math.max(bytes, message.bytes);
        options.onProgress?.({
          done: results.size,
          total: jobs.length,
          current: message.current,
          byFormat: { ...byFormat },
          bytes,
        });
        return;
      case "failed":
        finish();
        return;
      case "done":
        outstanding -= 1;
        if (outstanding <= 0) finish();
        return;
      case "result": {
        results.set(message.id, message);
        byFormat[message.format] = (byFormat[message.format] ?? 0) + 1;
        done = results.size;
        options.onProgress?.({
          done,
          total: jobs.length,
          current: message.path,
          byFormat: { ...byFormat },
          bytes,
        });
        options.onResult?.(message);
        return;
      }
    }
  };

  try {
    for (const batch of batches) {
      const worker = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = onMessage;
      worker.onerror = () => {
        outstanding -= 1;
        if (outstanding <= 0) finish();
      };
      workers.push(worker);
      outstanding += 1;
      worker.postMessage({
        type: "scan",
        runId,
        jobs: batch.map((job) => ({ ...job, hash: options.hash ?? false })),
      });
    }
  } catch {
    // Worker construction failed (blocked by CSP, bad module URL, …).
    for (const worker of workers) worker.terminate();
    return scanOnMainThread(jobs, options);
  }

  return {
    done: done_,
    cancel() {
      for (const worker of workers) {
        worker.postMessage({ type: "cancel", runId });
        worker.terminate();
      }
      finish();
    },
  };
}

/* ----------------------------------------------------------------- fallback */

/**
 * Same contract, parsed inline. Slower and it does block, which is exactly why
 * it is the fallback rather than the default.
 */
function scanOnMainThread(jobs: ScanJob[], options: ScanOptions): ScanRun {
  const results = new Map<string, ScannedResult>();
  const byFormat: Record<string, number> = {};
  let cancelled = false;
  let bytes = 0;

  const done = (async () => {
    for (let i = 0; i < jobs.length; i++) {
      if (cancelled) break;
      const job = jobs[i];
      const result = await parseOne(job, options.hash ?? false);
      results.set(result.id, result);
      byFormat[result.format] = (byFormat[result.format] ?? 0) + 1;
      bytes += job.source instanceof Uint8Array ? job.source.length : job.source.size;
      options.onResult?.(result);
      options.onProgress?.({
        done: i + 1,
        total: jobs.length,
        current: job.path,
        byFormat: { ...byFormat },
        bytes,
      });
      // Let the overlay paint every eighth file.
      if (i % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return results;
  })();

  return {
    done,
    cancel() {
      cancelled = true;
    },
  };
}

async function parseOne(job: ScanJob, hash: boolean): Promise<ScannedResult> {
  try {
    const bytes =
      job.source instanceof Uint8Array ? job.source : new Uint8Array(await job.source.arrayBuffer());
    const scanned = readMetadata(bytes, job.path);
    const artwork = scanned.metadata.artwork ?? [];
    return {
      type: "result",
      id: job.id,
      path: job.path,
      format: scanned.format,
      // Artwork bytes stay behind: cloning megabytes of images per file would
      // cost more than parsing. Callers re-read them lazily when needed.
      metadata: { ...scanned.metadata, artwork: undefined },
      raw: scanned.raw,
      audio: scanned.audio,
      warnings: scanned.warnings,
      tagScheme: scanned.formatInfo.tagScheme,
      contentHash: hash ? await digest(bytes) : undefined,
      artworkCount: artwork.length,
      artworkBytes: artwork.reduce((n, a) => n + a.bytes, 0),
    };
  } catch (err) {
    return {
      type: "result",
      id: job.id,
      path: job.path,
      format: "mp3" as FormatId,
      metadata: {} as MusicMetadata,
      raw: [] as RawTag[],
      audio: {},
      warnings: [],
      tagScheme: "None",
      error: (err as Error).message,
      artworkCount: 0,
      artworkBytes: 0,
    };
  }
}

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

/**
 * Re-read one file's artwork. The scan path drops image bytes on purpose; this
 * is the lazy way back to them, and it is cached on the record afterwards.
 */
export async function readArtwork(file: File, path: string) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return readMetadata(bytes, path).metadata.artwork ?? [];
}