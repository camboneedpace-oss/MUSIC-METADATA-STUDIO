# Providers

Two online sources sit behind one interface, so the UI never knows which service
produced a result and adding a third is a single file.

## The contract

```ts
interface MetadataProvider {
  readonly id: string;
  readonly label: string;
  readonly requiresCredentials: boolean;
  search(query: MetadataQuery): Promise<Release[]>;
  getRelease(id: string): Promise<Release | null>;
  getArtwork(id: string): Promise<ArtworkCandidate[]>;
  health?(): Promise<ProviderHealth>;
}
```

## MusicBrainz

- **Search**: `/ws/2/release`, with a Lucene query built by `buildLucene`.
  Artist + album combine into one clause; artist + title search `recording`; a
  barcode or catalog number searches alone. Values are quoted, and quotes,
  backslashes and bare `AND`/`OR`/`NOT` are stripped so a tag cannot escape
  into the query language.
- **Full release**: `/ws/2/release/{mbid}?inc=recordings+artist-credits+labels`,
  which flattens every medium into one track list carrying `discNumber`.
- **Cover art**: the Cover Art Archive. `coverArtUrls()` offers the 500px and
  1200px front covers; `getArtwork()` returns every image with its type,
  dimensions and approval flag.

Multi-artist credits are joined with their MusicBrainz join phrases, so
`David Bowie & Peter Gabriel & Phil Collins` round-trips correctly.

MusicBrainz asks for a meaningful User-Agent and limits anonymous clients to
one request per second. `RateLimiter(1100)` is exactly that.

## Discogs

Discogs requires a personal access token for most endpoints. Without one the
provider reports `requiresCredentials: true` and the UI says so rather than
failing on click.

## Matching

`matchFileToRelease` scores a local file against a release using signals of very
different reliability. The weights encode that:

| Signal | Weight | Note |
|---|:--:|---|
| Barcode | 6 | Near proof of identity |
| Catalog number | 4 | Normalised, so `CDS 74642` == `CDS-74642` |
| Artist | 3 | Token-set + Levenshtein blend |
| Album, Track title | 2.5 | Same similarity function |
| Track number | 2 | Position within the release |
| Year | 1.5 | Exact, ±1 year, else a weak score |
| Duration | 1.5 | ±3s |
| Track / disc count | 1 | |

A missing signal scores 0.5 — "not available", not "wrong" — so a sparse local
tag does not tank an otherwise obvious match.

String similarity strips case, punctuation and leading articles
(`the`, `a`, `an`, `and`, `of`, `in`, `on`), then blends token-set overlap with
normalised edit distance. It scores Cyrillic and CJK correctly rather than
collapsing them to empty strings.

Two things it will not do:

- **It never writes.** A match is a suggestion the user accepts field by field.
- **It blocks on conflict.** Differing barcodes raise a blocker — almost
  certainly a different pressing — regardless of how high the score is.

`matchAlbum` matches a whole release at once and averages per-file confidence;
a 10-of-10 track match is far stronger evidence than any single file.

## Transport policy

`withRetry` retries 5xx and 429 with exponential backoff (400ms, 800ms, capped
at 4s) and does **not** retry a 4xx that will never succeed. `RateLimiter`
serialises calls with a minimum interval and keeps running after a rejected
task, so one failure cannot wedge the queue.

`ProviderError` carries `status` and `retryAfter`, which the UI surfaces
verbatim — "MusicBrainz is rate-limiting this client" is more useful than a
generic failure.
