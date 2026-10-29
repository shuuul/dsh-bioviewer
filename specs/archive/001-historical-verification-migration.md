---
id: "001"
title: "Historical verification migration"
status: Completed
created: 2026-10-29
updated: 2026-10-29
coordinator: "Spec-system worker"
---

# 001 — Historical verification migration

## Context

`docs/VERIFICATION.md` was a 1296-line revision 7 verification record. Its evidence
describes its own historical tree/environment, not the current loader changes.
The [unaltered original](evidence/verification-revision-7.md) remains authoritative
for those observations, including section 8, “What is still not verified”.

## Goal and success criteria

- [x] Preserve all original bytes and evidence in a linked archive artifact.
- [x] Retain a discoverable pointer at the old documentation path.
- [x] Distinguish historical verdicts from current acceptance and unfinished checks.

## Scope and non-goals

This migration record certifies evidence preservation only. It does not certify
that any old browser, WebGL, real-session, tool-to-viewer, gzip plumbing, preference
or performance checks were completed today. Source fixes and current acceptance
belong to [spec 002](002-loader-fixes-and-spec-migration.md), a separate execution record.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
| --- | --- | --- | --- |
| 2026-10-29 | Archive original bytes separately | Preserve contradictory/stale statements without rewriting evidence | WS-01 |
| 2026-10-29 | Complete migration, not historical product acceptance | Original section 8 remains unresolved unless new evidence says otherwise | WS-01 |

## Workstreams

| ID | Deliverable | Owner | Status | Dependencies | Verification |
| --- | --- | --- | --- | --- | --- |
| WS-01 | Preserve and link revision 7 evidence | Spec-system worker | Done | None | Byte checksum, line count, regression fixture |

## Verification

Original captured before replacement: `wc -l docs/VERIFICATION.md` = **1296**;
`shasum -a 256 docs/VERIFICATION.md` =
`33434bd14decd5dbfa1cffa8fc0069e25b6ec2ff824b3ab6f2ef45bc6ce7790f`.
The artifact was copied directly, without text transformation. The repository's
`tests/specs.test.ts` pins this checksum and line count, and checks the migration
pointer. Spec-system structural verification is recorded under spec 002.

## Documentation sync

- Durable historical evidence: `specs/archive/evidence/verification-revision-7.md`.
- Public old entry point: `docs/VERIFICATION.md` now identifies migration/current work.
- Developer lifecycle: `specs/README.md`, root `AGENTS.md`, paired README links.
- No experiment commits or final experiment refs were created by this migration.

## Progress and handoff

### 2026-10-29 — Spec-system worker — WS-01

- Captured the old report's checksum/line count and copied its original bytes.
- Preserved its claims and limitations verbatim; this record narrows completion
  to migration only. Current loader work remains in spec 002.
- Next action: use fresh evidence in 002 rather than editing the historical artifact.

## Completion summary

The historical evidence is preserved and linked. All migration success criteria
are complete; no historical unfinished product checks are claimed complete.
This record does not supersede the original report's explicit limitations.
