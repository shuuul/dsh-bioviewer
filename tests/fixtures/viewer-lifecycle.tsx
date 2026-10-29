import assert from "node:assert/strict";
import { mock } from "bun:test";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { StudioLike, StudioObjectSummary } from "../../src/client/load";

let theme = "dark";
const objects: StudioObjectSummary[] = [];
let downloads = 0;
const studio: StudioLike = {
  loadStructure: async () => {},
  loadVolume: async () => {},
  getSnapshot: () => ({ objects }),
  remove: async (id) => {
    const index = objects.findIndex((object) => object.id === id);
    if (index >= 0) objects.splice(index, 1);
  },
  loadPdb: async (id) => {
    objects.push({ id: `download-${++downloads}`, label: id, kind: "structure" });
  },
};

// Run in a child process so these rendering boundaries cannot replace modules
// used by the built-artifact/registration tests in the parent Bun test process.
mock.module("@molstudio/react", () => ({
  Studio: ({ onReady }: { onReady: (studio: StudioLike) => void }) => {
    useEffect(() => { onReady(studio); }, [onReady]);
    return createElement("div", { "data-test-stage": true });
  },
}));
mock.module("../../src/client/use-theme", () => ({ useViewerTheme: () => theme }));
const { StructureTabView } = await import("../../src/client/file-view");

let renderer!: ReactTestRenderer;
async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
function status() {
  return renderer.root.findByProps({ "data-dsh-bioviewer-root": "" }).props["data-dsh-bioviewer-status"];
}
try {
  await act(async () => { renderer = create(createElement(StructureTabView, { path: "pdb:1CBS" })); });
  for (let i = 0; i < 100 && status() !== "ready"; i++) await flush();
  assert.equal(status(), "ready");
  assert.equal(downloads, 1);
  const originalObject = objects[0];
  theme = "light";
  await act(async () => { renderer.update(createElement(StructureTabView, { path: "pdb:1CBS" })); });
  await flush();
  assert.equal(status(), "ready", "a theme-only render must not restart loading");
  assert.equal(downloads, 1, "a theme-only render must not redownload the entry");
  assert.equal(objects.length, 1);
  assert.equal(objects[0], originalObject, "theme changes preserve the loaded object and its display state");

  await act(async () => { renderer.update(createElement(StructureTabView, { path: "pdb:2XYZ" })); });
  for (let i = 0; i < 100 && status() !== "ready"; i++) await flush();
  assert.equal(status(), "ready");
  assert.equal(downloads, 2, "an actual accession change still loads");
  assert.equal(objects.at(-1)?.label, "2XYZ");
} finally {
  if (renderer) await act(async () => { renderer.unmount(); });
}
