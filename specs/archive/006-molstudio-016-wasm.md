---
id: "006"
title: "Upstream bump: MolStudio 0.1.6 wasm surface engine"
status: Completed
created: 2026-11-09
updated: 2026-11-09
coordinator: "Lead"
---

# 006 — Upstream bump: MolStudio 0.1.6 wasm surface engine

## Context

`@molstudio/core` / `@molstudio/react` **0.1.6** (latest, npm `dist-tags.latest`;
0.1.5 is what this repo pins today) restructures `core/dist` into feature folders
and adds a **WebAssembly surface engine** for density-map isosurfaces:

- `dist/compute/` — Mol*-free surface pipeline: `createSurfaceEngine` picks a
  `WorkerSurfaceEngine` (top tier), then a main-thread `WasmSurfaceEngine`, then
  `null`; `WasmCore` drives a 54 KB `dist/assets/molstudio-wasm-engine.wasm`
  (marching cubes + box downsample). The engine grid is installed from the
  volume's `Float32Array`, and `volume/operations.ts` downsamples grids that do
  not fit the GPU texture limit before the engine is created.
- `dist/volume/` — `MolStudio` now replaces Mol*'s parsed isosurface with its own
  `molstudio-isosurface` representation, whose CPU geometry comes from the wasm
  engine; wrapped (periodic) grids always take the engine path, non-wrapped grids
  keep Mol*'s GPU isosurface when it is suitable.
- `MolStudioOptions.surfaceEngine?: SurfaceEngineAssets` and
  `StudioProps.studioOptions` are the host wiring points (`wasmUrl` / `workerUrl` /
  `makeWorker` / `preferMainThread`). The packaged defaults resolve
  `new URL("../assets/molstudio-wasm-engine.wasm", import.meta.url)` and
  `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })`.

Those defaults cannot work in this plugin: the client half is a **single classic
script** (`window.__ModuleLoader__.load`, no asset route, `import.meta` not a
module), so the packaged wasm URL and worker URL both point at nothing. Without
wiring, 0.1.6 degrades to Mol*'s own CPU marching cubes silently — the wasm
upgrade would be installed but never active.

The user request behind this spec: *"molstudio 有更新，这次包含 wasm，请帮我升级，
然后测一下加速了多少"* — upgrade, then measure the speedup.

Baseline before this spec (HEAD `7b539e3`, MolStudio 0.1.5): `bun run verify:fast`
green, `bun test` = 387 pass, 0 fail, 22 files.

## Goal and success criteria

- [x] `@molstudio/core` and `@molstudio/react` are bumped to `^0.1.6`, `bun.lock`
      is regenerated and `bun install` is clean.
- [x] The wasm surface engine is actually wired in the shipped client bundle:
      the built `lib/client.js` carries the 0.1.6 wasm bytes, passes them to
      `<Studio studioOptions>`, and a browser check shows the engine created
      (`WasmSurfaceEngine`/`WorkerSurfaceEngine`) rather than the null fallback.
- [x] The wasm asset cannot silently drift from the installed dependency: a test
      pins its digest to `node_modules/@molstudio/core/dist/assets/` (or rejects a
      stale checked-in copy).
- [x] The 0.1.6 API delta is reconciled: typecheck, lint, build and the full test
      suite pass; durable docs (README pair, AGENTS.md) describe the wasm asset
      wiring and the new `^0.1.6` floor.
- [x] The speedup is measured, not assumed: a reproducible headless-Chrome
      benchmark compares 0.1.5 and 0.1.6 on identical real EMDB maps + a
      periodic CCP4 grid, reports load-to-first-isosurface and isolated
      CPU-meshing timings (medians, repetitions), and the numbers land in this
      spec plus `specs/archive/evidence/`.
- [x] Real-host probes (throwaway `DSH_HOME`, host 0.2.2-rc.1) still pass: config
      row composed, client bundle served, `/bioviewer/open` 403/held/400.
