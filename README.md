# Universal Music Metadata Studio

A professional music tag editor and library manager that runs entirely in the
browser. Point it at a folder and it parses every container from scratch,
gives you a spreadsheet-grade editing surface, and writes changes back safely —
with verification, backups and a full undo history.

Every binary codec in this repository is hand-written. There is no
`music-metadata`, no `taglib`, no `mp4box`: `src/lib/metadata/codecs/` contains
the ID3v2.2/3/4, Vorbis Comment, FLAC block, MP4 `ilst`, RIFF `INFO`, AIFF,
APEv2 and ASF parsers and writers directly.

## What it does

- **Real binary codecs** — 28 containers, labelled honestly. 18 are read *and*
  written; 8 are read-only; 3 are listed but not yet parsed. Formats with no
  writer are never silently re-encoded — you get an export instead.
- **Verified writes** — every save is re-parsed in memory and compared against
  the intended metadata *before* the file is replaced. A failed verification
  leaves the original byte-identical.
- **Batch automation** — chained action groups, 21-operation cleanup
  pipelines, find & replace and smart renames. Each run lands as one undo step.
- **Online lookup** — MusicBrainz and Discogs behind one provider interface,
  with weighted matching, cover art from the Cover Art Archive, and a per-field
  preview before anything is applied.
- **Library analysis** — duplicate detection by tag signature and audio
  fingerprint, 21 validation rules, and a format matrix that states exactly what
  this build can do.
- **Local-first** — your files never leave the machine unless you explicitly run
  a lookup. Settings live in IndexedDB; the optional local agent is opt-in.

## Running it

```bash
bun install
bun run dev        # http://localhost:5173
```

Other scripts:

```bash
bun run typecheck  # tsc -b --noEmit
bun run test       # vitest run
bun run build      # vite build
```

Use `bun run test`, not `bun test` — the suite runs under Vitest with
`happy-dom`, and Bun's own runner has no DOM.

## How it writes files

`src/lib/safe-write.ts` is the only path to disk, and it exists to enforce one
rule: **a failed write must leave the original file byte-identical.**

1. validate the metadata against the target format,
2. serialise the whole file in memory,
3. re-read the serialised bytes and verify the tags came back,
4. optionally write a `.bak` beside the file,
5. commit through a File System Access handle, the local agent, or — if the
   browser gave no write access at all — hand you a correct download.

Steps 1–3 happen entirely in memory. Nothing on disk is touched until the new
bytes have proved they parse. Backups are recorded in the History panel
(`Ctrl+H`), which is also where a save can be rolled back.

If you opened files with the folder picker, changes are written in place. If you
dropped individual files or picked them one by one, the browser only grants
read access, so saves are offered as downloads rather than silently failing.

## Keyboard

| | |
|---|---|
| `Ctrl+O` | Open a folder |
| `Ctrl+Shift+O` | Add individual files |
| `Ctrl+S` | Save pending changes |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+F` | Focus search |
| `Ctrl+K` | Command palette |
| `Ctrl+H` | Toggle history |
| `Ctrl+I` | Toggle inspector |
| `Ctrl+A` | Select all visible |
| `Delete` | Discard selected edits |
| `F2` | Edit the focused row |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — how the pieces fit together
- [Metadata formats](docs/METADATA_FORMATS.md) — what each container supports
- [Testing](docs/TESTING.md) — what the suite covers and what it does not
- [Providers](docs/PROVIDER_API.md) — MusicBrainz and Discogs
- [Local agent](docs/LOCAL_AGENT.md) — the optional write-back daemon

## Licence

AGPL-3.0.
