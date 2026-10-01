import { beforeAll, describe, expect, test } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import App from "../App";

/**
 * A full render of the shell. This is deliberately not a UI test — it exists
 * to fail loudly when a provider is missing, a hook is called conditionally,
 * or a store selector returns a fresh snapshot on every read (which loops).
 */
describe("App shell", () => {
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // The shell probes 127.0.0.1 for the optional local agent on mount. No
    // agent runs in tests, so answer with a fast failure instead of a real
    // socket error.
    globalThis.fetch = (() => Promise.reject(new Error("no agent in tests"))) as typeof fetch;
  });

  test("mounts, renders the welcome screen and unmounts cleanly", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<App />);
    });

    expect(host.textContent).toContain("Metadata Studio");
    expect(host.textContent).toContain("Containers detected");
    expect(host.textContent).toContain("Container coverage");
    expect(host.textContent).toContain("local agent:");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});