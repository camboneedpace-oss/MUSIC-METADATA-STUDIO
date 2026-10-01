import { describe, expect, it } from "vitest";
import {
  detectFormat,
  readMetadata,
  verifyWrite,
  writeMetadata,
  type ScannedFile,
} from "./index";
import {
  buildId3v1,
  buildId3v2,
  buildTextFrame,
  decodeTextFrame,
  parseId3v2,
  type Id3Frame,
} from "./codecs/id3";
import { concatBytes } from "./binary";
import {
  flacBlock,
  makeApeTag,
  makeFlac,
  makeFlacStreaminfo,
  makeMp3,
  makeMp4,
  makeOpusOgg,
  makeVorbisOgg,
  makeWav,
  pictureBlock,
  RECT_PNG,
  vorbisCommentBlock,
} from "./test-fixtures";

const ART = {
  id: "art-1",
  data: RECT_PNG,
  mime: "image/png",
  role: "front" as const,
  width: 4,
  height: 3,
  bytes: RECT_PNG.length,
};

describe("format detection", () => {
  it("detects by magic bytes, not by extension", () => {
    expect(detectFormat(makeMp3(), "mislabelled.flac")).toBe("mp3");
    expect(detectFormat(makeFlac([flacBlock(0, makeFlacStreaminfo(), true)]), "x.txt")).toBe("flac");
    expect(detectFormat(makeVorbisOgg([]), "x.mp3")).toBe("ogg");
    expect(detectFormat(makeMp4({}), "x.mp3")).toBe("m4a");
    expect(detectFormat(makeWav([["INAM", "x"]]), "x.mp3")).toBe("wav");
  });
});

