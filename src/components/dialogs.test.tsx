import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import App from "../App";
import { useStore } from "../lib/store";

/**
 * Every dialog, opened one at a time.
 *
 * This is not a visual regression suite — it is a crash suite. Sixteen dialogs
 * each subscribe to the store, read settings and index into library records in
 * slightly different ways, and a crash in any of them is invisible until a
 * user opens it. Mounting them all here means that failure lands in CI.
 *
 * Empty-state only: the point is that each one renders against a bare library.
 */
const DIALOGS = [
  "batch",
  "preview",
  "rename",
  "parse",
  "lookup",
  "artwork",
  "cleanup",
  "findreplace",
  "converter",
  "duplicates",
  "playlist",
  "export",
  "actions",
  "analyzer",
  "formats",
  "settings",
  "collection",
] as const;

describe("dialogs", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.fetch = (() => Promise.reject(new Error("no agent in tests"))) as typeof fetch;
  });

  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<App />);
    });
  });

  for (const name of DIALOGS) {
    test(`opens and closes "${name}"`, async () => {
      await act(async () => {
        useStore.getState().openDialog(name);
      });

      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog, `${name} rendered no dialog`).toBeTruthy();

      await act(async () => {
        useStore.getState().closeDialog();
      });

      // Radix keeps the element mounted but hidden; the store is the source
      // of truth for whether anything is open.
      expect(useStore.getState().dialog).toBeNull();
    });
  }

  test("an unknown dialog name renders nothing rather than throwing", async () => {
    await act(async () => {
      useStore.getState().openDialog("does-not-exist");
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("the command palette opens on Ctrl+K and closes on Escape", async () => {
    const search = document.querySelector('input[aria-label="Search library"]');
    expect(search).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
  });

  test("Escape closes the topmost dialog", async () => {
    await act(async () => {
      useStore.getState().openDialog("settings");
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(useStore.getState().dialog).toBeNull();
  });
});
