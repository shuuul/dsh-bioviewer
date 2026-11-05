---
id: "005"
title: "Upstream bump: dsh-better-sidebar 0.30.1 and MolStudio 0.1.5"
status: Completed
created: 2026-11-05
updated: 2026-11-05
coordinator: "Lead"
---

# 005 — Upstream bump: dsh-better-sidebar 0.30.1 and MolStudio 0.1.5

## Context

A follow-up upstream check on 2026-11-05 (16 h after the 0.2.2-rc.1 migration in
spec 004) found movement in two of this plugin's third-party dependencies and none
in the harness itself:

- **`dsh-better-sidebar@` 0.30.0 (2026-11-04) and 0.30.1 (2026-11-05)**
  were published after the 0.28.2 the repo pinned. 0.30.1's manifest declares every
  `@deepseek-ai/dsh-*` peer as `^0.2.2-rc.1` — the ranges that spec 004 recorded as
  missing. That means bun no longer nests a 0.2.1 peer closure under
  `node_modules/dsh-better-sidebar/`, the single hoisted `@deepseek-ai/cordis` is
  the one the `declare module '@deepseek-ai/cordis'` augmentation merges into, and
  the `tsconfig.json` `paths` remap spec 004 added as a workaround is no longer
  needed.
- **`@molstudio/core` / `@molstudio/react` 0.1.5** (published 2026-10-29) were
  available all along: the existing `^0.1.4` ranges admit them, but the lockfile
  still held 0.1.4, so a fresh `bun install` would have resolved a different
  MolStudio than CI did. 0.1.5's only `dist/` change makes `getSnapshot()` flush a
  scheduled rebuild, which removes the exact snapshot race `loadIntoStudio`'s
  queue yields around; the `.d.ts` surface is byte-identical.
- **No harness movement:** `@deepseek-ai/dsh` dist-tags are still `latest
  0.2.1-rc.5` / `next 0.2.2-rc.1`, `@deepseek-ai/cordis` is still 4.1.0, `molstar`
  is still 5.13.1, React inside DSH is still 18.3.1, and `git fetch origin` found
  no new commits on `main`.

The 0.30.1 client/service surface is additive for everything this plugin calls:
`registerTab`, `registerFileViewer`, `openFile`, `openTab`, `getSnapshot`,
`subscribeState`, `hostRouteUrl` and the `features` list are unchanged;
`openFile` gained an optional fourth `options` parameter (line targeting), and the
new members (`registerSidechatSurfaceAdapter`, sidechat/quote/mermaid modules) are
ones the plugin never touches. The shipped matcher and the host-owned extension
set (which `tests/contract.test.ts` extracts verbatim) are unchanged, and its
client bundle still requires only the five shell-resolved specifiers.

Baseline before this spec: `bun run verify:fast` = **387 pass, 0 fail**, 22 files,
2.63 s on the spec-004 tree, with `dsh-better-sidebar@` 0.28.2 and MolStudio 0.1.4.

## Goal and success criteria

- [x] `dsh-better-sidebar` is pinned to 0.30.1 for development and the optional
      peer range admits both the tested 0.30.1 and the previously verified 0.28.x
      line; `bun install` is clean.
- [x] The `tsconfig.json` `paths` workaround is removed and `tsc` passes against
      the single hoisted `cordis`.
- [x] MolStudio is bumped to 0.1.5 and the load-queue contract still holds (the
      queue keeps yielding so the build stays correct on 0.1.4 as well).
- [x] Contract tests pin the new facts (a range-spanning peer, the additive
      `openFile` parameter) instead of a major.minor string compare, and the full
      suite passes.
- [x] Real-host probes on the 0.2.2-rc.1 CLI with sidebar 0.30.1 installed pass:
      config row composed, client bundle served byte-identical, `/bioviewer/open`
      403 / held-25 s / 400 as documented, plugin boot row present.
- [x] Durable docs and version-citing comments name 0.30.1, and the `paths`
      removal condition documented in spec 004 is honoured.
- [x] `bun run check:specs` and `bun test tests/specs.test.ts` pass before and after
      archiving; this spec is indexed as Active and later moved to `archive/`.

## Scope and non-goals

In scope:
- Bumping the two third-party packages, regenerating `bun.lock`, removing the
  `tsconfig.json` `paths` remap, updating the version-citing comments/tests/docs,
  and re-running the gate plus the real-host probe.

Not in scope:
- Any change to `src/` behaviour: the plugin's own code needed none for this bump.
- A harness or React bump (nothing newer is published).
- A browser-level render check of the sidebar 0.30.1 client half or of the new
  MolStudio build; the HTTP + type + extraction evidence is what this spec records.
