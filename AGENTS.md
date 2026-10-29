# AGENTS.md — dsh-bioviewer

Guidance for agents and humans working in this repository. Read this before
changing the client half: most of it records host behaviours that are not
discoverable from this repo's own code and that fail *silently* when broken.

## What this is

A **DeepSeek Harness plugin** that renders biomolecular files from the filesystem
in the DSH sidebar. It is a *consumer* of the third-party
[`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar) service:
it owns no sidebar, no file tree and no state store of its own — it registers
descriptors and renders components.

The viewer stack is Mol\* via `@molstudio/react`, the same stack as the
[BioViewer VS Code extension](https://github.com/shuuul/bioviewer), and
`@molstudio/core`'s controller API is the only surface this plugin uses to drive
Mol\*.

## Commands

| Command | What it does |
| --- | --- |
| `bun install` | Install dependencies |
| `bun run build` | Build `lib/index.js` (host half) and `lib/client.js` (client half) + `.d.ts` |
| `bun run typecheck` | `tsc -p tsconfig.json --noEmit` |
| `bun run lint` | `oxlint` |
| `bun test` | `bun:test` suite |
| `bun run verify:fast` | lint → typecheck → build → test. **The gate**: `.husky/pre-push` and CI both run exactly this |
| `bun run build --no-minify` | Unminified bundle, for reading the emitted code |

Hooks: `pre-commit` runs `oxlint` on staged files (seconds, no tests);
`pre-push` runs `verify:fast`; `commit-msg` enforces Conventional Commits.
Do not add a second hook runner.

## Architecture

```mermaid
flowchart TD
  user["User opens 1abc.pdb / map.mrc / 1abc.pdb.gz"]
  sidebar["dsh-better-sidebar editor tab"]
  matcher["matchFileViewer(path, head?)"]
  descriptor["our FileViewerDescriptor (fetchStrategy: custom)"]
  load["load(path, scope, signal)"]
  route["GET sidebar/file?sessionId&path"]
  gunzip["gunzip() via DecompressionStream"]
  payload["ViewerPayload (bytes | structure)"]
  viewer["BioViewer → &lt;Studio&gt;"]
  molstudio["MolStudio (loadStructure / loadVolume / loadPdb / loadAlphaFoldDb / loadEmdb)"]
  molstar["Mol*"]

  model["model calls bio_open"]
  tool["src/host/tool.ts"]
  registry["src/host/registry.ts (per-session queue)"]
  poll["src/client/agent-opens.ts long-polls GET bioviewer/open"]

  user --> sidebar --> matcher --> descriptor --> load --> route --> gunzip --> payload --> viewer --> molstudio --> molstar
  model --> tool --> registry --> poll --> viewer
```

Note the two independent entry points into the same viewer: a user clicking a
file goes through better-sidebar's matcher and our `load()`, while an agent open
goes through the tool and the poll loop. Both end at `BioViewer`.

| Path | Role |
| --- | --- |
| `src/index.ts` | **Host half.** Owns the `bio_open` tool and its long-poll route; also the loader row that makes the client half discoverable. |
| `src/host/tool.ts` | The `bio_open` tool: resolves the calling session and cwd, maps the target, queues it. |
| `src/host/target.ts` | Pure target → `OpenRequest` mapping (no cordis, no DSH imports, so it tests alone). |
| `src/host/registry.ts` | Per-session open queue + parked long-poll waiters (consume-once, bounded). |
| `src/host/route.ts` | The fenced `GET /bioviewer/open` long poll. |
| `src/client/index.tsx` | **Client half entry.** Registers the viewers, the compressed-file sniffer and both tabs. Owns stylesheet injection and the host-route resolver. |
| `src/client/agent-opens.ts` | The poll loop that receives agent opens and dispatches them. |
| `src/client/transport.ts` | Prefix-safe URL resolution for this plugin's own host routes. |
| `src/shared/formats.ts` | Pure format table + `detectBioFile` / `isBioFile`. Zero imports. |
| `src/shared/opens.ts` | The agent-open wire contract (`OpenRequest`, `parseOpenTarget`, …). Shared by both halves. |
| `src/client/bytes.ts` | Fetches raw bytes from the host media route and gunzips them. |
| `src/client/load.ts` | `loadIntoStudio`: routes a payload to `loadStructure`/`loadVolume`/`loadPdb`/…, and replaces a same-label object instead of stacking a duplicate. |
| `src/client/studio.tsx` | `BioViewer`: pure renderer of an already-fetched payload (bytes or a database entry). |
| `src/client/browser.tsx` | The "BioViewer" tab page (workspace bio-file navigator). |
| `src/client/cmm.ts` | Pure `.cmm` parser (React-free). The marker pane component is `MarkerNotice` in `file-view.tsx`. |
| `src/client/file-view.tsx` | The viewer's leaf components (`BioFileView`, `BioPayloadView`, `StructureTabView`, `MarkerNotice`, `BioNotice`) and the payload dispatcher. |
| `src/client/theme.ts` | DSH colour-scheme detection (mirrors the host's own logic). |
| `scripts/build.ts` | The build. Produces both halves and the `__ModuleLoader__` wrapper. |

## Host contracts you must not break

These were read out of the installed `dsh-better-sidebar@0.28.2` and
`@molstudio/core`, not assumed. Each one fails quietly if you get it wrong.

1. **`fetchStrategy: 'custom'` means *we* fetch.** The host calls
   `load(path, scope, signal)` and renders the component with the resolved value
   as `customData`; it never calls `fs.read` for us. That single fetch point is
   what gives us the host's `AbortSignal` and its automatic reload after a
   successful model `write`/`edit`. Fetching inside the component would
   double-fetch and lose both.

2. **Viewer `exts` are matched against the LAST dot segment.** `extOf()` in
   `dsh-better-sidebar/src/client/paths.ts` returns `path.slice(lastIndexOf('.') + 1)`,
   so `1abc.pdb.gz` has extension **`gz`**, not `pdb.gz`. Consequences:
   - never put a compound `"pdb.gz"` in a descriptor's `exts` — it can never match;
   - never put `"gz"` in a per-format `exts` — pass one would claim *every* `.gz`
     file in the workspace;
   - compressed files are routed by the **sniff-only catch-all** in
     `src/client/index.tsx` (`exts: []` + `detect`). The host yields on it while
     no head bytes exist, then consults it on the binary re-match, where `detect`
     sees the gzip magic.

3. **The client bundle is a classic script, not a module.** It must register a
   factory via `window.__ModuleLoader__.load({ id, factory })`, where `id` equals
   the package name. The factory receives a synchronous `require` that resolves
   only shell-owned specifiers; anything else throws loudly at materialization.
   Keep the external list exactly `react`, `react-dom`, `react-dom/client`,
   `react/jsx-runtime` — everything else (Mol\*, MolStudio) is bundled.

4. **The host's React is 18.3.1.** `@molstudio/react` declares a React 19 peer,
   but its code uses only React 18 APIs (`useId`, `useSyncExternalStore`, …).
   Do not introduce a React 19-only API.

5. **A native tab body is a fixed-height block scroller, not a flex container.**
   Every component root needs `height: 100%; min-height: 0`.

6. **`hostRouteUrl()` resolves host routes — never write a leading slash.**
   `fetch('/sidebar/api/…')` pins the request to the origin root and breaks
   reverse proxies that mount the GUI under a sub-path.

7. **Better-sidebar is an optional peer.** It must never appear in a static
   `inject` list, or the plugin would sit pending forever on a host without it.
   Registration goes through `ctx.inject(['betterSidebar'], …)`.

8. **One style element id per owner.** Both `index.tsx` and `browser.tsx` inject
   a stylesheet with the "create it if it is not already there" pattern; a shared
   id makes whichever runs second inject nothing, silently.
   `tests/style-ids.test.ts` pins uniqueness.

9. **Reload replaces, it does not append.** `MolStudio.loadStructure` has no
   dedupe, so a naive reload stacks a second object with the same label.
   `loadIntoStudio` removes same-label objects first via the public
   `getSnapshot()` / `remove(id)`. For database entries the key cannot be the
   payload title alone: the loaders name the object themselves (`loadPdb`
   uppercases the id, `loadEmdb` normalises to `EMD-1234`, `loadAlphaFoldDb` uses
   the API's `entryId`), so `load.ts` matches against every label MolStudio can
   actually produce for that payload.

10. **`ctx.sidebarRight` is client-only, so an agent open needs a host route.**
    `@deepseek-ai/dsh-client-ui-sidebar-right`'s host half is literally
    `export declare function apply(): void` — "the Sidebar contributes nothing to
    the host tree". There is therefore **no host-side API** that pushes an open
    into the browser, which is why `bio_open` exists: the tool queues a request
    (`src/host/registry.ts`), the client long-polls it back
    (`GET /bioviewer/open`), and the client calls `ctx.betterSidebar.openFile` /
    `openTab`. Do not "simplify" this into a host-side sidebar call; there isn't
    one. Two consequences worth remembering: the poll is **consume-once**, so a
    request reaches exactly one client (same guarantee better-sidebar's
    agent-open socket gives), and `apply()` must never throw on a partial service
    — `registerAll` capability-checks `getSnapshot`/`subscribeState` and degrades
    to "agent opens disabled" rather than taking the viewers down with it.

11. **Never read a host service with `ctx.get` at `apply()` time.** This plugin's
    activation is **not** ordered after the services it uses, and the race is
    silent: `apply()` ran before the webserver was provided, `ctx.get("webServer")`
    returned `undefined`, both host registrations took their documented
    "degrade to a no-op + log" path, and the plugin *looked* mounted while
    `/bioviewer/open` answered the server's generic 404 with no `content-type`.
    Nothing threw and no test failed — a fake ctx whose `get` always answers
    cannot see this. Use `ctx.inject([...], (scoped) => scoped.effect(...))`
    instead: registration happens the moment the services exist, the UI half is
    still not gated (a static `inject` would block the whole plugin), and a host
    that never provides them never registers. `tests/host-tool.test.ts` models the
    real ordering (`inject: "now" | "manual" | "never"`) and pins the dep list.
    Only a live `dsh --profile web` run caught this, so re-run the host check in
    "Verifying on a real host" below after touching `src/index.ts`.

## Verifying on a real host

Unit tests with a fake ctx cannot see ordering, activation or HTTP behaviour.
The cheap end-to-end check uses a **throwaway** `DSH_HOME` so the user's
`~/.dsh` is never touched:

```sh
export DSH_HOME=/tmp/dsh-verify && mkdir -p "$DSH_HOME"
dsh plugin --profile web add "link:$PWD"        # auto-appends from dsh.bundle.patch
dsh plugin --profile web add dsh-better-sidebar@0.28.2
dsh --profile web --dump-config | grep -A2 dsh-bioviewer   # row composed?
dsh --profile web --no-open --port 59391        # background job; read the token URL
```

Then, with the token exchanged for a cookie:

| Probe | Expected |
| --- | --- |
| `GET /` | 200; `window.__DSH_BOOT__` contains a `dsh-bioviewer` row |
| `GET /plugins/??dsh-bioviewer/client.js&rev=…` | 200, `text/javascript`, ~3.3 MB |
| `GET /bioviewer/open?sessionId=x` (no cookie) | **403 with our JSON body** — a bare 404 means the route never registered |
| `GET /bioviewer/open?sessionId=x` (cookie) | held **25 s**, then `200 {"ok":true,"value":{"request":null}}` |
| `GET /bioviewer/open` (no sessionId) | `400` `bad-request` |

Kill the job afterwards, delete the temp home, and confirm the user's own GUI is
untouched. Booting a *replacement* server for the user's GUI is never the goal —
this one exists only to exercise the host half and is torn down immediately.

## Conventions

- **Format identifiers are facts, not choices.** `molstarFormat` values must come
  from Mol\*'s built-in lists (trajectory: `mmcif`, `cifCore`, `pdb`, `pdbqt`,
  `pqr`, `gro`, `xyz`, `lammps_data`, `lammps_traj_data`, `mol`, `sdf`, `mol2`;
  volume: `ccp4`, `dsn6`, `cube`, `dx`, `dscif`). Verify against
  `node_modules/molstar` before adding one.
- **Styling is token-only.** Consume `--dsw-alias-*` / `--dsw-font-*` / `--ds-*`;
  no hardcoded colors. `tests/theme` does not exist here, so this is on review.
- **`import type {} from "dsh-better-sidebar/client/service"`** is the only
  permitted reference to that package in `src/`. It is erased at build time and
  is what pulls in the `ctx.betterSidebar` type augmentation. Never value-import
  it.
- **Comments explain *why*, and cite the source line** when a behaviour was read
  out of a dependency. Several comments here are load-bearing: they record
  measurements (`extOf` output, `builtinViewers` contents) that cost real time to
  establish.
- Conventional Commits are required (`feat`, `fix`, `docs`, `test`, `chore`, …).
- **`README.md` is Chinese; `README_EN.md` is its English mirror.** Chinese is the
  primary, so a change lands in `README.md` first and `README_EN.md` follows in the
  same commit. They must link to each other, and `tests/readme.test.ts` fails if
  either one stops documenting an extension or a Mol\* reader the format table
  claims, or if the two grow a different number of `##` sections. Add new sections
  to both.
- Add a test next to any behaviour you fix. The suite is fast (~2 s) and is the
  only regression net for the routing rules above.

## Testing notes

- `bun test` imports `.tsx` sources directly — prefer testing the real module
  with a hand-written fake over testing a copy of the logic.
- The verifier's tests in `tests/build.test.ts`, `tests/contract.test.ts` and
  `tests/registration.test.ts` check the **built** artifact and the **installed**
  `dsh-better-sidebar` types. They are the anti-drift net: if the dependency
  changes shape, they fail.
- `tests/build.test.ts` extracts `require()` specifiers from `lib/client.js` and
  cross-checks the static scan against a runtime scan. Its scanner is
  deliberately **fail-closed** (it may over-report, never under-report) — if it
  reports a specifier outside the allowlist, investigate; do not loosen it.
- `tests/molstar-formats.test.ts` asserts every `molstarFormat` in the table is a
  member of Mol\*'s real built-in reader registry. `tsc` cannot check those
  strings, and a wrong one only fails when a user opens a file.
- `tests/agent-opens.test.ts` drives the poll loop with a scripted `fetch`. Its
  `fetchScript` double **must forward `init`** to the scripted answer: a "parked"
  answer only ever settles through the abort signal it is handed, so dropping it
  hangs the loop forever and the test never finishes. Every loop test also carries
  a hard 5 s timeout for the same reason.
- `tests/host-registry.test.ts` covers the queue semantics, including the race
  where a waiter's timeout already fired but its `finally` has not run yet — the
  request must be **queued**, not handed to that dead waiter (`delivered: true`
  with a lost open is the failure mode this feature must never have).

## Releasing

There is **no release workflow**, by design: nothing is published yet, and this
repo has not opted into release-please. When a release is wanted, the manual
sequence is:

1. `bun run verify:fast` on a clean checkout, plus the full `bun test` suite.
2. Bump `version` in `package.json` and commit it (`chore(release): vX.Y.Z`).
3. Tag and push: `git tag vX.Y.Z && git push origin main --tags`.
4. `npm publish` (the `files` list already ships `lib`, `src`, `cordis.patch.yml`,
   `icon.svg`, `locale/*.json`, `README.md`, `README_EN.md` and `LICENSE`).
5. Consumers install with `dsh plugin --profile <name> add dsh-bioviewer@X.Y.Z`.

Two constraints to preserve if automation is ever added: release workflows must
be `workflow_dispatch`-only (never on push or tag push), and publishing should
use npm trusted publishing rather than a long-lived token. Note also the
marketplace manifest rules the plugin already satisfies — `dependencies` /
`peerDependencies` / `optionalDependencies` must never contain the unscoped
`cordis` package, and `scripts` must not contain install-time hooks.
`tests/manifest.test.ts` pins the first of those.
