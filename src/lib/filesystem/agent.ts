/**
 * Local agent client.
 *
 * The agent is an optional companion service the user runs themselves on
 * localhost. It exists because browsers cannot rename files, create folders
 * next to them, write atomically with backups, or scan a 100k-file tree
 * without a user gesture per directory.
 *
 * Security posture (see docs/SECURITY.md):
 *  - We only ever talk to http://127.0.0.1:<port> / localhost.
 *  - The agent issues a shared token on first contact; every request carries it.
 *  - We never accept an agent URL from a remote origin, and we never relay a
 *    request to any host other than the configured one.
 *  - The agent is expected to validate the `Origin` header itself; we always
 *    send one so it can.
 */

const DEFAULT_PORTS = [7331, 7332, 7333];
const REQUEST_TIMEOUT_MS = 15_000;

export interface AgentInfo {
  name: string;
  version: string;
  capabilities: string[];
  /** Root directories the user granted the agent. */
  roots: string[];
  /** True when the agent verified our origin and token. */
  authenticated: boolean;
}

export interface AgentScanEntry {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
  format: string;
}

export type AgentStatus =
  | { state: "checking" }
  | { state: "connected"; info: AgentInfo; baseUrl: string }
  | { state: "disconnected"; detail: string }
  | { state: "unsupported" };

/**
 * `FileSystemHandle` values cannot be structured-cloned, so the store keeps
 * the handles in a side map and the agent client only ever deals with paths.
 */
export class AgentClient {
  private baseUrl: string | null = null;
  private token: string | null = null;
  private origin = typeof location !== "undefined" ? location.origin : "null";

  /** Probe the well-known local ports. Cheap, and only on demand or startup. */
  async discover(): Promise<AgentStatus> {
    for (const port of DEFAULT_PORTS) {
      const base = `http://127.0.0.1:${port}`;
      try {
        const info = await this.request<AgentInfo>(base, "/api/v1/info", undefined, 1200);
        if (info && info.name) {
          this.baseUrl = base;
          return { state: "connected", info, baseUrl: base };
        }
      } catch {
        // Port closed: try the next one.
      }
    }
    return {
      state: "disconnected",
      detail: "No agent answered on 127.0.0.1:7331–7333. Start it to enable recursive scanning, atomic writes and renames.",
    };
  }

  get connected(): boolean {
    return this.baseUrl !== null;
  }

  get endpoint(): string | null {
    return this.baseUrl;
  }

  async status(): Promise<AgentStatus> {
    if (!this.baseUrl) return { state: "disconnected", detail: "Not connected" };
    try {
      const info = await this.request<AgentInfo>(this.baseUrl, "/api/v1/info");
      return { state: "connected", info, baseUrl: this.baseUrl };
    } catch (err) {
      this.baseUrl = null;
      return { state: "disconnected", detail: (err as Error).message };
    }
  }

  private async request<T>(
    base: string,
    path: string,
    body?: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: this.origin,
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Agent returned ${response.status} ${response.statusText}`);
      }
      const text = await response.text();
      if (!text) return undefined as T;
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Scan a root directory the agent has been given access to. */
  async scan(
    root: string,
    onProgress?: (found: number) => void,
    signal?: AbortSignal,
  ): Promise<AgentScanEntry[]> {
    if (!this.baseUrl) throw new Error("No local agent is connected");
    const controller = new AbortController();
    signal?.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      const result = await this.request<{ entries: AgentScanEntry[]; scanned: number }>(
        this.baseUrl,
        "/api/v1/scan",
        { root },
        120_000,
      );
      onProgress?.(result.scanned ?? result.entries.length);
      return result.entries;
    } finally {
      controller.abort();
    }
  }

  /** Write bytes to a path, with the agent handling backup + atomic replace. */
  async writeFile(path: string, data: Uint8Array, backup: boolean): Promise<{ backupPath?: string }> {
    if (!this.baseUrl) throw new Error("No local agent is connected");
    return this.request(this.baseUrl, "/api/v1/write", {
      path,
      backup,
      data: Array.from(data),
    }, 120_000);
  }

  async rename(from: string, to: string): Promise<void> {
    if (!this.baseUrl) throw new Error("No local agent is connected");
    await this.request(this.baseUrl, "/api/v1/rename", { from, to });
  }

  async createFolder(path: string): Promise<void> {
    if (!this.baseUrl) throw new Error("No local agent is connected");
    await this.request(this.baseUrl, "/api/v1/mkdir", { path });
  }

  async playlist(path: string, entries: string[], relative: boolean): Promise<void> {
    if (!this.baseUrl) throw new Error("No local agent is connected");
    await this.request(this.baseUrl, "/api/v1/playlist", { path, entries, relative });
  }

  /** Tell the agent we are done; it can drop our token. */
  async disconnect(): Promise<void> {
    if (this.baseUrl && this.token) {
      try {
        await this.request(this.baseUrl, "/api/v1/disconnect", {});
      } catch {
        // The agent may already be gone; nothing to clean up.
      }
    }
    this.baseUrl = null;
    this.token = null;
  }
}

export const agentClient = new AgentClient();

export const AGENT_CAPABILITIES: Array<{ id: string; label: string; detail: string }> = [
  { id: "scan", label: "Recursive folder scanning", detail: "Walk a 100k-file tree without a browser gesture per folder." },
  { id: "write", label: "Direct file writing", detail: "Write tags into files you opened through the picker." },
  { id: "atomic", label: "Atomic writes", detail: "Write to a temporary file, verify, then rename over the original." },
  { id: "backup", label: "Backups", detail: "Keep the original alongside before the first write." },
  { id: "rename", label: "Renaming and folders", detail: "Rename in place and create the folders a template asks for." },
  { id: "playlist", label: "Playlist writing", detail: "Write M3U files next to the music." },
];