---
id: "002"
title: "Loader fixes and spec migration"
status: Completed
created: 2026-10-29
updated: 2026-10-29
coordinator: "Main implementation agent"
---

# 002 — Loader fixes and spec migration

## Context

The existing verification report is historical revision 7 evidence, including
explicitly unfinished browser/UI checks. Current work spans this plugin and the
MolStudio core in a sibling repository; a coordinator must own combined proof.
This spec and its index row were reserved before spec-system implementation.

## Goal and success criteria

- [x] Coordinator records the exact cross-repository loader fixes and revision identities.
- [x] Combined gate and relevant real-host/browser loader scenarios pass, with commands
  and observed outcomes recorded; distinguish checks not performed.
- [x] Tracked-spec template, index, lifecycle validator and real-validator fixture tests pass.
- [x] Historical evidence survives byte-for-byte with a clear migration pointer.
- [x] Local/CI gate is wired to check specs before build, including Markdown-only changes;
  Bun pins match the observed local version and no release automation is added.

## Scope and non-goals

In scope: loader compatibility fixes coordinated by the main agent, historical
verification migration, spec validator/tests, developer guidance and CI integration.
Source fixes and other repositories belong to the coordinator, not the spec worker.
No publishing, commits, pushes, release automation or certification of historical
unfinished checks is in scope.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
| --- | --- | --- | --- |
| 2026-10-29 | Reserve 001 for migration, 002 for current execution | Preserve history without presenting old evidence as new proof | WS-01, WS-02 |
| 2026-10-29 | Keep Bun/oxlint/tsc/husky and manual releases | Preserve repository toolchain and explicit release policy | WS-02 |

## Workstreams

| ID | Deliverable | Owner | Status | Dependencies | Verification |
| --- | --- | --- | --- | --- | --- |
| WS-01 | Cross-repository loader fixes and combined acceptance | Main implementation agent | Done | WS-02 | Combined gate and relevant live-host/browser evidence |
| WS-02 | Spec system, evidence migration, docs and CI | Spec-system worker | Done | None | check:specs, fixture tests, lint/typecheck, evidence checksum |

## Verification

Planned: `bun run check:specs`, `bun test tests/specs.test.ts`, `bun run lint`,
`bun run typecheck`, then coordinator's `bun run verify:fast` and combined live
checks. Results are appended below, not assumed from the historical report.

## Documentation sync

- Durable product/developer docs: paired READMEs and `docs/VERIFICATION.md` pointer.
- Nearest local and root guidance: root `AGENTS.md` spec workflow and gate commands.
- Parent/package guidance: `package.json` and CI agree on Bun version and gate.
- Other repository behavior and any experiment refs: coordinator records at closeout.
- MolStudio core snapshot contract and test command are recorded in its root `AGENTS.md`.
- No experiment refs, commits, pushes, dependency releases or version bumps were created.

## Progress and handoff

### 2026-10-29 — Spec-system worker — WS-02

- Claimed this workstream and reserved index entries before implementation.
- Observed local `bun --version`: `1.4.4`; original verification: 1296 lines,
  SHA-256 `33434bd14decd5dbfa1cffa8fc0069e25b6ec2ff824b3ab6f2ef45bc6ce7790f`.
- Remaining: implement and check the spec system; coordinator owns source fixes
  and final combined verification and closeout.

### 2026-10-29 — Spec-system worker delivery — WS-02

- Added template/index/archive lifecycle, dependency-free `scripts/check-specs.mjs`
  and real-validator temporary-fixture tests covering the contract, archive transition,
  aggregated failures, evidence identity and gate wiring. Temporary fixtures clean up.
- Preserved all 1296 original evidence lines byte-for-byte at
  `specs/archive/evidence/verification-revision-7.md`; SHA-256 matches the capture above.
- Updated paired READMEs, root guidance, old verification pointer, manifest and CI.
  `check:specs` is first in `verify:fast`; Markdown-only PRs no longer skip CI.
  `packageManager` and `setup-bun` pin the observed Bun 1.4.4. Existing toolchain,
  action majors and deliberate absence of release automation are preserved.
- Upstream latest-release API checks found checkout v7.0.1, setup-bun v2.2.0 and
  cache v6.1.0, confirming existing major refs; no action-major migration was needed.
