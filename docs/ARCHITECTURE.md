# Architecture

A local-first browser application. There is no backend: every byte is read,
parsed, edited and written by code running in the page or in a Web Worker.

## Shape

```
src/
  App.tsx                    shell: layout, dialog switch, drag & drop, keyboard map
  index.css                  the entire design system (tokens, themes, components)
  components/                one file per surface; ui/primitives.tsx holds the kit
  lib/
    metadata/                binary codecs — the core of the product
      codecs/                id3, vorbis, flac, ogg, mp4, wav, ape, aiff, asf, comment-map
      binary.ts              ByteReader / ByteWriter / encoding helpers
      types.ts               MusicMetadata, FORMAT_CAPABILITIES, EXTENSION_MAP, formatters
      index.ts               readMetadata / writeMetadata / verifyWrite / detectFormat
    safe-write.ts            the only path to disk
    store/index.ts           one zustand store, sliced by concern
    workers/                 scan worker + the pool that drives it
    filesystem/              File System Access, drag & drop, local agent client
    search/ query.ts         the query language behind the search box
    text/                    cleanup operations and find & replace
    analysis/                duplicate detection, 21 validation rules
    artwork/                 transforms, thumbnails, object-URL cache
    providers/               MusicBrainz, Discogs, matching
    exports/ playlists/      CSV/JSON/M3U output, playlist files
    db/idb.ts                settings persistence
    scene/hero-gl.ts         the WebGL hero background
```

## Reading and writing metadata

`readMetadata(bytes, path)` sniffs the container from magic bytes — never from
the extension — and returns a `ScannedFile`:

```ts
{
  format, formatInfo, metadata, audio, artwork, raw, warnings, layout
}
```

`layout` is the important part: it records where the tag ended and the audio
began, plus any trailing tag (ID3v1, APEv2). Writers splice against `layout`,
so unmanaged frames and the audio payload are preserved rather than rebuilt.

`writeMetadata(original, path, current, target, options)` returns new bytes.
It takes the **complete** target metadata, not a delta — it rebuilds the
managed frames from what you give it. Callers merge first (the store does this
in `safeWriteFile`).

`verifyWrite(bytes, expected, path)` re-reads the result and reports which
fields did not survive. This is the safety net, not a formality: it is what
catches a container that quietly drops a field.

## Writing files

`safeWriteFile(file, pending, backups, options)` is the only function that
writes to disk. Its contract is that any failure leaves the original unchanged.
See the README for the five stages. The three commit paths are, in order of
preference: a File System Access handle, the local agent, and a download.

## Scanning

`src/lib/workers/scan-client.ts` runs a pool sized by `settings.workerCount`,
falling back to the main thread when `Worker` is unavailable or throws. Each
job is `{ id, path, source, hash }`; each result carries a `type: "result"`
discriminator.

Artwork is **counted but not loaded** during a scan (`artworkCount`), because
cloning megabytes of image data per file is what makes a large import crawl.
`ensureArtwork(fileId)` re-reads one file lazily when the UI actually needs the
pixels.

Rows are published to the table immediately on import, then folded in as
results arrive, batched onto animation frames so a 10k-file import does not
trigger 10k renders.

## State

One zustand store. Three normalisations matter:

- `files: Map<string, LibraryFile>` rather than an array, so a scan result is
  an O(1) set.
- `visibleIds: string[]` — the sorted, filtered id list components iterate.
- `pending: Map<string, PendingEdit>` — unsaved edits are stored per file
  *separately* from the record, so an edit never copies a whole metadata object.
  `recomputeVisible` mirrors the pending edit onto `LibraryFile.pending` so
  table cells can read it without subscribing to a second slice.

### A trap worth knowing about

Never write `useStore(selectorThatReturnsAFreshArray)`. `useSyncExternalStore`
compares snapshots by identity, so a selector that builds a new array on every
read re-renders forever. Use the memoised `useSelectedFiles()` hook; the raw
`selectSelectedFiles` selector exists for non-hook callers.

## Dialogs

There is one dialog slot in the store (`dialog` + `dialogPayload`) and a
`switch` in `App.tsx` that maps the name to a mounted component. Sidebar and
toolbar entries that need context prefix it — `collection:artists` — and
`openTool` splits it back off, so one slot can carry a payload without a second
piece of state.

## The hero background

`src/components/Scene3D.tsx` renders a WebGL raymarched stage
(`src/lib/scene/hero-gl.ts`) and falls back to a CSS 3D stage if a context
cannot be created. The shader is compiled at runtime, so a failure logs a
warning rather than throwing. Colours come from the `--accent` and `--chassis`
tokens, so the scene re-themes with the interface.

## Design system

`src/index.css` is the whole design system: a 7-step type scale, four themes
sharing one token contract, and a component layer (`.btn`, `.input`, `.surface`,
`.kbd`, …). Components never hardcode a colour — they use tokens, which is why
all four themes work without a component-level branch.