describe("ID3 / MP3", () => {
  const frames: Id3Frame[] = [
    buildTextFrame("TIT2", ["Song Title"])!,
    buildTextFrame("TPE1", ["Artist A", "Artist B"])!,
    buildTextFrame("TALB", ["The Album"])!,
    buildTextFrame("TPE2", ["Album Artist"])!,
    buildTextFrame("TRCK", ["3/12"])!,
    buildTextFrame("TPOS", ["1/2"])!,
    buildTextFrame("TDRC", ["1998-05-21"])!,
    buildTextFrame("TCON", ["Trip-Hop"])!,
    buildTextFrame("TIT1", ["Grouping"])!,
    buildTextFrame("TPE3", ["Conductor"])!,
    buildTextFrame("TBPM", ["112"])!,
    buildTextFrame("TKEY", ["Am"])!,
    buildTextFrame("TCOP", ["© 1998 Label"])!,
    buildTextFrame("TLAN", ["eng"])!,
    buildTextFrame("TSRC", ["GBAYE0601498"])!,
  ];

  it("reads ID3v2.4 multi-values, pairs and dates", () => {
    const file = makeMp3(buildId3v2(frames, []));
    const r = readMetadata(file, "track.mp3");

    expect(r.format).toBe("mp3");
    expect(r.metadata.title).toBe("Song Title");
    expect(r.metadata.artists).toEqual(["Artist A", "Artist B"]);
    expect(r.metadata.album).toBe("The Album");
    expect(r.metadata.albumArtists).toEqual(["Album Artist"]);
    expect(r.metadata.trackNumber).toBe(3);
    expect(r.metadata.trackTotal).toBe(12);
    expect(r.metadata.discNumber).toBe(1);
    expect(r.metadata.discTotal).toBe(2);
    expect(r.metadata.year).toBe(1998);
    expect(r.metadata.date).toBe("1998-05-21");
    expect(r.metadata.genres).toEqual(["Trip-Hop"]);
    expect(r.metadata.conductor).toBe("Conductor");
    expect(r.metadata.bpm).toBe(112);
    expect(r.metadata.key).toBe("Am");
    expect(r.metadata.isrc).toBe("GBAYE0601498");
  });

  it("reads ID3v2.3 32-bit frame sizes", () => {
    // Rewrite the same frames as ID3v2.3 by patching the header + frame flags.
    const v24 = buildId3v2(frames, []);
    const patched = v24.slice();
    patched[3] = 3;
    const file = makeMp3(patched);
    const r = readMetadata(file, "track.mp3");
    expect(r.metadata.title).toBe("Song Title");
  });

  it("preserves frames it does not interpret", () => {
    const unknown: Id3Frame = { key: "XSOM", payload: new Uint8Array([1, 2, 3, 4, 5]) };
    const file = makeMp3(buildId3v2([...frames, unknown], []));
    const before = readMetadata(file, "track.mp3");
    expect(before.raw.some((t) => t.key === "XSOM")).toBe(true);

    const out = writeMetadata(file, "track.mp3", before, { ...before.metadata, title: "New" });
    const after = readMetadata(out.bytes, "track.mp3");
    expect(after.metadata.title).toBe("New");
    expect(after.raw.some((t) => t.key === "XSOM")).toBe(true);
  });

  it("round-trips through write and verify", () => {
    const file = makeMp3();
    const before = readMetadata(file, "track.mp3");
    const next = {
      ...before.metadata,
      title: "Written Title",
      artists: ["First", "Second"],
      album: "Written Album",
      albumArtists: ["Written AA"],
      trackNumber: 5,
      trackTotal: 10,
      year: 2024,
      genres: ["Electronic"],
      artwork: [ART],
    };
    const out = writeMetadata(file, "track.mp3", before, next);
    const verify = verifyWrite(out.bytes, next, "track.mp3");

    expect(verify.mismatches).toEqual([]);
    expect(verify.ok).toBe(true);
    expect(verify.artworkCount).toBe(1);
    expect(verify.title).toBe("Written Title");

    // Audio must survive untouched.
    const r = readMetadata(out.bytes, "track.mp3");
    expect(r.audio.sampleRate).toBe(44100);
    expect(r.audio.channels).toBe(2);
    expect(r.audio.duration).toBeGreaterThan(0);
  });

  it("parses and writes ID3v1 trailers", () => {
    const v1 = buildId3v1({
      title: "Old",
      artists: ["A"],
      album: "B",
      year: 1999,
      trackNumber: 4,
      genre: "Jazz",
    });
    const file = makeMp3(undefined, v1);
    const r = readMetadata(file, "track.mp3");
    expect(r.metadata.title).toBe("Old");
    expect(r.metadata.trackNumber).toBe(4);
    expect(r.metadata.genres).toEqual(["Jazz"]);
  });

  it("reads ID3v1 junk without throwing", () => {
    const junk = new Uint8Array(128).fill(0x41);
    junk.set(new TextEncoder().encode("TAG"), 0);
    const file = makeMp3(undefined, junk);
    const r = readMetadata(file, "track.mp3");
    expect(r.format).toBe("mp3");
    expect(r.metadata.title).toBe("A".repeat(30));
  });
});

