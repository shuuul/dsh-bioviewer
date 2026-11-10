import assert from "node:assert/strict";
import { mock } from "bun:test";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { StudioLike } from "../../src/client/load";

// Simulates `MolStudio.create` rejecting (WebGL unavailable): the first mount
// reports through onError and never calls onReady; the remount after Retry
// succeeds and loads the entry.
let mounts = 0;
let loads = 0;
const studio: StudioLike = {
  loadStructure: async () => {},
  loadVolume: async () => {},
  loadPdb: async () => {
    loads += 1;
  },
};

// Run in a child process so these rendering boundaries cannot replace modules
// used by the built-artifact/registration tests in the parent Bun test process.
mock.module("@molstudio/react", () => ({
  Studio: ({
    onReady,
    onError,
  }: {
    onReady: (studio: StudioLike) => void;
    onError: (cause: Error) => void;
  }) => {
    useEffect(() => {
      mounts += 1;
      if (mounts === 1) {
        onError(new Error("Mol* could not create a WebGL context."));
        return;
      }
      onReady(studio);
    }, [onReady, onError]);
    return createElement("div", { "data-test-stage": true });
  },
}));
mock.module("../../src/client/use-theme", () => ({ useViewerTheme: () => "dark" as const }));
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
  for (let i = 0; i < 100 && status() !== "error"; i++) await flush();
  assert.equal(status(), "error", "a failed creation is an error, not a perpetual spinner");
  assert.equal(mounts, 1);
  assert.equal(loads, 0, "nothing loads into a studio that was never created");
  // Exactly one alert — the error card; the transient-error banner must stay quiet.
  assert.equal(renderer.root.findAllByProps({ role: "alert" }).length, 1);

  const retry = renderer.root.findByProps({ type: "button" });
  await act(async () => { retry.props.onClick(); });
  for (let i = 0; i < 100 && status() !== "ready"; i++) await flush();
  assert.equal(mounts, 2, "retry remounted <Studio>");
  assert.equal(status(), "ready");
  assert.equal(loads, 1, "the payload loads once the remounted studio is ready");
} finally {
  if (renderer) await act(async () => { renderer.unmount(); });
}
