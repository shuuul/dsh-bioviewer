# Tracked execution specs

Copy [000-template.md](000-template.md) when work needs coordinated workstreams,
explicit acceptance evidence, or a handoff. Specs record execution, not permanent APIs.

## Active specs

| Spec | Status | Outcome |
| --- | --- | --- |

## Archived specs

| Spec | Completed | Outcome |
| --- | --- | --- |
| [001 — Historical verification migration](archive/001-historical-verification-migration.md) | 2026-10-29 | Preserve revision 7 evidence, not certify unfinished UI checks. |
| [002 — Loader fixes and spec migration](archive/002-loader-fixes-and-spec-migration.md) | 2026-10-29 | Loader fixes, scoped WebGL acceptance and tracked-spec gate. |
| [003 — Marketplace listing and product screenshots](archive/003-marketplace-listing.md) | 2026-10-30 | Shared BioViewer logo, App Store-style shots, public GitHub topics, catalog PRs. |
| [004 — DSH 0.2.2-rc.1 compatibility migration](archive/004-dsh-022-rc1-compat.md) | 2026-11-04 | Move manifests/peers/engines to 0.2.2-rc.1, single-cordis typecheck, anti-drift tests, real-host verify. |
| [005 — Upstream bump: dsh-better-sidebar 0.30.1 and MolStudio 0.1.5](archive/005-upstream-sidebar-0301.md) | 2026-11-05 | Bump the sidebar peer line, remove the single-cordis workaround, take MolStudio 0.1.5's snapshot flush, real-host verify. |
| [006 — Upstream bump: MolStudio 0.1.6 wasm surface engine](archive/006-molstudio-016-wasm.md) | 2026-11-09 | Ship the 0.1.6 wasm isosurface engine in the client bundle, measure 0.1.5 vs 0.1.6 end to end and the kernel in isolation. |

## Lifecycle and ownership

- `Draft` and `Active` live here; `Completed` lives in `archive/`. Blocking belongs
  to a workstream (`Pending`, `Claimed`, `In progress`, `Blocked`, `Done`), not a fourth status.
- Reserve the next continuous three-digit ID across both directories and index an
  Active spec before parallel implementation. Never reuse, renumber, or delete IDs.
- The coordinator owns frontmatter, scope, cross-workstream decisions, index and
  closeout. Workers claim stable workstream rows and append dated handoffs; do not
  rewrite someone else's evidence.
- Run `bun run check:specs` and `bun test tests/specs.test.ts` before and after
  archiving. Satisfy each success criterion or record its explicit removal decision;
  sync durable behavior to code, tests, docs and the nearest `AGENTS.md` first.
- Record commands/results, completion summary and any final experiment Git refs
  under Documentation sync. Set `Completed`, update the date, move the unchanged
  filename to `archive/`, and move the index row in the same change. Keep tables
  ascending numerically and link every formal spec exactly once.
- Evidence artifacts live under `archive/evidence/`, outside the formal spec namespace.
  Preserve historical artifacts byte-for-byte; historical PASS is not current acceptance.
