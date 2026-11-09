---
id: "007"
title: "Upstream bump: MolStudio 0.1.7 pipeline and downsample work"
status: Completed
created: 2026-11-09
updated: 2026-11-09
coordinator: "Lead"
---

# 007 — Upstream bump: MolStudio 0.1.7 pipeline and downsample work

## Context

Spec 006 shipped `@molstudio/core` 0.1.6 and measured it: the wasm surface engine
is a genuinely faster marching-cubes kernel (4.6-22.8x on identical work) but
**0.1.6 was slower end to end than 0.1.5 on every real map measured** — 1.44 s ->
2.14 s (64³), 1.49 s -> 2.06 s (112³), 0.61 s -> 2.22 s (290³), 4.26 s -> 5.41 s
(500³) — because of ~2 s of fixed pipeline cost, no GPU isosurface path for
periodic volumes (`!needsWrap`), and an unconditional 2x downsample of oversized
grids that also changes the rendered surface (the relative iso level is re-resolved
on the downsampled statistics: 2σ 0.0157 -> 0.0143, 841 k -> 112 k triangles on
EMD-10088). Evidence:
`specs/archive/evidence/molstudio-016-wasm-benchmark.md`.

The user reports **0.1.7** is out and expects it to fix this:
*"现在升级到 0.1.7 了应该能解决这个问题，请尝试并汇报"*.

Reading `0.1.7`'s `dist` against `0.1.6`'s:

- `volume/operations.js` calls the new `downsampleGridRemote()` and hands the
  result to the transform: the box downsample now runs **in the worker's wasm**
  when a worker tier exists (JS transform is the fallback), so it leaves the main
  thread.
- The surface-engine session is **lazy**: `predictedGpu = gpuIsosurfacePath(...)`
  decides whether `createSurfaceEngine` starts eagerly; GPU-predicted volumes no
  longer pay an eager worker/grid copy (`ensureEngine()` builds on the first
  CPU-path visual instead).
- `representation.js` renames `useGpuIsosurface` -> `gpuIsosurfacePath` and
  `engineMatchesWrap` -> `engineHandlesProps`; the GPU predicate **still contains
  `!needsWrap`**, so periodic volumes remain CPU-only.
- Worker protocol gains `{kind:"downsample"}`/`{kind:"downsampled"}`; the wasm grows
  from 54,448 to 55,026 bytes.
- `volume/policy.js` `downsampleFactorFor` is unchanged: the downsample is still
  unconditional and still has no host opt-out.

So 0.1.7 targets the fixed pipeline cost, not the two design decisions that cost
the most on periodic EMDB maps. Whether that closes the 0.1.5 gap is an
experiment, not an assumption.

Baseline before this spec: 0.1.6 shipped, `bun run verify:fast` green,
`bun test` = 396 pass, 0 fail, 23 files.

## Goal and success criteria

- [x] `@molstudio/core` / `@molstudio/react` are bumped to `^0.1.7`, `bun.lock`
      regenerated, and the embedded assets regenerated from the installed package
      (`bun run sync:molstudio-assets`), with the digest/ABI and bundle tests
      passing on the new wasm (55,026 B).
- [x] The shipped wiring still creates a real engine on 0.1.7: a browser probe
      shows `WorkerSurfaceEngine` from the data-URL wasm + blob worker (the new
      worker protocol includes the downsample messages).
- [x] The speedup is measured, not assumed: hardware and SwiftShader matrices
      are in `specs/archive/evidence/molstudio-017-wasm-benchmark.md` and
      `.verification/wasm-bench/results/`.
- [x] Recommendation recorded: keep the 0.1.7 wiring; do not revert. Open time
      on typical periodic maps does not beat 0.1.5. Spec 008 takes 0.1.8.
- [ ] Durable docs (`README.md` + `README_EN.md` pair, `AGENTS.md`) for the 0.1.8
      floor — moved to spec 008.
- [x] `bun run check:specs` and `bun test tests/specs.test.ts` pass before
      archiving.

