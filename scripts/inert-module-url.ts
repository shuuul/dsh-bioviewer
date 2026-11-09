/**
 * A reserved-domain placeholder for `import.meta.url` in every browser bundle
 * this repo builds.
 *
 * `@molstudio/core` 0.1.6 resolves its wasm module and its surface worker from
 * `import.meta.url` (`dist/compute/wasm-core.js`: `new URL("../assets/molstudio-wasm-engine.wasm", import.meta.url)`;
 * `dist/compute/worker-engine.js`: `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })`).
 * This repo passes both assets explicitly (`src/client/surface-engine.ts`), so
 * those defaults are dead code — but a browser bundle cannot just leave the
 * expression alone:
 *
 * - The client half is a classic script, where Bun inlines the *build machine's*
 *   absolute path, so the published `lib/client.js` would carry
 *   `/Users/<builder>/…` and point at files that cannot exist in a browser.
 * - The screenshot page is an ES module, and there Bun reads the same
 *   `new Worker(new URL("./worker.js", import.meta.url), …)` as a worker
 *   entrypoint and aborts the build with "Multiple files share the same output
 *   path".
 *
 * `.invalid` is reserved (RFC 2606), so even an accidental `fetch` cannot leave
 * the machine. Both bundles define `import.meta.url` to this value; keep them in
 * sync by importing it instead of copying the string.
 */
export const INERT_MODULE_URL = "https://not-a-real-module.invalid/";
