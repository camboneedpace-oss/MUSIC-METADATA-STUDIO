# Metadata formats

This table is generated from `FORMAT_CAPABILITIES` in `src/lib/metadata/types.ts`
and is the same data the Formats dialog shows in the app. If the two ever
disagree, the source is the truth.

Legend: **rw** read and written in place · **r** read only · **—** listed but
not parsed.

| Format | | Art | Chapters | Lyrics | Multi | Lossless | Notes |
|---|---|:--:|:--:|:--:|:--:|:--:|---|
| `mp3` | rw | ✓ | ✓ | ✓ | ✓ | | ID3v1, ID3v2.2/3/4 with APIC, USLT, TXXX, COMM, UFID, RVA2 |
| `aac` | rw | — | — | ✓ | — | | ADTS/ADIF ID3v2. No artwork container on raw AAC |
| `m4a` | rw | ✓ | ✓ | ✓ | ✓ | | MP4 `ilst`: ©nam ©ART ©alb aART trkn disk covr ©day ©gen |
| `m4b` | rw | ✓ | ✓ | ✓ | ✓ | | Audiobook MP4, same mapping as M4A |
| `mp4` | rw | ✓ | ✓ | ✓ | ✓ | | Video MP4, audio metadata from the `ilst` |
| `ogg` | rw | ✓ | — | ✓ | ✓ | | Vorbis Comment header, `METADATA_BLOCK_PICTURE` base64 |
| `opus` | rw | ✓ | — | ✓ | ✓ | | OpusComment header, same key set as Vorbis Comment |
| `spx` | rw | ✓ | — | — | ✓ | | Speex header, no standardised lyrics frame |
| `flac` | rw | ✓ | — | ✓ | ✓ | ✓ | Vorbis Comment + `METADATA_BLOCK_PICTURE` + CUESHEET |
| `alac` | rw | ✓ | ✓ | ✓ | ✓ | ✓ | ALAC in MP4, `ilst` atoms, lossless PCM |
| `wav` | rw | — | — | — | — | ✓ | RIFF `INFO` chunks (INAM/IART/IPRD…), lyrics via optional `id3 ` chunk |
| `aiff` | r | — | — | — | — | ✓ | FORM/ID3 chunk read; no writer yet |
| `aif` | r | — | — | — | — | ✓ | Alias for AIFF |
| `aifc` | r | — | — | — | — | ✓ | Compressed AIFF variant |
| `ape` | rw | ✓ | — | — | — | ✓ | APEv2 block before or after the audio; no lyric frame |
| `wma` | r | ✓ | — | — | — | | ASF extended content description read; writer not implemented |
| `mpc` | rw | ✓ | — | — | ✓ | | Musepack SV7 APEv2 tag (Hybrid variants exist) |
| `wv` | rw | ✓ | — | — | ✓ | ✓ | WavPack APEv2 tag |
| `tta` | rw | ✓ | — | — | ✓ | ✓ | Reads both ID3 and APEv2 |
| `tak` | r | ✓ | — | — | — | ✓ | TAK APEv2 read; writer not implemented |
| `ofr` | rw | ✓ | — | — | ✓ | ✓ | OptimFROG APEv2 tag |
| `ofs` | rw | ✓ | — | — | ✓ | ✓ | OptimFROG APEv2 tag |
| `wvp` | rw | ✓ | — | — | ✓ | ✓ | WavPack variant id |
| `dsf` | r | — | — | — | — | ✓ | DSD stream file, ID3v2 at head; writer not implemented |
| `dff` | r | — | — | — | — | ✓ | DSDIFF container; writer not implemented |
| `mkv` | — | — | ✓ | — | — | | Video container, audio-only tag path |
| `mka` | — | — | — | — | — | | Matroska audio, not yet supported |
| `webm` | — | — | — | — | — | | WebM audio, not yet supported |

**Totals: 18 read + write, 8 read-only, 3 listed only.**

## Rules the codecs follow

- **Detection is by magic bytes**, never by extension. A `.flac` that is
  actually an MP3 is reported as an MP3.
- **Writers preserve what they do not manage.** The tag layout recorded at read
  time is spliced against, so unmanaged frames, cue sheets, chapter tables and
  the audio payload survive a rewrite.
- **Nothing is silently dropped.** If a container cannot store a field,
  `validateForWrite` refuses the write (artwork, NUL in a multi-value field) or
  returns a warning the UI shows before saving (lyrics, extra values, control
  characters).
- **Read-only formats are never re-encoded.** You get an export instead.

## Byte-order notes

Easy to get wrong, and getting it wrong produces plausible-looking garbage:

- Vorbis comments, APEv2, RIFF and MP4 lengths are **little-endian**.
- MP4 atom names are raw latin1 bytes: `©nam` is `0xA9` followed by `nam`, not
  the character `©` in some encoding.
- ID3v2.4 frame sizes are **syncsafe** — seven bits per byte. ID3v2.2/3 frame
  sizes are plain 32-bit. `ByteWriter.synchsafe()` exists for this; writing a
  plain `u32` happens to agree below 128 bytes and silently corrupts every
  larger frame.
- ID3 `COMM` and `USLT` payloads are
  `<encoding><language:3><descriptor>\0<text>`, where the descriptor
  terminator is a single NUL for single-byte encodings and a `00 00` pair for
  UTF-16.

## Artwork by container

- **MP4 `covr`** accepts JPEG and PNG only. WebP is rejected before the write,
  not after — `isArtworkMimeSupported("mp4", "image/webp")` returns false.
- **ID3 (APIC)** and **Vorbis/FLAC pictures** accept any recognisable image type.
- Covers are transformed (crop, resize, re-encode) before embedding; the
  original bytes are kept whenever the browser cannot decode the image, and the
  result carries a warning saying so.