## Scope and non-goals

In scope:
- `package.json` ranges + `bun.lock`; `src/client/generated/molstudio-assets.ts`
  regeneration; version/digest constants in tests and docs.
- Re-measuring the 0.1.5 vs 0.1.6 vs 0.1.7 matrix and the isolated kernel.
- A clear recommendation for the user: keep 0.1.7, or revert to 0.1.5.

Non-goals:
- Changing the plugin's design decision to embed the engine instead of routing
  assets; 0.1.7 keeps `MolStudioOptions.surfaceEngine` as the only hook, and
  `import.meta.url` is still unusable in this classic-script bundle.
- Working around MolStudio's periodic-volume CPU path or the unconditional
  downsample (there is still no opt-out; a host cannot fix it correctly).

## Decisions

- **Keep the embedded-engine design.** 0.1.7 still resolves its packaged wasm and
  worker from `import.meta.url` and still exposes only `surfaceEngine` as the
  hook, so `scripts/sync-molstudio-assets.ts` + the data-URL/blob-worker wiring
  remain the only way to activate the engine in a classic-script bundle.
- **Pin `^0.1.7`, not a range spanning 0.1.6.** The 0.1.7 API is additive
  (`SurfaceEngineAssets` unchanged, `createSurfaceEngine` unchanged), but the
  embedded wasm digest and worker protocol differ, so the assets must match the
  installed version exactly; the digest test enforces it.
- **Do not try to defeat the downsample or the periodic-volume CPU path.** Both
  are upstream policies with no host opt-out in 0.1.7
  (`downsampleFactorFor`, `dist/volume/policy.js:10`; `gpuIsosurfacePath`'s
  `!needsWrap`). A wrong workaround here would show a surface Mol* does not agree
  with.
- **Recommendation goes in the docs, not in code.** If 0.1.7 still loses to 0.1.5
  on periodic maps, the README states the measured result and the user decides
  whether to keep the bump; the plugin does not silently pin an older dependency.

## Workstreams

| ID | Workstream | Owner | Status | Depends on |
| --- | --- | --- | --- | --- |
| WS-01 | Bump to 0.1.7, regenerate embedded assets, keep the wiring green | Lead | In progress | None |
| WS-02 | Benchmark 0.1.5 vs 0.1.6 vs 0.1.7 (real maps, fixed cost, off-thread downsample) | bench | Claimed | None |
| WS-03 | Docs, spec completion and closeout | Lead | Pending | WS-01, WS-02 |

## Verification

- Types/build/tests: `bun run verify:fast` (specs -> lint -> typecheck -> build ->
  test) on the 0.1.7 tree.
- Engine wiring: `.verification/probe-lead/run.ts` (headless Chrome) driving the
  shipped `STUDIO_OPTIONS`; expects the data-URL wasm to decode (55,026 B,
  `\0asm`), the blob worker to answer `ready`, and `createSurfaceEngine` to return
  `WorkerSurfaceEngine`.
- Benchmark: WS-02, `.verification/wasm-bench`, evidence in
  `specs/archive/evidence/molstudio-017-wasm-benchmark.md` (§1 wiring probes,
  §2 hardware + SwiftShader matrices, §2.3 attribution, §2.4 rerun). Filled
  2026-11-09; raw matrices stay in the gitignored `.verification/wasm-bench/results/`.
- `bun run check:specs` + `bun test tests/specs.test.ts`: pass before this spec
  was created; the pre/post-archive runs are recorded in the closeout entry.

## Documentation sync

- Durable product/developer docs: `README.md` + `README_EN.md` (0.1.7 numbers).
- Nearest local `AGENTS.md`: `^0.1.7` floor, the 0.1.7 pipeline/lazy-session
  behaviour, testing notes.
- Parent/package guidance: none.
- Root guidance and roadmap: `specs/README.md` index row for this spec.

### Experiment refs

None planned; the benchmark harness and its output are the evidence.

## Completion summary