- Checks: `bun run check:specs` and `node scripts/check-specs.mjs` both passed;
  `bun test tests/specs.test.ts tests/readme.test.ts`: **60 pass, 0 fail**
  (55 spec tests, 5 README tests, 216 assertions). `bun run lint`,
  `bun run typecheck` and `git diff --check` passed.
- An initial lint warning for an unnecessary regex escape was corrected with
  oxlint's fixer; the final deny-warnings lint gate passed unchanged.
- Not run by this worker: full build/combined gate, live-host/browser scenarios,
  or hosted CI. Coordinator owns those checks and final WS-01 acceptance. Other
  workers' source/test edits were preserved. Keep this spec Active.

## Completion summary

Local implementation and scoped acceptance are complete. Spec migration preserves
historical evidence without upgrading its verdicts. Loader fixes cover stable
database payload identity, serialized replacement, superseded queued work and real
AlphaFold entry labels. MolStudio now exposes committed objects synchronously through
`getSnapshot()`. No source change was needed in the VS Code consumer.
Changes remain uncommitted and unpublished across repositories; hosted CI and live
remote AlphaFold loading are not certified by this closeout.

### 2026-10-29 — Coordinator acceptance — WS-01

- Baseline revisions (all fixes are local edits on these revisions):
  dsh-bioviewer `b867c8b3b5e99439c5368738ab068e1dc5aad784`,
  molstudio `0ec4b677bac51b95d11b80953149545268769caf`,
  bioviewer `fcc337c82a1d62b9a79033cb53d51df6f401e0c1`.
- DSH changes: `StructureTabView` memoizes database payloads; `loadIntoStudio`
  serializes removal and loading per studio, skips aborted queued work and recovers
  after failure. AlphaFold replacement matches the exact accession namespace and
  object kind. A timer yield retains compatibility with published core 0.1.4.
- MolStudio changes: `getSnapshot()` rebuilds dirty hierarchy objects synchronously
  while subscriber notifications remain batched. A real-controller regression checks
  immediate reads, additive loads, reference stability and eventual notification.
  Existing bioviewer `ViewerController` already serializes loads; no source edit needed.
- Before/after regressions: original DSH code duplicated AlphaFold/concurrent reloads;
  original theme path downloaded twice instead of once; original core returned an
  empty snapshot immediately after an awaited load. All pass with the fixes.
- `bun run verify:fast` in DSH: 358 pass, 0 fail, including build, lint, typecheck,
  lifecycle regression and validator fixtures. Frozen install and whitespace checks pass.
- `bun run verify` in molstudio passes lint, workspace typechecks, core controller
  regression, Rust checks/tests and package/demo builds. In bioviewer,
  `npm run compile && npm run compile-tests` passes (including its lint step).
  The VS Code extension-host test suite was not run.
- Isolated DSH host on port 59391 rendered a real MRC file. Final browser replay uses
  the actual React renderer, Mol* parser/WebGL, DSH adapter and sibling core source;
  RCSB 1CRN mmCIF and multi-marker CMM are local fixtures. AlphaFold API is a fixture
  returning `AF-P00533-F1`, not a successful live API download.
- Browser assertions: theme-only render retains object ID and download count;
  overlapping delayed reloads leave one PDB; two AlphaFold loads leave one entry
  beside the PDB; repeated multi-set marker load leaves exactly four objects;
  subsequent dark/light flips retain five total downloads and four objects.
  Final screenshots inspected in both themes: structures/markers visible, correct
  object list and no loading/error overlay. Fixture coordinates are not co-registered,
  so marker groups and the structure appear separated in the fitted camera view.
- Local review artifacts: `.amp/in/artifacts/dsh-verify.log`,
  `loader-browser-result.json`, `loader-dark.png`, `loader-light.png`.
  These ignored artifacts supplement, rather than replace, the durable results above.
- Limitations: live AlphaFold API returned HTTP 403; no hosted CI, performance survey,
  full tool-to-viewer/session/gzip end-to-end matrix or publishing performed.
  These historical checks are outside this fix's acceptance, not newly certified.
- Closeout checks: spec validator and its 55 tests pass before archive transition;
  validator and combined gate are rerun after moving the file/index.
