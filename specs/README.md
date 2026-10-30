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
