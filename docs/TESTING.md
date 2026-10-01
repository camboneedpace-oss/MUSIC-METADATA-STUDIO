# Testing

```bash
bun run test        # the whole suite
bunx vitest run src/lib/metadata   # one area
```

Use `bun run test`, not `bun test`. The suite runs under Vitest with
`happy-dom`; Bun's own runner has no DOM and fails on anything that renders.

## What the suite is for

The codecs are the product, and a wrong byte offset does not throw — it returns
plausible-looking nonsense. So the tests are built around **round trips through
real binary layouts**, not mocks.

`src/lib/metadata/test-fixtures.ts` constructs genuine containers byte by byte:
ID3v2 tags with syncsafe frame headers, FLAC metadata blocks, Ogg pages, MP4
atoms. Tests then parse them back, which is the only way to catch an encoding
mistake before it reaches a user's music.

## Coverage

| Area | File | Tests |
|---|---|---|
| Metadata codecs | `src/lib/metadata/metadata.test.ts` | 26 |
| Safe write | `src/lib/safe-write.test.ts` | 19 |
| Store | `src/lib/store/store.test.ts` | 13 |
| Dialogs | `src/components/dialogs.test.tsx` | 20 |
| App shell | `src/components/App.test.tsx` | 1 |
| Scan worker pool | `src/lib/workers/scan-client.test.ts` | 9 |
| Text cleanup | `src/lib/text/cleanup.test.ts` | 27 |
| Duplicate detection | `src/lib/analysis/duplicates.test.ts` | 19 |
| Filename templates | `src/lib/filename/filename.test.ts` | 19 |
| Query language | `src/lib/search/query.test.ts` | 12 |
| Providers | `src/lib/providers/providers.test.ts` | 41 |
| Artwork | `src/lib/artwork/artwork.test.ts` | 29 |

## The rollback guarantee

`safe-write.test.ts` is the one suite that matters most, because its subject is
the promise the product makes: **a failed write leaves the original file
byte-identical.**

It installs a fake File System Access handle that records every byte handed to
`close()`, then asserts the recording is empty after each failure mode:

- validation rejects the write,
- the file is over the in-memory rewrite limit,
- read-back verification fails,
- the platform declines write permission,
- the write fails on disk mid-commit.

A success-path test asserts the opposite: exactly one write, correct tags, and
unmanaged fields preserved.

## Dialog tests are a crash suite, not a visual one

`dialogs.test.tsx` opens all seventeen dialogs one at a time against an empty
library and asserts each renders a `role="dialog"`. It cannot tell you a dialog
looks wrong — it tells you a dialog throws, which is otherwise invisible until
a user opens it. Treat a failure here as a real regression, not a flaky test.

## Bugs this suite has already caught

Kept as regression tests, because each was invisible in normal use:

- **ID3 frame sizes were written as plain big-endian** while the parser read
  them as synchsafe. The two encodings agree below 128 bytes, so every small
  tag worked and every frame larger than that was corrupted — which is most
  real comments, lyrics and artwork.
- **Duplicate `COMM` and `USLT` frames.** Both were in the generic field map
  *and* written again with the correct layout, so every MP3 save produced two
  of each: one malformed, one right.
- **`COMM`/`USLT` were read from the wrong offset**, inside the language and
  descriptor rather than after them. Long comments came back two characters
  short; lyrics came back empty.
- **The artwork object-URL cache was written under one key and read under
  another**, so nothing was ever reused and every render leaked a blob URL.

## Known gaps

- No visual or snapshot testing. A per-dialog layout regression will not be
  caught.
- No end-to-end browser run: the suite renders under `happy-dom`, not a real
  engine. The WebGL hero is verified by compiling its shader with `glslang` and
  by simulating its SDF in JS, not by rendering it.
- `filesystem/agent.ts`, `db/idb.ts`, `exports/` and `playlists/` have no
  dedicated suites.
- Provider tests cover query construction, response mapping, matching and the
  transport policy, but never hit the network.
