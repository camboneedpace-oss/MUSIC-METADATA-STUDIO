import { beforeEach, describe, expect, test } from "vitest";
import { useStore } from "./index";
import {
  flacBlock,
  makeFlac,
  makeFlacStreaminfo,
  makeMp3,
  pictureBlock,
  RECT_PNG,
  vorbisCommentBlock,
} from "../metadata/test-fixtures";
import { buildId3v2, buildTextFrame } from "../metadata/codecs/id3";

function mp3(title: string, artist = "Artist"): Uint8Array {
  return makeMp3(
    buildId3v2(
      [buildTextFrame("TIT2", [title])!, buildTextFrame("TPE1", [artist])!],
      [],
    ),
  );
}

function flac(title: string, withArt = false): Uint8Array {
  const blocks = [
    flacBlock(0, makeFlacStreaminfo(), false),
    vorbisCommentBlock("test", [["TITLE", title]]),
    ...(withArt ? [pictureBlock("image/png", RECT_PNG, 3, "cover")] : []),
    flacBlock(1, new Uint8Array(64), true),
  ];
  return makeFlac(blocks);
}

function collection(name: string, bytes: Uint8Array) {
  const file = new File([bytes.slice()], name);
  return {
    file,
    path: name,
    folder: "Artist/Album",
    name,
    size: file.size,
    modifiedAt: file.lastModified,
  };
}

describe("import", () => {
  beforeEach(() => {
    useStore.setState({ files: new Map(), order: [], pending: new Map(), selection: { set: new Set(), anchor: null, lastClicked: null } });
  });

  test("addFiles populates the library and the visible list", async () => {
    await useStore.getState().addFiles([collection("one.mp3", mp3("One")), collection("two.mp3", mp3("Two"))]);

    const state = useStore.getState();
    expect(state.files.size).toBe(2);
    expect(state.visibleIds).toHaveLength(2);

    const titles = state.order.map((id) => state.files.get(id)?.metadata.title).sort();
    expect(titles).toEqual(["One", "Two"]);
    expect([...state.files.values()].every((f) => f.tagStatus === "clean")).toBe(true);
  });

  test("mixed formats land with the right tag scheme", async () => {
    await useStore.getState().addFiles([
      collection("a.mp3", mp3("Mp3 Title")),
      collection("b.flac", flac("Flac Title")),
    ]);
    const byName = new Map([...useStore.getState().files.values()].map((f) => [f.name, f]));
    expect(byName.get("a.mp3")?.tagScheme).toContain("ID3");
    expect(byName.get("b.flac")?.tagScheme).toContain("Vorbis");
  });

  test("unreadable files are recorded as errors, not dropped", async () => {
    await useStore.getState().addFiles([collection("junk.bin", new Uint8Array([0, 1, 2, 3]))]);
    expect(useStore.getState().files.size).toBe(1);
    const file = [...useStore.getState().files.values()][0];
    expect(file.tagStatus).toBe("error");
    expect(file.error).toBeTruthy();
  });

  test("an untagged file of a known type is clean, not broken", async () => {
    await useStore.getState().addFiles([collection("silent.mp3", new Uint8Array(0))]);
    expect([...useStore.getState().files.values()][0].tagStatus).toBe("clean");
  });

  test("the scan overlay clears when the run finishes", async () => {
    await useStore.getState().addFiles([collection("one.mp3", mp3("One"))]);
    const state = useStore.getState();
    expect(state.scanning).toBe(false);
    expect(state.scan.active).toBe(false);
  });

  test("artwork is counted during import but not loaded", async () => {
    await useStore.getState().addFiles([collection("art.flac", flac("With art", true))]);
    const file = [...useStore.getState().files.values()][0];
    expect(file.artworkCount).toBe(1);
    expect(file.metadata.artwork).toBeUndefined();
  });

  test("ensureArtwork pulls the image back on demand, once", async () => {
    await useStore.getState().addFiles([collection("art.flac", flac("With art", true))]);
    const id = useStore.getState().order[0];

    await useStore.getState().ensureArtwork(id);
    const file = useStore.getState().files.get(id);
    expect(file?.metadata.artwork).toHaveLength(1);
    expect(file?.metadata.artwork?.[0].mime).toBe("image/png");

    // A second call is a no-op, not a re-read.
    const again = useStore.getState().files.get(id)?.metadata.artwork;
    await useStore.getState().ensureArtwork(id);
    expect(useStore.getState().files.get(id)?.metadata.artwork).toBe(again);
  });

  test("ensureArtwork does nothing for a file with no artwork", async () => {
    await useStore.getState().addFiles([collection("plain.flac", flac("Plain"))]);
    const id = useStore.getState().order[0];
    await useStore.getState().ensureArtwork(id);
    expect(useStore.getState().files.get(id)?.metadata.artwork).toBeUndefined();
  });
});