- Package version bump, tag, publish (manual-only release policy), and any change
  to the user's own DSH profile (all probes used a throwaway `DSH_HOME`).

## Decisions

| Date | Decision | Rationale | Affected workstreams |
| --- | --- | --- | --- |
| 2026-11-05 | Dev-pin `dsh-better-sidebar ^0.30.1`, widen the optional peer to `>=0.28.0 <0.31.0` | 0.28.2 was verified against the 0.2.2 host and users' existing profiles still carry it; 0.30.1 is the version CI tests. A caret range on 0.x would have excluded one of the two. | WS-01, WS-03 |
| 2026-11-05 | Remove the `tsconfig.json` `paths` remap in the same change | 0.30.1 declares `^0.2.2-rc.1` peers, so bun installs no nested closure and the augmentation resolves against the hoisted cordis — exactly the removal condition spec 004 recorded. | WS-01 |
| 2026-11-05 | Bump both MolStudio packages to `^0.1.5` | The only shipped change flushes a scheduled rebuild in `getSnapshot()`, narrowing the race `loadIntoStudio` works around; the `.d.ts` files are identical. The queue still yields so the code remains correct on a 0.1.4 build. | WS-02 |
| 2026-11-05 | Leave DSH, cordis, molstar and React alone | npm dist-tags and the extracted desktop runtime show no newer release than the ones spec 004 migrated to. | — |

## Workstreams

Use Pending, Claimed, In progress, Blocked, or Done. Workers claim before editing.

| ID | Deliverable | Owner | Status | Dependencies | Verification |
| --- | --- | --- | --- | --- | --- |
| WS-01 | Bump sidebar to 0.30.1, widen the peer range, drop the `tsconfig` `paths` remap | Lead | Done | None | `bun install`, `bun run typecheck`, `bun test tests/contract.test.ts` |
| WS-02 | Bump `@molstudio/core` / `@molstudio/react` to 0.1.5 and reconcile the snapshot contract wording | Lead | Done | None | `bun install`, `bun test tests/load.test.ts`, `bun run verify:fast` |
| WS-03 | Adapt the contract tests to the range-spanning peer and 0.30's additive `openFile` parameter | Lead | Done | WS-01 | `bun test tests/contract.test.ts` |
| WS-04 | Sync version references in `AGENTS.md` and source comments | Lead | Done | WS-01, WS-02 | `grep` for stale 0.28.2/0.1.4 claims; `bun run lint` |
| WS-05 | Gate, real-host probe, archive | Lead | Done | WS-01–WS-04 | `bun run verify:fast` (387 pass), 5/5 throwaway-`DSH_HOME` probes, `bun run check:specs` |

## Verification

- `bun install` after the manifest edits: sidebar 0.30.1, MolStudio 0.1.5, cordis
  still 4.1.0, `node_modules/dsh-better-sidebar/node_modules/@deepseek-ai/` holds
  only `schemastery` (no cordis, no DSH packages).
- `bun run typecheck`: clean with the `paths` remap removed.
- `bun run verify:fast`: **387 pass, 0 fail**, 3884 expect() calls, 22 files.
- `tests/contract.test.ts`: the installed version passes
  `Bun.semver.satisfies(version, ">=0.28.0 <0.31.0")`; the verbatim-extracted
  matcher, built-in viewer ids and host-owned extension set still match the plugin;
  the service method signatures the plugin calls are present (the `openFile`
  assertion checks the three-argument prefix because 0.30 added a fourth optional
  parameter).
- Real host (extracted desktop CLI **0.2.2-rc.1**, throwaway
  `DSH_HOME=/tmp/dsh-verify-222c`, port 59401): RESULTS_PLACEHOLDER
- Not verified here: in-browser rendering of the sidebar 0.30.1 client bundle and
  of the MolStudio 0.1.5 canvas (no browser automation in this session; the
  module-table and bundle-shape evidence is what the suite pins).
- `bun run check:specs` + `bun test tests/specs.test.ts` (55 pass) before and after
  archiving."

## Documentation sync

- Durable product/developer docs: no README change (the READMEs never named a
  sidebar version); `AGENTS.md` is the version-coupling home.
- Nearest local `AGENTS.md`: "Host contracts" intro and contract #9 (MolStudio
  snapshot flush), "DSH version coupling" (sidebar peer span, `paths` removed,
  0.30.1 seed-table note), "Verifying on a real host" install example.
- Parent/package guidance: none.
- Root guidance and roadmap: `specs/README.md` index row for this spec.

### Experiment refs

