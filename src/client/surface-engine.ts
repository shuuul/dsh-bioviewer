/**
 * MolStudio's wasm surface engine, wired for the DSH shell.
 *
 * `@molstudio/core` 0.1.6 replaced the parsed Mol* isosurface with its own
 * `molstudio-isosurface` representation and a WebAssembly marching-cubes
 * kernel (54 KB). `createSurfaceEngine` (`dist/compute/index.js`) picks a
 * Worker first, then the same wasm on the main thread, then `null`; the volume
 * layer calls it from `upgradeVolume` (`dist/MolStudio.js`) whenever a volume
 * enters the scene, so the wiring happens once per `<Studio>`, not per file.
 *
 * The packaged defaults cannot work here. `dist/compute/wasm-core.js` resolves
 * its module with `new URL("../assets/molstudio-wasm-engine.wasm", import.meta.url)`
 * and `dist/compute/worker-engine.js` builds its worker with
 * `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })`.
 * Our client half is one classic script served from `/plugins/<id>/client.js`
 * with no sibling asset route, and Bun rewrites `import.meta.url` to the
 * *build machine's* absolute `file://` path, so both URLs point at a file that
 * does not exist in the browser: the worker silently falls back to the main
 * thread and the wasm `fetch` fails, leaving every volume on Mol*'s slower
 * parsed-isosurface path with no visible error. The assets are therefore
 * embedded in the bundle by `scripts/sync-molstudio-assets.ts` (see
 * `./generated/molstudio-assets.ts`) and handed over explicitly.
 *
 * Per-volume engine instances come from the volume layer, which calls
 * `surfaceEngine.makeWorker()` for each new grid and `dispose()`s the engine
 * when the volume goes away — one blob URL is reused, the worker is not.
 */
import type { MolStudioOptions } from "@molstudio/core";
import {
  MOLSTUDIO_SURFACE_WORKER_SOURCE,
  MOLSTUDIO_WASM_BASE64,
} from "./generated/molstudio-assets";

/**
 * The engine fetches its module from this string (`wasm-core.js` accepts a URL
 * or bytes), so a data URL keeps the promise chain identical to the packaged
 * one: no host route, no plugin asset directory.
 */
export const SURFACE_WASM_URL = `data:application/wasm;base64,${MOLSTUDIO_WASM_BASE64}`;

/** One blob URL per page: every volume gets its own worker from the same script. */
let workerScriptUrl: string | undefined;

/**
 * `SurfaceEngineAssets.makeWorker`: the worker tier's script, from the bundle.
 *
 * Throwing is deliberate — `WorkerSurfaceEngine.create` catches it, returns
 * `null` and the factory falls through to the main-thread engine. Hosts that
 * block blob workers (or workers at all) therefore degrade to wasm-in-page
 * instead of disabling the engine. The worker is a classic script: it is built
 * from `dist/compute/worker.js` as an IIFE so its `./wasm-core.js` import is
 * already inlined.
 */
export function makeSurfaceWorker(): Worker {
  if (typeof Worker === "undefined" || typeof Blob === "undefined") {
    throw new Error("dsh-bioviewer: this host has no Worker or Blob constructor");
  }
  workerScriptUrl ??= URL.createObjectURL(new Blob([MOLSTUDIO_SURFACE_WORKER_SOURCE], { type: "text/javascript" }));
  return new Worker(workerScriptUrl);
}

/**
 * Creation options for every `<Studio>` this plugin renders.
 *
 * Only `surfaceEngine` is set: the packaged `workerUrl` default is the broken
 * `import.meta.url` path, and `preferMainThread` stays false so the worker
 * tier is tried first (mesh building then does not block the shell's UI
 * thread).
 */
export const STUDIO_OPTIONS: MolStudioOptions = {
  surfaceEngine: {
    wasmUrl: SURFACE_WASM_URL,
    makeWorker: makeSurfaceWorker,
  },
};
