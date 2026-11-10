---
id: "009"
title: "Upstream bump: MolStudio 0.1.9"
status: Completed
created: 2026-11-10
updated: 2026-11-10
coordinator: "omp"
---

# 009 — Upstream bump: MolStudio 0.1.9

## Context

`@molstudio/core` / `@molstudio/react` 0.1.9 is published on npm as `latest`.
The published tarball diff (0.1.8 → 0.1.9, the `.d.ts` and runtime sources of
all three `@molstudio/*` packages) shows:

- `setAxesInset` → `setViewportInset` (also drives the Mol* viewport); new
  `viewportForInset` export. Not used by this plugin.
- React `Run` now returns `Promise<boolean>`; `DensityChartProps.onChange` may
  be async. Internal to `<Studio>`.
- Locale `contour.author` message changed to `"Author {value}, {level} σ"` —
  this plugin does not override that key.
- `StudioProps.onReady` may now return a rejected promise; Studio surfaces it.
- `describeVolume` / `describeMarkers` omit pending cells from the snapshot.
- Failed `loadStructure` / `loadVolume` (and URL variants) now remove the
  partial node and **reject**; malformed volume data rejects with
  "The <fmt> data could not be parsed into a volume." (0.1.8 silently
  succeeded), and empty structures reject "The <fmt> data contains no atoms."
- `loadEmdb` still resolves when the author-contour fetch fails (console.warn).
- `loadMarkers` structuredClones the set.
- `setVisible`/`setOpacity`/`setIsoLevel`/`applyAuthorLevel` now throw on bad
  input.
- Spin animation and image export fixes; worker `onmessageerror` settles
  requests and disposes the engine; wasm rebuilt (55,105 B, was 55,026 B);
  worker protocol unchanged (`init`/`ready`/`mesh`/`lines`/`downsample`/
  `downsampled`).

## Goal and success criteria

- [x] `@molstudio/core` / `@molstudio/react` are `^0.1.9`; embedded assets
      regenerated (`bun run sync:molstudio-assets`); wasm is 55,105 B and
      `tests/wasm-asset.test.ts` passes.
- [x] The integration is reviewed against the 0.1.9 behaviour changes
      (load-reject paths, snapshot omissions, worker `onmessageerror`, React 18
      API floor); any consumer bug found is fixed with a regression test.
- [x] `AGENTS.md` contracts 12/13 and both READMEs state 0.1.9 behaviour.
- [x] `bun run verify:fast` passes.

## Scope and non-goals

In scope:

- Dependency bump, asset sync, integration review, bug fixes in this repo,
  durable docs.

Not in scope:

- Changing MolStudio itself (`/Users/shuuul/repo/molstudio`). Library bugs
  are reported, not patched around.
- Plugin version bump / release.
- Live `dsh --profile web` host run (reported as not run).

## Decisions

| Date | Decision | Rationale | Affected workstreams |
| --- | --- | --- | --- |
| 2026-11-10 | Keep embedded engine wiring | 0.1.9 still resolves packaged wasm/worker from `import.meta.url`; `SurfaceEngineAssets` unchanged | WS-01 |
| 2026-11-10 | Error card + remount retry for failed studio creation | `MolStudio.create` rejects (e.g. no WebGL); a spinner that never ends is the wrong pane, and `<Studio>`'s create effect only runs on mount so a retry needs a new key | WS-02 |

## Workstreams

| ID | Deliverable | Owner | Status | Dependencies | Verification |
| --- | --- | --- | --- | --- | --- |
| WS-01 | Bump to 0.1.9 and regenerate embedded assets | omp | Done | None | `tests/wasm-asset.test.ts` |
| WS-02 | Review integration vs 0.1.9 behaviour changes; fix demonstrated bugs | omp | Done | WS-01 | targeted `bun test` |
| WS-03 | Docs (AGENTS.md, README pair) | omp | Done | WS-01 | `bun run verify:fast` |

## Verification

- `bun run check:specs` and `bun test tests/specs.test.ts`: pass before the
  archive move (55 spec tests).
- `bun run verify:fast`: specs → lint → typecheck → build → test all pass;
  **399 tests, 0 fail, 3,927 `expect()` calls** (was 397 on 0.1.8).
- `bun test tests/wasm-asset.test.ts`: 6 pass — `@molstudio/core@0.1.9`,
  55,105 B wasm module, 3,872 B worker source; ABI instantiates
  (`mc_mesh`, `mc_lines`, `ds_run`, `ds_from_staging`, `grid_*`, `lines_*`).