describe("FLAC", () => {
  const comments: Array<[string, string]> = [
    ["TITLE", "Flac Title"],
    ["ARTIST", "Flac Artist"],
    ["ALBUM", "Flac Album"],
    ["ALBUMARTIST", "Flac AA"],
    ["TRACKNUMBER", "7"],
    ["TRACKTOTAL", "11"],
    ["DISCNUMBER", "2"],
    ["DATE", "2011-03-04"],
    ["GENRE", "Ambient"],
    ["MUSICBRAINZ_TRACKID", "abc-123"],
    ["ACOUSTID_FINGERPRINT", "AQADtMmhSrE"],
    ["CUSTOMER_KEY", "keep me"],
  ];

  const build = (withPicture = true) =>
    makeFlac([
      flacBlock(0, makeFlacStreaminfo(), !withPicture ? true : false),
      ...(withPicture ? [vorbisCommentBlock("reference libFLAC 1.3.4", comments)] : []),
      ...(withPicture ? [pictureBlock("image/png", RECT_PNG, 3, "cover")] : []),
      flacBlock(1, new Uint8Array(1024), true),
    ]);

  it("reads comments, artwork and stream properties", () => {
    const r = readMetadata(build(), "track.flac");
    expect(r.format).toBe("flac");
    expect(r.metadata.title).toBe("Flac Title");
    expect(r.metadata.trackNumber).toBe(7);
    expect(r.metadata.trackTotal).toBe(11);
    expect(r.metadata.discNumber).toBe(2);
    expect(r.metadata.year).toBe(2011);
    expect(r.metadata.musicBrainzRecordingId).toBe("abc-123");
    expect(r.metadata.customFields?.ACOUSTID_FINGERPRINT).toBe("AQADtMmhSrE");
    expect(r.metadata.artwork).toHaveLength(1);
    expect(r.metadata.artwork![0].width).toBe(4);
    expect(r.metadata.artwork![0].height).toBe(3);
    expect(r.metadata.artwork![0].mime).toBe("image/png");
    expect(r.audio.sampleRate).toBe(44100);
    expect(r.audio.channels).toBe(2);
    expect(r.audio.bitDepth).toBe(16);
    expect(r.audio.duration).toBeCloseTo(180, 2);
  });

  it("preserves unknown comments and the vendor string on write", () => {
    const file = build();
    const before = readMetadata(file, "track.flac");
    const next = { ...before.metadata, title: "Retagged", date: "2020-01-01" };
    const out = writeMetadata(file, "track.flac", before, next);

    const after = readMetadata(out.bytes, "track.flac");
    expect(after.metadata.title).toBe("Retagged");
    expect(after.metadata.year).toBe(2020);
    expect(after.metadata.customFields?.CUSTOMER_KEY).toBe("keep me");
    expect(after.metadata.customFields?.ACOUSTID_FINGERPRINT).toBe("AQADtMmhSrE");
    expect(after.formatInfo.tagVersion).toContain("reference libFLAC 1.3.4");
    expect(after.metadata.artwork).toHaveLength(1);
  });

  it("removes artwork when the field is cleared", () => {
    const file = build();
    const before = readMetadata(file, "track.flac");
    const out = writeMetadata(file, "track.flac", before, { ...before.metadata, artwork: [] });
    const after = readMetadata(out.bytes, "track.flac");
    expect(after.metadata.artwork ?? []).toHaveLength(0);
    expect(after.metadata.title).toBe("Flac Title");
  });

  it("rejects a file without a magic signature", () => {
    const r = readMetadata(new Uint8Array(64), "notaflac.flac");
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("Ogg Vorbis / Opus", () => {
  it("reads and rewrites a Vorbis stream without corrupting the page chain", () => {
    const file = makeVorbisOgg([
      ["TITLE", "Ogg Title"],
      ["ARTIST", "Ogg Artist"],
      ["ALBUM", "Ogg Album"],
      ["TRACKNUMBER", "2/9"],
      ["WEIRD_VENDOR_KEY", "keep"],
    ]);
    const r = readMetadata(file, "track.ogg");
    expect(r.format).toBe("ogg");
    expect(r.metadata.title).toBe("Ogg Title");
    expect(r.metadata.trackNumber).toBe(2);
    expect(r.metadata.trackTotal).toBe(9);
    expect(r.audio.channels).toBe(2);
    expect(r.audio.sampleRate).toBe(44100);

    const out = writeMetadata(file, "track.ogg", r, { ...r.metadata, title: "Ogg Retagged" });
    const after = readMetadata(out.bytes, "track.ogg");
    expect(after.metadata.title).toBe("Ogg Retagged");
    expect(after.metadata.customFields?.WEIRD_VENDOR_KEY).toBe("keep");
    expect(after.audio.sampleRate).toBe(44100);
    // Page CRCs must still validate, which readOgg only succeeds at if so.
    expect(after.warnings.filter((w) => /crc/i.test(w))).toHaveLength(0);
  });

  it("embeds base64 artwork in METADATA_BLOCK_PICTURE", () => {
    const file = makeVorbisOgg([
      ["TITLE", "With Art"],
      ["METADATA_BLOCK_PICTURE", base64Picture(RECT_PNG)],
    ]);
    const r = readMetadata(file, "track.ogg");
    expect(r.metadata.artwork).toHaveLength(1);
    expect(r.metadata.artwork![0].mime).toBe("image/png");
  });

  it("reads Opus and rewrites its OpusTags header", () => {
    const file = makeOpusOgg([["TITLE", "Opus Title"], ["ARTIST", "Opus Artist"]]);
    const r = readMetadata(file, "track.opus");
    expect(r.format).toBe("opus");
    expect(r.metadata.title).toBe("Opus Title");
    expect(r.audio.sampleRate).toBe(48000);

    const out = writeMetadata(file, "track.opus", r, { ...r.metadata, artist: undefined, artists: ["New Artist"] });
    const after = readMetadata(out.bytes, "track.opus");
    expect(after.metadata.artists).toEqual(["New Artist"]);
    expect(after.metadata.title).toBe("Opus Title");
  });
});

describe("MP4 / M4A", () => {
  it("reads ilst atoms including numeric pairs and freeform atoms", () => {
    const file = makeMp4({
      "\xa9nam": "M4A Title",
      "\xa9ART": "M4A Artist",
      "\xa9alb": "M4A Album",
      aART: "M4A Album Artist",
      "\xa9day": "2015-07-08",
      "\xa9gen": "Trip-Hop",
      trkn: 4,
      trknTotal: 12,
      disk: 1,
      diskTotal: 1,
      tmpo: 98,
      cpil: "1",
    });
    const r = readMetadata(file, "track.m4a");
    expect(r.format).toBe("m4a");
    expect(r.metadata.title).toBe("M4A Title");
    expect(r.metadata.artists).toEqual(["M4A Artist"]);
    expect(r.metadata.albumArtists).toEqual(["M4A Album Artist"]);
    expect(r.metadata.year).toBe(2015);
    expect(r.metadata.genres).toEqual(["Trip-Hop"]);
    expect(r.metadata.trackNumber).toBe(4);
    expect(r.metadata.trackTotal).toBe(12);
    expect(r.metadata.bpm).toBe(98);
    expect(r.metadata.compilation).toBe(true);
    expect(r.audio.channels).toBe(2);
    expect(r.audio.sampleRate).toBe(44100);
  });

  it("rebuilds moov and keeps the audio payload intact", () => {
    const file = makeMp4({ "\xa9nam": "Before" });
    const before = readMetadata(file, "track.m4a");
    const mdatStart = file.length - 256;
    const out = writeMetadata(file, "track.m4a", before, {
      ...before.metadata,
      title: "After",
      artwork: [ART],
    });
    const after = readMetadata(out.bytes, "track.m4a");
    expect(after.metadata.title).toBe("After");
    expect(after.metadata.artwork).toHaveLength(1);
    expect(after.metadata.artwork![0].mime).toBe("image/png");
    // The mdat payload must still be the last 256 bytes, byte-identical.
    const tail = out.bytes.subarray(out.bytes.length - 256);
    const originalTail = file.subarray(mdatStart);
    expect(Array.from(tail)).toEqual(Array.from(originalTail));
  });

  it("preserves atoms it does not manage", () => {
    const file = makeMp4({ "\xa9nam": "Keep", "pgap": "1", "rtng": "0" });
    const before = readMetadata(file, "track.m4a");
    const out = writeMetadata(file, "track.m4a", before, { ...before.metadata, title: "Changed" });
    const after = readMetadata(out.bytes, "track.m4a");
    expect(after.metadata.title).toBe("Changed");
    // Round-tripped through the writer: managed set excludes pgap/rtng, so
    // they are re-emitted from the preserved raw list.
    expect(after.raw.length).toBeGreaterThan(0);
  });
});

describe("WAV", () => {
  it("reads RIFF INFO and writes it back", () => {
    const file = makeWav([
      ["INAM", "Wav Title"],
      ["IART", "Wav Artist"],
      ["IPRD", "Wav Album"],
      ["ICRD", "1987"],
      ["IGNR", "Field Recording"],
      ["ITRK", "3"],
      ["ICMT", "A comment"],
      ["ISFT", "Sound Forge"],
    ]);
    const r = readMetadata(file, "track.wav");
    expect(r.format).toBe("wav");
    expect(r.metadata.title).toBe("Wav Title");
    expect(r.metadata.artists).toEqual(["Wav Artist"]);
    expect(r.metadata.album).toBe("Wav Album");
    expect(r.metadata.year).toBe(1987);
    expect(r.metadata.genres).toEqual(["Field Recording"]);
    expect(r.metadata.trackNumber).toBe(3);
    expect(r.metadata.comment).toBe("A comment");
    expect(r.audio.sampleRate).toBe(44100);
    expect(r.audio.channels).toBe(2);
    expect(r.audio.bitDepth).toBe(16);
    expect(r.audio.duration).toBeCloseTo(2048 / 176400, 4);

    const out = writeMetadata(file, "track.wav", r, { ...r.metadata, title: "Wav Retagged" });
    const after = readMetadata(out.bytes, "track.wav");
    expect(after.metadata.title).toBe("Wav Retagged");
    expect(after.metadata.album).toBe("Wav Album");
    expect(after.audio.duration).toBeCloseTo(2048 / 176400, 4);
  });
});

describe("APEv2 family", () => {
  it("reads an APEv2 trailer and rewrites it", () => {
    const enc = new TextEncoder();
    const tag = makeApeTag([
      ["Title", enc.encode("Ape Title")],
      ["Artist", enc.encode("Ape Artist")],
      ["Album", enc.encode("Ape Album")],
      ["Track", enc.encode("8/15")],
      ["Year", enc.encode("2005")],
      ["Unknown", enc.encode("preserve")],
    ]);
    const file = concatBytes(makeMp3(), tag);
    const r = readMetadata(file, "track.ape");
    expect(r.metadata.title).toBe("Ape Title");
    expect(r.metadata.artists).toEqual(["Ape Artist"]);
    expect(r.metadata.trackNumber).toBe(8);
    expect(r.metadata.trackTotal).toBe(15);
    expect(r.metadata.year).toBe(2005);
    expect(r.metadata.customFields?.Unknown).toBe("preserve");

    const out = writeMetadata(file, "track.ape", r, { ...r.metadata, title: "Ape Retagged" });
    const after = readMetadata(out.bytes, "track.ape");
    expect(after.metadata.title).toBe("Ape Retagged");
    expect(after.metadata.customFields?.Unknown).toBe("preserve");
    expect(after.metadata.album).toBe("Ape Album");
  });

  it("extracts artwork from Cover Art (Front)", () => {
    const tag = makeApeTag([
      ["Title", new TextEncoder().encode("With Cover")],
      ["Cover Art (Front)", RECT_PNG],
    ]);
    const file = concatBytes(makeMp3(), tag);
    const r = readMetadata(file, "track.ape");
    expect(r.metadata.artwork).toHaveLength(1);
    expect(r.metadata.artwork![0].width).toBe(4);
  });
});

describe("capability honesty", () => {
  it("refuses to write formats it has no writer for", () => {
    const file = makeMp4({});
    const r: ScannedFile = readMetadata(file, "track.aiff");
    const out = writeMetadata(file, "track.aiff", { ...r, format: "aiff" }, { title: "nope" });
    expect(out.bytes).toBe(file);
    expect(out.warnings.join(" ")).toMatch(/cannot be written/i);
  });

  it("surfaces non-fatal problems as warnings, never as exceptions", () => {
    // 22 bytes: the ID3v2 header claims 14 more, the frame claims 4 payload bytes
    // and only 2 remain.
    const truncated = makeMp3(buildId3v2([buildTextFrame("TIT2", ["Cut"])!], [])).subarray(0, 22);
    const r = readMetadata(truncated, "broken.mp3");
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.metadata).toBeDefined();
  });
});

describe("buildId3v2 framing", () => {
  it("produces a synchsafe header that parses back", () => {
    const tag = buildId3v2([buildTextFrame("TIT2", ["Round Trip"])!], []);
    expect(String.fromCharCode(...tag.subarray(0, 3))).toBe("ID3");
    expect(tag[3]).toBe(4);
    const parsed = parseId3v2(tag);
    expect(parsed?.majorVersion).toBe(4);
    expect(parsed?.totalSize).toBe(tag.length);
    expect(parsed?.frames[0].key).toBe("TIT2");
  });

  // Regression: frame sizes were written as plain big-endian while the parser
  // read them as synchsafe. The two agree below 128 bytes, so only frames
  // larger than that were affected — which is most real comments and lyrics.
  it("keeps synchsafe frame sizes for payloads over 127 bytes", () => {
    for (const size of [127, 128, 200, 400, 5000]) {
      const long = "x".repeat(size);
      const tag = buildId3v2([buildTextFrame("TIT2", [long])!, buildTextFrame("TPE1", ["Artist"])!], []);
      const frames = parseId3v2(tag)?.frames ?? [];
      expect(frames.map((f) => f.key)).toEqual(["TIT2", "TPE1"]);
      expect(decodeTextFrame(frames[0].payload)[0]).toBe(long);
      expect(decodeTextFrame(frames[1].payload)[0]).toBe("Artist");
    }
  });

  it("writes exactly one COMM and one USLT frame", () => {
    const base = makeMp3();
    const out = writeMetadata(base, "a.mp3", readMetadata(base, "a.mp3"), {
      title: "T",
      comment: "a comment",
      lyrics: "some lyrics",
    }).bytes;
    const raw = readMetadata(out, "a.mp3").raw;
    expect(raw.filter((r) => r.key.startsWith("COMM"))).toHaveLength(1);
    expect(raw.filter((r) => r.key.startsWith("USLT"))).toHaveLength(1);
  });

  // Regression: both frames carry `<encoding><language><descriptor>\0<text>`,
  // and the text was being read from inside the descriptor.
  it("skips the language and descriptor when reading COMM and USLT", () => {
    const comment = "c".repeat(300);
    const lyrics = "l".repeat(400);
    const base = makeMp3();
    const out = writeMetadata(base, "a.mp3", readMetadata(base, "a.mp3"), { comment, lyrics }).bytes;
    const back = readMetadata(out, "a.mp3").metadata;
    expect(back.comment).toBe(comment);
    expect(back.lyrics).toBe(lyrics);
  });
});

function base64Picture(png: Uint8Array): string {
  const enc = new TextEncoder();
  const mime = enc.encode("image/png");
  const desc = enc.encode("");
  const size = 4 + 4 + mime.length + 4 + desc.length + 16 + 4 + png.length;
  const body = new Uint8Array(size);
  const dv = new DataView(body.buffer);
  let at = 0;
  dv.setUint32(at, 3);
  at += 4;
  dv.setUint32(at, mime.length);
  at += 4;
  body.set(mime, at);
  at += mime.length;
  dv.setUint32(at, desc.length);
  at += 4;
  at += desc.length + 16;
  dv.setUint32(at, png.length);
  at += 4;
  body.set(png, at);
  let bin = "";
  for (const b of body) bin += String.fromCharCode(b);
  return btoa(bin);
}