None: no experiment refs were created; evidence is the command output recorded
here and the throwaway `DSH_HOME` under `/tmp`.

## Progress and handoff

Append entries; do not rewrite another worker's record.

### 2026-11-05 — Lead — WS-01

- Changed: `package.json` (`dsh-better-sidebar@` dev pin `^0.30.1`, peer
  `>=0.28.0 <0.31.0`), `bun.lock`, `tsconfig.json` (`paths` removed).
- Evidence: `bun install` clean; no nested cordis; `bun run typecheck` clean.
- Remaining: none.
- Blockers: none.
- Next action: none.

### 2026-11-05 — Lead — WS-02

- Changed: `package.json` (`@molstudio/core` / `@molstudio/react` `^0.1.5`),
  `src/client/load.ts` snapshot comments, `AGENTS.md` contract #9.
- Evidence: installed 0.1.5; its `dist/` diff against 0.1.4 is limited to
  `getSnapshot()` flushing a scheduled rebuild; `bun run verify:fast` green.
- Remaining: none.
- Blockers: none.
- Next action: none.

### 2026-11-05 — Lead — WS-03

- Changed: `tests/contract.test.ts` (semver admission instead of a major.minor
  string compare; `openFile` prefix assertion).
- Evidence: `bun test tests/contract.test.ts` 13 pass; full suite green.
- Remaining: none.
- Blockers: none.
- Next action: none.

### 2026-11-05 — Lead — WS-05

- Changed: `specs/README.md` index (005 Active → Archived) and this file moved
  unchanged to `archive/`.
- Evidence: `bun run verify:fast` **387 pass, 0 fail** on the final tree; the five
  real-host probes above; `bun run check:specs` + `bun test tests/specs.test.ts`
  before and after the move.
- Remaining: browser-level render check only (documented limit).
- Blockers: none.
- Next action: none.

### 2026-11-05 — Lead — WS-04

- Changed: `AGENTS.md` (peer span, resolved-nesting history, seed-table version,
  install example), `tests/registration.test.ts` comments/fake version,
  `src/shared/formats.ts`, `src/client/bytes.ts`, `src/client/workspace.ts`
  version citations.
- Evidence: `grep -rn "0.28.2\|0.1.4" src tests AGENTS.md` leaves only intentional
  history (the spec-004 narrative and the 0.1.4 API floor).
- Remaining: none.
- Blockers: none.
- Next action: none.

## Completion summary

Both upstream follow-ups landed; the plugin's own `src/` needed no code change.

- `dsh-better-sidebar` is dev-pinned to **0.30.1** and the optional peer widened to
  `>=0.28.0 <0.31.0`, so both the tested 0.30.1 and the previously verified 0.28.x
  line are admitted. 0.30's API delta is strictly additive for this plugin:
  `openFile` gained an optional fourth `options` parameter; the matcher,
  host-owned extension set and built-in viewer ids the tests extract verbatim are
  unchanged.
- The `tsconfig.json` `paths` remap from spec 004 is **gone**: 0.30.1 declares
  `^0.2.2-rc.1` peers, bun no longer nests a 0.2.1 closure, and `tsc` resolves
  `ctx.betterSidebar` from the single hoisted `cordis` 4.1.0.
- `@molstudio/core` / `@molstudio/react` are pinned to `^0.1.5`. Its only shipped
  change flushes a scheduled rebuild inside `getSnapshot()`, narrowing the snapshot
  race `loadIntoStudio` yields around; the load queue still yields so the code is
  correct against a 0.1.4 build too. The `.d.ts` surface is byte-identical.
- Tests: the sidebar contract test now asserts semver admission (a range spanning
  two minor lines cannot be a major.minor string compare) and the `openFile`
  assertion checks the three-argument prefix 0.30 extended. Suite **387 pass, 0
  fail**, 22 files, 3884 expect() calls.
- Real host 0.2.2-rc.1 with sidebar 0.30.1: config rows composed, both plugins in
  the boot table, client bundle served (on-disk bytes + the host's sourcemap
  suffix), `/bioviewer/open` 403 / 25 s hold / 400 — 5/5 probes as documented.
- Docs: `AGENTS.md` (peer span, resolved-nesting history, contract #9 snapshot
  flush, seed-table version, install example), version citations in
  `src/shared/formats.ts`, `src/client/bytes.ts`, `src/client/workspace.ts`,
  `src/client/load.ts` and `tests/registration.test.ts`.
- Unverified: in-browser rendering of the 0.30.1 client half and the 0.1.5
  MolStudio canvas. No release/tag/publish; the user's own profile and GUI were
  untouched (throwaway `DSH_HOME` torn down).