- `tests/build.test.ts` C4: `lib/client.js` carries exactly one
  `data:application/wasm;base64,` URL (literal count = 1) and zero `file:///`
  occurrences; the decoded module is 55,105 B and starts with `\0asm`.
- React-18 audit: every `react`/`react-dom`/`react/jsx-runtime` named import in
  `node_modules/@molstudio/react/dist` (`useState`, `useEffect`, `useMemo`,
  `useRef`, `useCallback`, `useLayoutEffect`, `useId`, `useContext`,
  `useSyncExternalStore`, `createContext`, `createPortal`, `jsx`/`jsxs`/
  `Fragment`) exists in React 18.3.1.
- Integration review: snapshot omission of pending cells is safe for this
  consumer (loads are serialised per studio and awaited before the next
  `removeObjectsMatching` reads `getSnapshot()`); `loadEmdb` resolving without
  the author contour only reduces the error-card surface; `loadMarkers`
  structuredClone is invisible to us; no consumer calls `setVisible`,
  `setOpacity`, `setIsoLevel`, `applyAuthorLevel`, `setViewportInset`, or
  overrides `contour.author`/`messages`; `Run`/`onChange` returning promises is
  internal to `<Studio>`; the embedded worker is re-synced and the bundled
  `worker-engine.js` brings the new `onmessageerror` handling with it.
- Not verified: a live `dsh --profile web` host run. Per AGENTS.md it is only
  required after touching `src/index.ts` (untouched), and no host run was
  available in this session.

## Documentation sync

- `AGENTS.md` contracts 9/12/13: `^0.1.9` floor, snapshot pending-cell
  omission, structuredClone markers, hardened worker/load edges.
- `README.md` + `README_EN.md`: ~55 KB wasm, 0.1.9 failure-mode note.
- `scripts/sync-molstudio-assets.ts`: generated header no longer hardcodes a
  version; comment sizes updated (~55 KB).
- `src/client/load.ts`: comment no longer claims a failed load leaves partial
  objects to clean up.

## Progress and handoff

### 2026-11-10 — omp — WS-01/WS-03

- Changed: `@molstudio/core` / `@molstudio/react` `^0.1.9` installed (bun.lock);
  `bun run sync:molstudio-assets` regenerated `generated/molstudio-assets.ts`
  (0.1.9, 55,105 B wasm, 3,872 B worker IIFE); sync-script template fixed;
  `AGENTS.md` and both READMEs updated.
- Evidence: `MOLSTUDIO_CORE_VERSION = "0.1.9"`, `MOLSTUDIO_WASM_BYTES = 55105`;
  `bun run verify:fast` 399 pass / 0 fail.
- Remaining: none.
- Blockers: none.
- Next action: archive.

### 2026-11-10 — omp — WS-02

- Changed: `src/client/agent-opens.ts` — `handleViewerRequest` now clears the
  `opening` mark (new `clearOpening` in `studios.ts`) when `dispatchOpen`
  throws, so later `bio_add` requests retry a fresh tab instead of parking in
  `pending` forever. `src/client/studio.tsx` — a failed `MolStudio.create`
  (and 0.1.9's newly catchable rejected `onReady`) now shows the error card
  with a retry that remounts `<Studio>` (`key={studioRetry}`), instead of a
  perpetual "Starting the Mol* viewer…" spinner; the transient-error banner is
  suppressed while no studio exists (the card carries the same message).
- Evidence: `tests/agent-opens.test.ts` "a dispatch failure unmarks the
  opening…" (file: 23 pass); `tests/fixtures/viewer-studio-error.tsx` +
  `tests/viewer.test.ts` (2 pass).
- Remaining: none.
- Blockers: none.
- Next action: closeout.

## Completion summary

Bumped `@molstudio/core` / `@molstudio/react` to `^0.1.9` and re-synced the
embedded wasm (55,105 B) + worker assets. Reviewed every 0.1.9 behaviour
change against the integration: snapshot pending-cell omissions, load-reject
paths, EMDB tolerance, worker `onmessageerror`, React-18 API floor — all
compatible with no shims. Fixed two consumer bugs demonstrated by tests:
`handleViewerRequest` left `isOpening` latched when `dispatchOpen` threw
(every later `bio_add` queued forever), and a failed `MolStudio.create` left a
perpetual spinner with no retry (now an error card that remounts `<Studio>`).
`bun run verify:fast`: 399 tests, 0 failures. No library defects found; none
worked around. Live `dsh --profile web` run not performed (host half
untouched).
