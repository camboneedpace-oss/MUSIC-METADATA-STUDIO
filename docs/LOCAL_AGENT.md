# The local agent

Optional. The app is fully functional without it.

## Why it exists

Browsers deliberately restrict what a page can do to your files. The File
System Access API can write in place, but only after the user picks a directory
through a native dialog — there is no way to rename a file, no way to write
outside the granted folder, and nothing at all for files that arrived by drag
and drop.

The agent is a small local daemon that removes those limits: it can scan a
folder tree recursively, write a file back where it came from, rename it, and
create playlists.

## What it does not do

- It is **opt-in**. The app probes `127.0.0.1` on startup, shows the result in
  the footer, and works exactly the same if nothing answers.
- It never uploads anything. Lookup requests go to MusicBrainz and Discogs
  directly from the browser; the agent only touches the local filesystem.
- It is not required for tagging. Without it, saves either go through a File
  System Access handle or are handed back to you as a download.

## The three write modes

The footer and status bar report which one is active.

| Mode | When | Behaviour |
|---|---|---|
| `handle` | The folder picker is available | Writes in place through `FileSystemFileHandle` |
| `agent` | No picker, agent connected | Writes server-side, renames in place |
| `file` | Neither | No write access; saves are offered as downloads |

A download is never presented as a successful save. `SafeWriteResult` carries
`exportedAsDownload`, and the UI says so.

## Interface

`src/lib/filesystem/agent.ts` is the client. It exposes:

```ts
discover()                     // probe and report status
status()                       // current state
scan(path, options)            // recursive walk, returns entries
writeFile(path, bytes, backup) // atomic write, optional pre-write copy
rename(from, to)
createFolder(path)
playlist(path, entries, relative)
disconnect()
```

`AgentStatus` distinguishes `checking`, `connected`, `disconnected` and
`unavailable`, and carries a human-readable `detail` that the status bar shows
as-is — "This browser cannot reach the local agent" is more useful than an error
code.

## Backups and restore

With backups enabled, a pre-write copy is placed beside the file as
`<name>.bak` before the real write. The path is recorded on the library record
and in the history entry, and the History panel (`Ctrl+H`) offers **Restore**,
which reads the `.bak` back and writes it over the tagged file.

Restore needs the same access the save did. For files opened through a granted
directory it works in the browser; for everything else it says exactly why it
cannot rather than pretending to have queued the job.

## Writing one

Any local HTTP service that answers the calls above will work. It must:

- bind to loopback only — this has write access to your music,
- not require authentication to be useful on localhost,
- treat `writeFile` as atomic: write to a temporary file in the same directory,
  then rename over the target, so a crash mid-write cannot truncate a file.