0.1.7 shipped in the plugin (embedded 55,026 B wasm + downsample protocol). The
engine wiring is real (`WorkerSurfaceEngine`). End-to-end open time on periodic
EMDB maps does not beat 0.1.5: 0.1.7 still forces CPU wasm on wrapped grids
(`!needsWrap`), still rebuilds the parse-time isosurface, and the one-shot
downsample worker is slower than in-process wasm on large grids. Iso-drag and
the isolated kernel remain the wasm win.

Recommendation: keep the 0.1.7 wiring (do not revert to 0.1.5/0.1.6). Spec 008
bumps to MolStudio 0.1.8, which restores Mol* GPU for periodic solids, skips
parse-time visuals, and downsamples in-process. Hardware-only benches replace
the SwiftShader default.

## Progress and handoff

### 2026-11-09 — Lead — WS-01b browser probe of the shipped wiring

- Changed: nothing tracked. `.verification/probe-lead/` gained a CDP runner and
  a real-time entry (`run-real.ts`, `entry-real.ts`); the older `--virtual-time-budget`
  rig (`run.ts`) is kept but is not used for anything that touches a worker.
- Evidence (headless Chrome, shipped `STUDIO_OPTIONS`):
  - data URL decodes to 55,026 B, magic `\0asm`;
  - blob worker answers `ready` in **4 ms**;
  - `createSurfaceEngine(STUDIO_OPTIONS.surfaceEngine, …)` returns
    **WorkerSurfaceEngine**, and `mesh(0.1)` returns 17,016 vertices on the probe grid;
  - 0.1.7's off-thread downsample through the *shipped* worker:
    16³ → 8³ in **11 ms**, values **bitwise identical** to `downsampleGrid` with
    Mol*'s `axisOrderSlowToFast` `[2,1,0]`;
  - on a real 290³ tensor: remote **130 ms** vs JS `downsampleGrid` **71 ms** for
    the same output (checksum equal), i.e. the remote path is slower in wall-clock
    but leaves the main thread.
  - tier handoff is cheap: 146³ wrapped grid, main-thread engine create 14-46 ms,
    worker engine create 19-23 ms, `mesh()` 10 ms for both, 295,516 triangles.
- **Rig trap recorded:** with `--virtual-time-budget` Chrome starves worker tasks —
  the same 290³ remote downsample measured **29,100 ms** under virtual time vs
  **130 ms** without it, and a worker's second message arrived 8.4 s late. All
  worker-crossing timings must be taken over CDP in real time; flagged to WS-02.
- Blockers: none.
- Next action: fold WS-02's like-for-like matrix into the docs; resolve why the
  benchmark's worker-wired row is ~1.4 s slower than its main-thread row on
  EMD-10088 when the isolated tier handoff is only ~10 ms apart.

### 2026-11-09 — Lead — WS-01 bump and asset regeneration

- Changed: `package.json` -> `^0.1.7` for both MolStudio packages, `bun.lock`
  regenerated, `bun run sync:molstudio-assets` rebuilt
  `src/client/generated/molstudio-assets.ts` (0.1.7, 55,026 B, sha256
  `fd27a091…`, worker IIFE now carries the `downsample` protocol).
- Evidence: `bun test` = 396 pass, 0 fail after the regeneration (the digest/ABI
  and C4 bundle tests track the installed package, so they moved with the bump).
- Also added guardrails that would catch a silently-stale re-sync: the embedded
  worker source must contain the `downsample`/`downsampled` protocol and the
  embedded module must export the `ds_*` ABI (`tests/wasm-asset.test.ts`), and the
  built bundle must carry both (`tests/build.test.ts` C4). Gate still green.
- Commit: `6e0b1ca feat(deps): upgrade to MolStudio 0.1.7`.
- Remaining: real-host engine probe, docs, benchmark numbers, archive.
- Blockers: none.
- Next action: run the browser probe and `bun run verify:fast`, then fold WS-02
  numbers into the docs.