- [x] `bun run check:specs` and `bun test tests/specs.test.ts` pass before and
      after archiving; this spec is indexed as Active and later moved to
      `archive/`.

## Scope and non-goals

In scope:
- `package.json` MolStudio ranges + `bun.lock`.
- Wasm asset shipping (build plugin, checked-in/derived asset, client
  `studioOptions` wiring, screenshot harness wiring).
- Tests for the wiring/digest and any 0.1.6 contract drift.
- README pair + `AGENTS.md` durable notes.
- A reproducible benchmark harness and recorded numbers/evidence.

Not in scope:
- Any change to `dsh-better-sidebar`, DSH, Mol* or React versions.
- Forking or patching MolStudio's wasm ABI or worker protocol.
- Package version bump, tag, publish (manual-only release policy).
- Restarting or replacing the user's live GUI; every host probe uses a
  throwaway `DSH_HOME`.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
| --- | --- | --- | --- |
| 2026-11-09 | Ship the wasm bytes inside the client bundle instead of adding an asset route | The client half is one classic script with no asset route, and a published plugin has no `node_modules` access at runtime; the wasm is only 54 KB, so a base64 data URL is simpler and works in both the main-thread and worker tiers | WS-01 |
| 2026-11-09 | Measure the speedup at the `MolStudio` level with real EMDB maps, not with a synthetic microbenchmark alone | The viewer's own load path (`loadVolume` → engine → representation) is what the user experiences; a real map also exercises the downsample/GPU-texture policy, which the plugin cannot bypass | WS-02 |
| 2026-11-09 | Embed the surface worker as well, as a bundled classic script behind a blob URL, instead of forcing `preferMainThread: true` | The worker tier is the packaged default and keeps mesh building off the shell's UI thread; the plugin bundles upstream `dist/compute/worker.js` (+ its inlined `wasm-core.js`) to 2.7 KB, so the tier survives without a module-worker URL or package-root assets. A host without `Worker`/`Blob` throws from `makeWorker`, which `WorkerSurfaceEngine.create` turns into a main-thread wasm fallback | WS-01 |
| 2026-11-09 | Define `import.meta.url` to an inert `https://…invalid/` URL in the client build | Bun would otherwise inline the build machine's absolute `file:///Users/<builder>/…` path for the two 0.1.6 compute modules that use it; the plugin passes both assets explicitly, so those defaults are dead code, and a published bundle must not carry a builder path. `.invalid` is reserved (RFC 2606), so an accidental `fetch` cannot reach the network | WS-01 |

## Workstreams

Use Pending, Claimed, In progress, Blocked, or Done. Workers claim before editing.

| ID | Deliverable | Owner | Status | Dependencies | Verification |
| --- | --- | --- | --- | --- | --- |
| WS-01 | Bump MolStudio to 0.1.6, ship the wasm asset, pass `studioOptions` from `<Studio>` and the screenshot app | Lead | Done | None | `bun install`, `bun run verify:fast`, browser engine-created probe |
| WS-02 | Headless-Chrome benchmark: 0.1.5 vs 0.1.6 on identical maps, medians + repetitions, evidence files | bench | Done | None | Harness rerun output |
| WS-03 | Reconcile 0.1.6 API delta in tests/docs: digest anti-drift test, README pair, AGENTS.md contract/version notes | Lead | Done | WS-01 | `bun run verify:fast`, `bun test tests/readme.test.ts` |
| WS-04 | Real-host probe + closeout: throwaway `DSH_HOME` probes, spec index, archive | Lead | Done | WS-01–WS-03 | 5/5 probes, `bun run check:specs` |

## Verification

Exact commands, scenarios, results and remaining unverified areas. Include
`bun run check:specs` and `bun test tests/specs.test.ts` before closeout.

- Baseline (0.1.5, HEAD `7b539e3`): `bun test` = 387 pass, 0 fail, 22 files.
- Final gate (after archiving, same change): `bun run check:specs` =
  `Specs check passed.`; `bun test tests/specs.test.ts` = 55 pass, 0 fail,
  203 `expect()` calls; `bun run verify:fast` = specs/lint/tsc/build green and
  `bun test` 396 pass, 0 fail, 23 files.
