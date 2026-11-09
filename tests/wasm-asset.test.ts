/**
 * The wasm surface engine is embedded in this plugin's client bundle, so its
 * bytes are a *copy* of the installed `@molstudio/core` — and a copy can go
 * stale. `bun run sync:molstudio-assets` regenerates
 * `src/client/generated/molstudio-assets.ts`; this file fails the gate when a
 * dependency bump lands without it, and proves the embedded module is a real
 * engine rather than a truncated asset.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MOLSTUDIO_CORE_VERSION,
  MOLSTUDIO_SURFACE_WORKER_SOURCE,
  MOLSTUDIO_WASM_BASE64,
  MOLSTUDIO_WASM_BYTES,
  MOLSTUDIO_WASM_CORE_SHA256,
  MOLSTUDIO_WASM_SHA256,
  MOLSTUDIO_WORKER_SHA256,
} from "../src/client/generated/molstudio-assets";
import { makeSurfaceWorker, STUDIO_OPTIONS, SURFACE_WASM_URL } from "../src/client/surface-engine";

const root = join(import.meta.dir, "..");
const coreDist = join(root, "node_modules/@molstudio/core/dist");
const wasmBytes = Buffer.from(MOLSTUDIO_WASM_BASE64, "base64");
const sha256 = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

const SYNC_HINT = "Rerun `bun run sync:molstudio-assets`; see scripts/sync-molstudio-assets.ts.";

describe("embedded MolStudio surface-engine assets", () => {
  test("the copies match the installed @molstudio/core (rerun the sync script on a bump)", () => {
    const pkg = JSON.parse(readFileSync(join(root, "node_modules/@molstudio/core/package.json"), "utf8")) as {
      version: string;
    };
    expect(pkg.version, SYNC_HINT).toBe(MOLSTUDIO_CORE_VERSION);

    const installedWasm = readFileSync(join(coreDist, "assets/molstudio-wasm-engine.wasm"));
    expect(installedWasm.byteLength, SYNC_HINT).toBe(MOLSTUDIO_WASM_BYTES);
    expect(sha256(installedWasm), SYNC_HINT).toBe(MOLSTUDIO_WASM_SHA256);

    const upstreamWorker = readFileSync(join(coreDist, "compute/worker.js"));
    expect(sha256(upstreamWorker), SYNC_HINT).toBe(MOLSTUDIO_WORKER_SHA256);
    const upstreamCore = readFileSync(join(coreDist, "compute/wasm-core.js"));
    expect(sha256(upstreamCore), SYNC_HINT).toBe(MOLSTUDIO_WASM_CORE_SHA256);

    console.log(`[wasm] @molstudio/core@${pkg.version}: ${installedWasm.byteLength} B module, ${MOLSTUDIO_SURFACE_WORKER_SOURCE.length} B worker source`);
  });

  test("SURFACE_WASM_URL is self-contained: a data URL that decodes to those bytes", () => {
    expect(SURFACE_WASM_URL.startsWith("data:application/wasm;base64,")).toBe(true);
    // Nothing to fetch from the host: no route, no `file://`, no relative path.
    expect(SURFACE_WASM_URL).not.toMatch(/^(\/|https?:|file:)/);
    const encoded = SURFACE_WASM_URL.slice("data:application/wasm;base64,".length);
    expect(encoded).toBe(MOLSTUDIO_WASM_BASE64);
    expect(sha256(Buffer.from(encoded, "base64"))).toBe(MOLSTUDIO_WASM_SHA256);
    // A wasm module starts with \0asm; a truncated or base64-of-text asset would not.
    expect(wasmBytes.subarray(0, 4).toString("latin1")).toBe("\u0000asm");
  });

  test("the embedded module instantiates and exposes the marching-cubes ABI", async () => {
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as Record<string, unknown>;
    // 0.1.8 still ships the box-downsample ABI (ds_*). Open uses in-process
    // `ds_from_staging`; the worker protocol remains for hosts and tests.
    const functions = [
      "grid_begin",
      "grid_commit",
      "grid_ptr",
      "grid_len",
      "mc_mesh",
      "mc_lines",
      "reset",
      "mesh_vertices",
      "mesh_indices",
      "ds_dims",
      "ds_data",
      "ds_from_staging",
      "ds_run",
    ];
    expect(functions.filter((name) => typeof exports[name] !== "function")).toEqual([]);
    expect(exports.memory instanceof WebAssembly.Memory).toBe(true);
    console.log(`[wasm] engine exports: ${Object.keys(exports).sort().join(", ")}`);
  });

  test("the worker source is a classic script that speaks the engine protocol", () => {
    // The worker runs from a blob URL as a classic script: module syntax here
    // would fail in the worker before it could post `ready`.
    expect(() => new Function(MOLSTUDIO_SURFACE_WORKER_SOURCE)).not.toThrow();
    for (const marker of ["self.onmessage", '"init"', '"mesh"', '"lines"', '"ready"']) {
      expect(MOLSTUDIO_SURFACE_WORKER_SOURCE).toContain(marker);
    }
    // Keep the downsample protocol markers so a stale worker from an older
    // package is still caught, even though open no longer requires it.
    for (const marker of ['"downsample"', '"downsampled"']) {
      expect(MOLSTUDIO_SURFACE_WORKER_SOURCE).toContain(marker);
    }
  });

  test("<Studio> receives exactly the surface-engine options", () => {
    expect(Object.keys(STUDIO_OPTIONS)).toEqual(["surfaceEngine"]);
    const assets = STUDIO_OPTIONS.surfaceEngine;
    expect(assets?.wasmUrl).toBe(SURFACE_WASM_URL);
    expect(assets?.makeWorker).toBe(makeSurfaceWorker);
    // The packaged workerUrl default is the broken import.meta.url path; leaving
    // preferMainThread unset is what lets the worker tier be tried first.
    expect(assets?.workerUrl).toBeUndefined();
    expect(assets?.preferMainThread).toBeUndefined();
  });

  test("makeSurfaceWorker throws (for the main-thread fallback) when the platform cannot make one", () => {
    const target = globalThis as Record<string, unknown>;
    const savedWorker = target.Worker;
    const savedBlob = target.Blob;
    try {
      target.Worker = undefined;
      expect(() => makeSurfaceWorker()).toThrow();
      target.Worker = savedWorker;
      target.Blob = undefined;
      expect(() => makeSurfaceWorker()).toThrow();
    } finally {
      target.Worker = savedWorker;
      target.Blob = savedBlob;
    }
  });
});