describe("rescan", () => {
  beforeEach(() => {
    useStore.setState({ files: new Map(), order: [], pending: new Map(), selection: { set: new Set(), anchor: null, lastClicked: null } });
  });

  test("rescan picks up tags that changed on disk", async () => {
    await useStore.getState().addFiles([collection("one.mp3", mp3("Before"))]);
    const id = useStore.getState().order[0];

    // Same path, different bytes.
    const retagged = mp3("After");
    const file = useStore.getState().files.get(id)!;
    file.file = new File([retagged.slice()], file.name);

    await useStore.getState().rescan();
    expect(useStore.getState().files.get(id)?.metadata.title).toBe("After");
    expect(useStore.getState().files.get(id)?.onDisk.title).toBe("After");
  });

  test("rescan keeps unsaved edits on top of what is on disk", async () => {
    await useStore.getState().addFiles([collection("one.mp3", mp3("Original"))]);
    const id = useStore.getState().order[0];
    useStore.getState().applyEdits([{ fileId: id, changes: { title: "My Edit" } }], "Rename");

    const file = useStore.getState().files.get(id)!;
    file.file = new File([mp3("Changed On Disk").slice()], file.name);

    await useStore.getState().rescan();
    const after = useStore.getState().files.get(id);
    expect(after?.metadata.title).toBe("My Edit");
    expect(after?.onDisk.title).toBe("Changed On Disk");
    expect(after?.dirty).toBe(true);
  });

  test("rescan on an empty library is a no-op with a message", async () => {
    await useStore.getState().rescan();
    expect(useStore.getState().toasts.at(-1)?.message).toBe("Nothing to rescan");
  });
});

describe("search", () => {
  beforeEach(() => {
    useStore.setState({ files: new Map(), order: [], pending: new Map(), query: "", selection: { set: new Set(), anchor: null, lastClicked: null } });
  });

  test("the field query language the search box advertises actually filters", async () => {
    await useStore.getState().addFiles([
      collection("one.mp3", mp3("Xtal", "Aphex Twin")),
      collection("two.mp3", mp3("Windowlicker", "Aphex Twin")),
    ]);

    useStore.getState().setQuery('artist:"Aphex Twin"');
    expect(useStore.getState().visibleIds).toHaveLength(2);

    useStore.getState().setQuery('artist:"Boards of Canada"');
    expect(useStore.getState().visibleIds).toHaveLength(0);

    useStore.getState().setQuery("xtal");
    expect(useStore.getState().visibleIds).toHaveLength(1);
  });

  test("views filter on the same derived list", async () => {
    await useStore.getState().addFiles([collection("one.flac", flac("One"))]);
    const complete = [...useStore.getState().files.values()][0];
    // The FLAC fixture has a title but no album, so it belongs in the gap view.
    expect(complete.metadata.album).toBeUndefined();
    useStore.getState().setView("missing-metadata");
    expect(useStore.getState().visibleIds).toHaveLength(1);

    useStore.getState().applyEdits(
      [{ fileId: complete.id, changes: { album: "Now Complete", artists: ["Someone"] } }],
      "fill",
    );
    expect(useStore.getState().visibleIds).toHaveLength(0);

    useStore.getState().setView("all");
    expect(useStore.getState().visibleIds).toHaveLength(1);
  });
});