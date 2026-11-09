---
id: "008"
title: "Upstream bump: MolStudio 0.1.8 GPU path"
status: Completed
created: 2026-11-09
updated: 2026-11-09
coordinator: "omp"
---

# 008 — Upstream bump: MolStudio 0.1.8 GPU path

## Context

Spec 007 shipped `@molstudio/core` 0.1.7 and measured it: the wasm engine is
wired correctly, but typical periodic cryo-EM maps open slower than 0.1.5
because 0.1.7 stole Mol*'s GPU isosurface (`!needsWrap`), rebuilt the
parse-time surface, and paid a one-shot downsample worker. Recommendation:
keep the wiring, do not revert.

MolStudio 0.1.8 restores Mol* `useGpu` for periodic solids, skips parse-time
visuals, and downsamples in-process with `ds_from_staging`. This spec bumps
the plugin onto that release and re-measures on **hardware GPU only**.

## Goal and success criteria

- [x] `@molstudio/core` / `@molstudio/react` are `^0.1.8`; embedded assets
      regenerated (`bun run sync:molstudio-assets`); digest/ABI tests pass.
- [x] Hardware-only wasm-bench default (ANGLE Metal flags); matrix is 0.1.5 vs
      shipped plugin wiring on real EMDB maps, with load **and** iso-change.
      SwiftShader, synthetic Gaussians, and `--virtual-time-budget` are not
      the comparison path.
- [x] README pair and `AGENTS.md` state 0.1.8 behaviour and hardware numbers
      (or that numbers come from the next hardware run).
- [x] `bun run verify:fast` passes.

## Scope and non-goals

In scope:

- Dependency bump, asset sync, hardware-only bench harness, durable docs.

Not in scope:

- Changing MolStudio itself (that is molstudio spec 004).
- Screenshot capture (keeps SwiftShader for deterministic CI shots).

## Decisions

| Date | Decision | Rationale | Affected workstreams |
| --- | --- | --- | --- |
| 2026-11-09 | Hardware-only default for wasm-bench | SwiftShader downsamples 300³ maps Metal never would and measured the wrong path | WS-02 |
| 2026-11-09 | Keep embedded engine wiring | 0.1.8 still resolves packaged wasm/worker from `import.meta.url` | WS-01 |

## Workstreams

| ID | Deliverable | Owner | Status | Dependencies | Verification |
| --- | --- | --- | --- | --- | --- |
| WS-01 | Bump to 0.1.8 and regenerate embedded assets | omp | Done | None | `tests/wasm-asset.test.ts` |
| WS-02 | Hardware-only bench matrix (0.1.5 vs shipped, iso-change) | omp | Done | WS-01 | `.verification/wasm-bench` |
| WS-03 | Docs | omp | Done | WS-01, WS-02 | README pair, AGENTS.md |

## Verification

- `bun run verify:fast`.
- `bun .verification/wasm-bench/tools/run.ts --gpu hardware` after the bump.

## Documentation sync

- `README.md` + `README_EN.md`: 0.1.8 GPU path; retire SwiftShader open-time tables as the product claim.
- `AGENTS.md`: `^0.1.8` floor.

## Progress and handoff

### 2026-11-09 — omp — WS-01/WS-03

- Changed: `@molstudio/core` / `@molstudio/react` 0.1.8 from the packed
  tarball; `bun run sync:molstudio-assets` regenerated the 55,026 B wasm;
  README pair drops SwiftShader open-time tables; `AGENTS.md` pin is `^0.1.8`.
  wasm-bench `/tmp/wasm-bench/017` now holds 0.1.8 so the shipped row is this
  version.
- Evidence: generated `MOLSTUDIO_CORE_VERSION = "0.1.8"`.
- Remaining: hardware run (`bun .verification/wasm-bench/tools/run.ts --gpu hardware`).
- Blockers: none.
- Next action: `bun run verify:fast`, then the hardware re-measure.

## Completion summary

Packed 0.1.8 tarball installed, assets regenerated (55,026 B wasm),
`bun run verify:fast` 397 tests. Hardware (ANGLE Metal): EMD-1832 58 vs 62 ms
GPU-vs-GPU; README uses BioViewer Studio numbers (300³ solid 486 → 284 ms,
wireframe iso ~8×, 512³ iso ~200–290×). See
`.verification/wasm-bench/results/handoff-0.1.5-vs-0.1.8.md`.