- Bump: `bun install` installed `@molstudio/core@0.1.6` and `@molstudio/react@0.1.6`
  and rewrote `bun.lock` (cache redirected to `/tmp/bun-install-cache` because the
  user's `~/.bun/install/cache` is not writable from here).
- `bun run verify:fast` after the bump + wiring: `check:specs` passed, lint 0
  warnings/errors, `tsc --noEmit` clean, build OK, `bun test` = **396 pass, 0
  fail, 23 files** (387 + 9 new: 6 in `tests/wasm-asset.test.ts`, 3 C4 tests in
  `tests/build.test.ts`).
- Artifact: `lib/client.js` 3,380.7 KiB; exactly one
  `data:application/wasm;base64,`; the payload decodes to 54,448 bytes starting
  `\0asm`; zero `file:///` URLs and no repo path in the bundle (C4).
- Real host (throwaway `DSH_HOME=/tmp/dsh-verify-bioviewer`, `dsh 0.2.2-rc.1`,
  `--profile web` with `dsh-better-sidebar@0.30.1`, port 59391, torn down after):
  `--dump-config` composed the `- id: dsh-bioviewer` row; boot HTML listed
  `dsh-bioviewer/client.js&rev=98cc79a7c7d2`; that bundle answered 200
  `text/javascript` (3,461,940 B) and contained the wasm data URL and no
  `file:///`; `/bioviewer/open?sessionId=x` = 403
  `{"ok":false,"error":{"code":"forbidden","message":"forbidden"}}` without a
  cookie, 400 `bad-request` without `sessionId`, and **held 25.007 s** then 200
  `{"ok":true,"value":{"request":null}}` with the auth cookie.
- Browser engine-created probe (Lead, `.verification/probe-lead/run.ts`, headless
  Chrome 157 with `--no-sandbox`, SwiftShader GL, the real shipped module):
  `fetch(SURFACE_WASM_URL)` → 54,448 B starting `\0asm`; main-thread
  `WasmCore.create` → `setGrid` true, `mesh(0.1)` → 2,556 vertices / 4,296
  indices; the bundled worker behind its blob URL answered `{kind:"ready", ok:true}`
  in 10 ms; `createSurfaceEngine(STUDIO_OPTIONS.surfaceEngine, …)` returned a
  **`WorkerSurfaceEngine`** (not `null`) and meshed through it. Environment note:
  headless Chrome in this sandboxed session only starts with `--no-sandbox`
  (otherwise its GPU process dies with `exit_code=6`, SIGTRAP); that is
  environmental and unrelated to 0.1.6.
- Benchmark (WS-02, `.verification/wasm-bench/tools/run.ts --reps 5 --append` and
  `--huge --reps 3 --append`, 31 scenarios, 0 failed reps, fresh document per rep,
  headless Chrome 157 + SwiftShader; evidence in
  `specs/archive/evidence/molstudio-016-wasm-benchmark.md`): median `loadVolume()`
  on identical real EMDB maps, 0.1.5 → 0.1.6+wasm, is **1.44 s → 2.14 s**
  (EMD-1832, 64³), **1.49 s → 2.06 s** (EMD-3318, 112³), **0.61 s → 2.22 s**
  (EMD-10088, 290³) and **4.26 s → 5.41 s** (EMD-10087, 500³). No end-to-end
  speedup at any size: 0.1.6 carries ~2 s of fixed pipeline cost per load, keeps
  periodic grids off Mol*'s GPU isosurface (`!needsWrap`), and unconditionally
  downsamples 290³ → 145³ and 500³ → 250³ (`downsampleFactorFor`,
  `dist/volume/operations.js:53`; no host opt-out in `SurfaceEngineAssets`).
  Because the relative iso level is re-resolved on the downsampled statistics
  (2σ 0.0157 → 0.0143) the rendered surface differs: 841 k → 112 k triangles on
  EMD-10088. Inside 0.1.6 the engine does pay: 2.31 s → 2.22 s on EMD-10088 and
  6.00 s → 5.41 s on EMD-10087.
- Isolated kernels (`A.3` of the same harness, identical grid, iso level and
  triangle count): wasm is **4.6-22.8× faster** than Mol*'s
  `computeMarchingCubesMesh` on the grids 0.1.6 actually meshes — 65³ 9→<1 ms,
  113³ 35→4 ms, 146³ 58→6 ms, 251³ 440→97 ms. A Lead cross-check on noisy grids
  (`.verification/probe-lead/run-mesh.ts`, identical triangle counts) gives
  2.1-3.4× at 96³-290³ (10 M triangles at 290³): the ratio floor comes from
  memory bandwidth once millions of triangles are involved. Meshing tracks
  triangle count, not voxel count, and stays a few hundred milliseconds against
  the ~2 s fixed pipeline cost, which is why the kernel win does not reach the
  user.
- `--no-sandbox` note: headless Chrome in this sandboxed session only starts with
  it (its GPU process otherwise dies with `exit_code=6`, SIGTRAP); environmental,
  unrelated to 0.1.6.
- `bun run check:specs` + `bun test tests/specs.test.ts`: passed before
  implementation (`Specs check passed.`; 55 pass, 0 fail, 203 `expect()`
  calls); the post-archive run is recorded in the closeout entry.

## Documentation sync

- Durable product/developer docs: `README.md` + `README_EN.md` (wasm acceleration
  and the MolStudio floor).
- Nearest local `AGENTS.md`: host contracts (`studioOptions`/wasm asset), build
  section (wasm inlining), "Testing notes" (digest/engine tests), version
  coupling (0.1.6 floor).
- Parent/package guidance: none.
- Root guidance and roadmap: `specs/README.md` index row for this spec.

### Experiment refs

None planned; the benchmark harness and its output are the evidence.

## Completion summary

Shipped: `@molstudio/core` / `@molstudio/react` `^0.1.6`; the 54,448-byte wasm
surface engine and its worker embedded in the client half as a base64 data URL plus
a blob-URL classic worker (`src/client/surface-engine.ts`,
`src/client/generated/molstudio-assets.ts`, regenerated by
`bun run sync:molstudio-assets`); `studioOptions` passed from `<Studio>` in both
`src/client/studio.tsx` and the screenshot harness; an inert `import.meta.url`
define in both browser builds; a digest/ABI anti-drift test
(`tests/wasm-asset.test.ts`) and a bundle-level test (C4 in `tests/build.test.ts`);
README pair section, `AGENTS.md` contract 13 and testing notes.

Measured speedup: **the wasm kernel is 4.6-22.8× faster than Mol*'s JS marching
cubes on identical work (2.1-3.4× on grids with millions of triangles), but
opening a density map is not faster — it is slower.** Median `loadVolume()` went
1.44 s → 2.14 s (EMD-1832, 64³), 1.49 s → 2.06 s (EMD-3318, 112³), 0.61 s →
2.22 s (EMD-10088, 290³) and 4.26 s → 5.41 s (EMD-10087, 500³) versus 0.1.5.
Three causes stack: ~2 s of fixed pipeline cost per load, no GPU isosurface path
for periodic volumes (every EMDB map), and an unconditional 2× downsample of
grids above the texture limit, which also changes the rendered surface because
the relative iso level is re-resolved on the downsampled statistics.

Remaining unverified: numbers were taken with software GL (SwiftShader) in headless
Chrome, not on the user's GPU — on real hardware 0.1.5's GPU path is faster still,
so the end-to-end gap is not expected to shrink; a hardware-GPU rerun of
`.verification/wasm-bench` remains open. Also unverified: how the plugin behaves on
a 500³ map (downsampled to 125³ in 0.1.6); the harness has the data but the run was
skipped for time.

## Progress and handoff

Append entries; do not rewrite another worker's record.

### 2026-11-09 — Lead — WS-01

- Changed: spec created; 0.1.5 and 0.1.6 packages preserved under
  `/tmp/molstudio-pkgs/` for the benchmark baseline.
- Evidence: 0.1.6 tarball inspection (file list, `compute/*`, 54,448-byte wasm).
- Remaining: dependency bump, wasm wiring.
- Blockers: none.
- Next action: `bun install`, build, browser probe.

### 2026-11-09 — Lead — WS-01 + WS-03 (code)

- Changed: `package.json` (`^0.1.6`, `sync:molstudio-assets` script), `bun.lock`;
  new `scripts/sync-molstudio-assets.ts`, `src/client/generated/molstudio-assets.ts`
  (generated), `src/client/surface-engine.ts`, `src/client/studio.tsx`
  (`studioOptions`), `scripts/screenshots/app.tsx` (same options),
  `scripts/build.ts` (`import.meta.url` define), `tests/wasm-asset.test.ts`, C4
  block in `tests/build.test.ts`.
- Evidence: `bun run sync:molstudio-assets` → wasm 54,448 B / sha256
  `85c4d270…`, worker IIFE 2.7 KB; `bun run verify:fast` green (396 pass);
  real-host 5/5 probes; see Verification.
- Remaining: browser engine-created probe (bench scenario D), benchmark numbers,
  README pair + AGENTS.md, closeout.
- Blockers: none.
- Next action: fold bench numbers into docs/spec, then archive.

### 2026-11-09 — Lead — WS-01 probe + build hardening

- Changed: extracted `scripts/inert-module-url.ts` (shared by `scripts/build.ts` and
  `scripts/screenshots/capture.ts`); the screenshot build now defines
  `import.meta.url` too, because without it Bun treats the packaged
  `new Worker(new URL("./worker.js", import.meta.url))` default as a worker
  entrypoint and aborts with "Multiple files share the same output path".
- Evidence: `.verification/probe-lead/run.ts` proves the shipped wiring creates a
  `WorkerSurfaceEngine` in a real browser from the embedded data URL (see
  Verification); the rebuilt screenshot app bundle is 3,567,228 B, carries exactly
  one wasm data URL and no `file:///` path; `bun run verify:fast` still green.
- Remaining: benchmark numbers, README pair, evidence file, archive.
- Blockers: none.
- Next action: fold bench numbers into docs/spec, then archive.

### 2026-11-09 — Lead — WS-02 numbers, docs, closeout

- Changed: `README.md` + `README_EN.md` gained a mirrored "density-map
  acceleration" section (same mechanism prose, same measured tables);
  `specs/archive/evidence/molstudio-016-wasm-benchmark.md` records the raw
  end-to-end and isolated tables, the environment and the rerun commands.
- Evidence (WS-02, bench, 5 reps, headless Chrome 157 + SwiftShader; **the
  preliminary 3-map numbers below were superseded by the final 31-scenario run
  with a fresh document per rep — see Verification**): first frame
  0.1.5 → 0.1.6+wasm = 1.73 → 2.46 s (64³), 1.59 → 2.33 s (112³), 1.92 → 2.69 s
  (290³); 0.1.6 without the engine 2.93 s on 290³ → 2.01 s with it. Tier audit: the
  packaged defaults 404 and silently yield no engine, the shipped blob-worker +
  data-URL wiring yields `WorkerSurfaceEngine`; the earlier "data URL does not
  work" row was a harness bug (options not nested under `surfaceEngine`).
- Evidence (Lead, `.verification/probe-lead/run-mesh.ts`, Chrome/V8): wasm vs
  Mol* `computeMarchingCubesMesh` = 2.5×/2.1×/2.3×/2.1×/3.4× at 96³/128³/192³/
  240³/290³ with identical triangle counts.
- Remaining: nothing blocking; a hardware-GPU rerun would only sharpen the 0.1.5
  side of the comparison.
- Blockers: none.
- Next action: archive this spec.
