---
id: "004"
title: "DSH 0.2.2-rc.1 compatibility migration"
status: Completed
created: 2026-11-04
updated: 2026-11-04
coordinator: "Lead"
---

# 004 — DSH 0.2.2-rc.1 compatibility migration

## Context

The local DeepSeek Harness moved from the `0.2.1-rc.4` type pins to the desktop
app's runtime, **0.2.2-rc.1**. That runtime ships `@deepseek-ai/cordis` **4.1.0**
(`~4.1.0` peers on every `@deepseek-ai/*` package), requires **Node.js 24.9+**, and
rewrote `@deepseek-ai/dsh-tools`' registry (`ToolRuntime` → `ToolsService`, now
split into `contracts.ts` / `executor.ts` / `events.ts` / `batch.ts` /
`pipeline.ts`; `defineTool` and `ToolRunContext` are still exported and
`ToolDefinition` only gained optional fields). Audited against the extracted
runtime and the npm tarballs for `cordis` 4.1.0, `dsh-tools`, `dsh-session`,
`dsh-host-webserver` and `dsh-working-directory` 0.2.2-rc.1: everything this
plugin calls is intact, so the migration is a **manifest/dev-environment fix**,
not a source rewrite.

Evidence collected before touching the repo (all `semver.satisfies` results are
node-semver/Bun-semver behaviour, verified directly):

- `^0.2.1-rc.1 -> 0.2.2-rc.1` = **false** and `^0.2.1-rc.4 -> 0.2.2-rc.1` = **false**:
  a pre-release only satisfies a comparator set that names a pre-release of its own
  `[major,minor,patch]` tuple. The shipped peer floor `@deepseek-ai/dsh-tools
  ^0.2.1-rc.1` therefore cannot resolve on a 0.2.2 host, even though the plugin's
  host code is source-compatible.
- `dsh-better-sidebar` 0.28.2 (the newest release; last published 2026-10-27) still
  declares `@deepseek-ai/cordis ^4.0.5` and every `@deepseek-ai/dsh-*` peer as
  `^0.2.1-rc.1`. Because those ranges exclude 0.2.2-rc.1, bun installs a nested
  0.2.1 peer closure (including a second `@deepseek-ai/cordis`) under
  `node_modules/dsh-better-sidebar/`; its
  `declare module '@deepseek-ai/cordis' { interface Context { betterSidebar } }`
  augmentation then merges into the nested copy and `tsc` loses
  `ctx.betterSidebar` (30 × `TS2339` plus cascading implicit-any).
- The client shell contract is unchanged in 0.2.2: `window.__ModuleLoader__.load({ id,
  factory })` still hands over the factory, React is still **18.3.1**, and the
  module table now seeds **11** specifiers (`react`, `react/jsx-runtime`,
  `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `zod`,
  `@tanstack/react-virtual`, `@deepseek-ai/dsh-client-store`,
  `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`,
  `@deepseek-ai/dsh-client-ui-dockkit`) — our four React externals are still in it.
  The manifest is still `manifestVersion: 1` with `dsh.client.platform: "web"`
  and only gained optional fields (`optionalDependencies`, `platforms`,
  `listedByDefault`).
- `dsh-host-webserver` 0.2.2 adds `WebResource`/`WebResourceRoute` but keeps
  `register` and its prefix handling; `dsh-session` changed docs only;
  `dsh-working-directory` dropped an unused projection augmentation while keeping
  `get(session)`.

Baseline before this spec: `bun run verify:fast` = **385 pass, 0 fail**, 22 files,
2.65 s on HEAD `7861247`, version 0.1.2.

## Goal and success criteria

- [x] Dev dependencies, `@deepseek-ai/dsh-tools` peer floor, `engines.node` and the
      lockfile describe the 0.2.2-rc.1 host; `bun install` is clean and the peer
      ranges admit the installed versions.
- [x] `tsc`, the build and the full test suite pass against the 0.2.2 type surface.
- [x] A regression test fails if a declared peer range stops admitting the version
      CI actually installs (the class of bug that prompted this migration).
- [x] The client half is verified against the 0.2.2 shell: four React externals are
      seed words, React 18.3.1, `__ModuleLoader__` handoff works, and
      `dsh-better-sidebar` 0.28.2's own client bundle loads against the 11-entry
      seed table (its 5 `require` specifiers are all covered).
- [x] Real-host probes (throwaway `DSH_HOME`, host 0.2.2-rc.1) pass: config row
      composed, client bundle 200, `/bioviewer/open` 403/held/400 as documented.
- [x] Durable docs record the version coupling and the reason the `tsconfig` `paths`
      entry exists; README pair states the host requirement.
- [x] `bun run check:specs` and `bun test tests/specs.test.ts` pass before and after
      archiving; this spec is indexed as Active and later moved to `archive/`.

## Scope and non-goals

In scope:
- `package.json` devDependencies/peerDependencies/engines/overrides cleanup and
  `bun.lock`.
- `tsconfig.json` `paths` for `@deepseek-ai/cordis` (single-instance typecheck).
- `tests/contract.test.ts` peer-range/installed-version invariant.
- `AGENTS.md`, `README.md`, `README_EN.md` version guidance.
- Real-host verification on the 0.2.2-rc.1 CLI.

Not in scope:
- Any change to `dsh-better-sidebar` (upstream, optional peer) or a fork/patch of
  its peer ranges; the nesting is documented and worked around at typecheck level.
- Rewriting host code for the `dsh-tools` registry rewrite — the public surface the
  plugin uses (`defineTool`, `ToolRunContext`, `tools.register`) is unchanged.
- New locales (`de/es/fr/ja/pt/ru` now exist in 0.2.2; the plugin keeps `en`/`zh-CN`).
- Version bump, tag, publish (release policy is manual-only and not requested).
- Replacing or restarting the user's live GUI.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
| --- | --- | --- | --- |
| 2026-11-04 | Bump `@deepseek-ai/*` devDeps, the `dsh-tools` peer and the `cordis` peer to `^0.2.2-rc.1` / `^4.1.0`; keep `dsh-better-sidebar` peer `^0.28.0`. | Sidebar has no newer release; the peer floors must admit the host or peer-enforcing installers reject it. | WS-01 |
| 2026-11-04 | `engines.node` → `>=24.9`. | The 0.2.2 host requires Node 24.9; the plugin executes inside it. | WS-01 |
| 2026-11-04 | Add `tsconfig.json` `paths: { "@deepseek-ai/cordis": ["./node_modules/@deepseek-ai/cordis"] }`. | bun nests a second cordis because of sidebar 0.28.2's stale peers; the host has exactly one instance, and the remap restores the upstream module augmentation. | WS-01 |
| 2026-11-04 | Add a contract test that every declared peer range admits the installed version. | The old floor failed only at install time on the new host; CI now catches that class. | WS-01 |
| 2026-11-04 | No source changes for the host API or client shell. | Diff audit found no removed or behaviour-changed surface the plugin uses. | WS-02 |
| 2026-11-04 | Record, but do not fix, the upstream `dsh-better-sidebar` peer gap. | Not this repo's artifact; the workaround is local and documented for removal. | WS-02 |

## Workstreams

| ID | Deliverable | Owner | Status | Dependencies | Verification |
| --- | --- | --- | --- | --- | --- |
| WS-01 | Manifest/lockfile/engines/peers + `tsconfig` paths + peer invariant test | Lead | Done | None | `bun install`, `bun run verify:fast` (386 pass) |
| WS-02 | Read-only audit of host API and client-half compatibility on 0.2.2-rc.1 | compat-audit | Done | None | No runtime breakage; 6 remaining version hits, all intentional |
| WS-03 | Real-host probe on the extracted 0.2.2-rc.1 CLI with throwaway `DSH_HOME` | verify-222 | Done | WS-01 build artifact | 5/5 probes pass; tools registered |
| WS-04 | Docs sync: `AGENTS.md` version coupling, README pair requirement line | Lead | Done | WS-01 | `bun test tests/readme.test.ts` |
| WS-05 | Spec index, before/after gate, archive with Completed status | Lead | Done | WS-02, WS-03, WS-04 | `bun run check:specs`, `bun test tests/specs.test.ts`, `bun run verify:fast` (387 pass) |

## Verification

- `bun install` after the manifest change: clean; root `@deepseek-ai/cordis` 4.1.0,
  all `@deepseek-ai/dsh-*` 0.2.2-rc.1. Nested `dsh-better-sidebar/node_modules`
  still contains the 0.2.1 closure (expected, documented).
- `bun run typecheck`: passes only with the `paths` remap (fails with 30 × `TS2339`
  `betterSidebar` without it — reproduced).
- `bun run verify:fast`: **386 pass, 0 fail**, 22 files (385 baseline + the new
  peer-range test), including `tests/contract.test.ts`, `tests/build.test.ts` and
  `tests/specs.test.ts`.
- Peer-range invariant test: `Bun.semver.satisfies(installed, peerRange)` for every
  peer present in `node_modules`; non-vacuous on `@deepseek-ai/dsh-tools`.
- Real-host probes (WS-03, host 0.2.2-rc.1 `c59d10a`, server on port 59391,
  throwaway `DSH_HOME`, re-run against the rebuilt `lib/`):
  - composition: `plugin add "link:$PWD"` exit 0; `plugin add
    dsh-better-sidebar@0.28.2` exit 0 (+170 packages); `--dump-config` has the
    `dsh-bioviewer` row.
  - `GET /` 200; boot payload contains
    `{"id":"dsh-bioviewer","url":"plugins/??dsh-bioviewer/client.js&rev=235af82f097b"}`.
  - `GET /plugins/??dsh-bioviewer/client.js&rev=…` 200, `text/javascript`,
    3 371 014 B; body md5 equals on-disk `lib/client.js`.
  - `GET /bioviewer/open?sessionId=x` no cookie: 403 with our JSON body (route
    registered, not a bare 404); with cookie: held **25.005 s**, then
    `200 {"ok":true,"value":{"request":null}}`; no `sessionId`: 400
    `bad-request`.
  - host log: no plugin warnings/errors (the web profile has no logger, so
    activation was proved with a `--patch` probe row: `dsh-bioviewer` fiber state
    2, `fiberState` errors `[]`, global tools include `bio_open` and `bio_add`).
  - sidebar: `dsh-better-sidebar` client bundle (1 567 039 B, 200) requires
    `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`,
    `@deepseek-ai/dsh-client-ui-primitives` — all seed words in 0.2.2; 64/64
    primitives symbols it uses exist. Not verified: actual browser rendering
    (HTTP, module-table and loader-graph evidence only).
- API audit (WS-02), read out of the 0.2.2 tarballs/runtime with file:line:
  - `ToolsService.register` still inserts a non-agent-scoped tool into the global
    layer (`dsh-tools/lib/index.js:444-455`), the executor is mounted
    unconditionally, and the pipeline/agent-loop resolve+execute it — so a
    registered global tool is visible and dispatchable with no plugin wiring. The
    new mandatory `output` plus `assertSupportedJsonSchema` is satisfied
    (`src/host/tool.ts:109-131`, `:209` / `:261`) and covered by the new test.
  - `webServer.register({kind:'prefix', handler})` still hands the response to the
    handler (`dsh-host-webserver/lib/index.js:469-471`); `WebResource`/fallback/
    gzip are additive, and `connection.requestRejection` still exists. The 25 s
    hold and the 403 fence are unchanged.
  - `workingDirectory.get(session)` (`lib/index.js:80`) and
    `session.header.{id,cwd}` (absolute-path validation intact) are unchanged;
    cordis 4.1.0's `registry.ts`/`service.ts` are byte-identical to 4.0.5, so
    contract #11 (no `ctx.get` at `apply()` time) still holds.
  - `src/` breakage: **none found** (tool DSL, route, cwd, inject/effect audited).
  - Corroboration for the nesting trap: DSH's own plugin-compatibility gate checks
    peers with `includePrerelease: true` (`dsh-app-boot/lib/index.js:1094-1095`),
    so it accepts sidebar 0.28.2 on 0.2.2; the nested 0.2.1 closure is purely a
    package-manager artifact, confirming the `tsconfig` `paths` remedy.
  - Stale-version inventory: no `0.2.1-rc.4` pin, old peer range or
    `engines.node >=20` remains; only intentional explanatory mentions
    (`AGENTS.md`, `tests/contract.test.ts`) and the sidebar `^0.28.0` floor stay.
- `bun run check:specs` + `bun test tests/specs.test.ts`: run before and after the
  archive move (recorded on WS-05).

## Documentation sync

- Durable product/developer docs: `README.md` + `README_EN.md` state the
  `0.2.2-rc.1` / Node 24.9 requirement (same commit).
- Nearest local `AGENTS.md`: new “DSH version coupling” section (peer pre-release
  rule, nested-cordis trap and its removal condition, unchanged client shell), plus
  a host-version line in “Verifying on a real host”.
- Parent/package guidance: none in this repo.
- Root guidance and roadmap: `specs/README.md` index (this row).

### Experiment refs

None; verification ran from the working tree.

## Progress and handoff

### 2026-11-04 — verify-222 — WS-03

- Changed: nothing in the repo (read-only verification), throwaway `DSH_HOME` and
  host jobs torn down; user GUI on 54699 untouched.
- Evidence: all five probes PASS (see Verification); tool registry contains
  `bio_open`/`bio_add`; sidebar client loads against the 0.2.2 seed table;
  corrected the "seeds exactly four specifiers" claim in `AGENTS.md` to the 11-entry
  table (Lead adopted the fix).
- Remaining: no browser render check (documented limit).
- Blockers: none.
- Next action: none.

### 2026-11-04 — compat-audit — WS-02

- Changed: nothing (read-only audit; no repo writes).
- Evidence: five host surfaces unchanged at runtime with file:line citations; one
  new hard requirement (`output` schema) already satisfied; `src/` breakage none;
  stale-version inventory clean; `includePrerelease: true` corroboration for the
  packaging workaround.
- Remaining: none.
- Blockers: none.
- Next action: none.

### 2026-11-04 — Lead — WS-05

- Changed: `specs/README.md` index (004 Active → Archived) and this file's
  filename moved unchanged to `archive/`.
- Evidence: `bun run verify:fast` **387 pass, 0 fail**, 22 files; `bun run
  check:specs` passed and `bun test tests/specs.test.ts` (55 pass) both before and
  after the archive move.
- Remaining: browser UI rendering on 0.2.2 remains unverified (documented limit).
- Blockers: none.
- Next action: none.

### 2026-11-04 — Lead — WS-01

- Changed: `package.json` (devDeps `^0.2.2-rc.1`, `dsh-tools` peer `^0.2.2-rc.1`,
  `@deepseek-ai/cordis ^4.1.0` devDep, `engines.node >=24.9`), `bun.lock`,
  `tsconfig.json` `paths`, new peer-range test in `tests/contract.test.ts`.
- Evidence: reproduced the 30-error augmentation break; `paths` fixes it;
  `verify:fast` 386 pass / 0 fail.
- Remaining: final gate on the complete diff.
- Blockers: none.
- Next action: WS-05 closeout after WS-02/WS-03 report.

### 2026-11-04 — Lead — WS-04

- Changed: `AGENTS.md` version-coupling section + real-host host-version line;
  `README.md` / `README_EN.md` requirement sentence.
- Evidence: `tests/readme.test.ts` (section parity, extension/reader coverage).
- Remaining: re-run the README test in the final gate.
- Blockers: none.
- Next action: none.

## Completion summary

The plugin needed **no source change** for DSH 0.2.2-rc.1; the migration was
manifest, type-environment and anti-drift work:

- `@deepseek-ai/*` devDependencies, the `@deepseek-ai/dsh-tools` peer and the
  `@deepseek-ai/cordis` peer now match the host (`^0.2.2-rc.1` / `^4.1.0`);
  `engines.node` is `>=24.9`; `bun.lock` was regenerated and the install is clean.
- The one real resolution break — bun nesting a second `@deepseek-ai/cordis` under
  `dsh-better-sidebar` 0.28.2 because its peer ranges exclude the 0.2.2
  pre-releases, which erased the upstream `ctx.betterSidebar` module augmentation —
  is fixed at typecheck level by the `tsconfig.json` `paths` entry, documented with
  its removal condition in `AGENTS.md`.
- Two anti-drift tests were added: every declared peer range must admit the
  installed version (`tests/contract.test.ts`), and the registered tool output
  schemas must pass 0.2.2's installed `assertSupportedJsonSchema`
  (`tests/host-tool.test.ts`).
- Verification: `bun run verify:fast` **387 pass, 0 fail** across 22 files; the
  real-host probe on the 0.2.2-rc.1 CLI is 5/5 PASS with `bio_open`/`bio_add` in
  the global tool registry and no fiber errors; the API audit found no runtime
  change on any host or client surface this plugin uses.
- Scope deviation from the plan: the `cordis` peer was bumped to `^4.1.0` on the
  audit recommendation instead of staying `^4.0.5`, and the two tests above were
  added beyond the dependency edit. No release/tag/publish; no upstream
  `dsh-better-sidebar` change; no locale work.
- Unverified: in-browser rendering of the viewer on 0.2.2 (HTTP, module-table and
  loader-graph evidence only); the throwaway web profile carries no logger plugin,
  so log silence was complemented by an activation probe.
- Durable docs: `AGENTS.md` “DSH version coupling”, the README pair's host
  requirement, and the `specs/README.md` index (this row moves to Archived in this
  change).

Removing the `tsconfig.json` `paths` entry becomes possible once
`dsh-better-sidebar` republishes with 0.2.2 peer ranges; that removal belongs to
the future bump, not this spec.
