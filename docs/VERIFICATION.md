# Independent verification — dsh-bioviewer

Adversarial verification of the C1–C6 claims in `task-4`. Every verdict below is
backed by a command that was actually run and the output it produced; nothing
here is a summary of intent.

This is **revision 7** of the report. The tree has moved three times since the
first PASS run: revision 2 (`markers.tsx` split, style-element id fixed, three
test files added) was re-established in full; revision 3 was a docs-only delta
(§3b); revision 4 adds the **agent-triggered open** surface, which changed the
client half and the host half, so C1/C2/C3 were re-run on a fresh build and three
of my assertions had to be updated to the new shape (§3c). §3 records revision 2,
§3b revision 3, §3c revision 4, §3d revision 5, §3e revision 6, §3f revision 7.

**Verified revision** — plugin files (`src/**`, `scripts/**`, `package.json`,
`tsconfig*.json`, `cordis.patch.yml`) hashed as a tree:

```
$ find src scripts package.json tsconfig.json tsconfig.build.json cordis.patch.yml -type f \
    | sort | xargs shasum -a 256 | shasum -a 256
fb36a1796a2104ff1c16a75e67321fc4a6c35c76cc9e448acf0021ae5991aa92  -
```

**Built artifacts**

| Artifact | Size | sha256 | vs. revision 6 |
| --- | --- | --- | --- |
| `lib/index.js` | 9 365 B | `fd619e982371c0d57af8641e0cc7268402b8502a2ae726415ff52e5c58c4ee59` | **unchanged** (host half untouched) |
| `lib/client.js` | 3 363 238 B | `ff5595c6653b8878dd0f2fa3cc55b139e9aca41257f308c6be19722d5b79389b` | was 3 362 947 B (`52613024…`) |

Both changed this time, and deliberately: the client half gained the agent-open
poller and the structure tab, and the host half gained `src/host/**` (the
`bio_open` tool and its route). The host half is no longer the 180-byte stub.

Reproduced here by a clean `rm -rf lib && bun run build`, twice — the two clean
builds are byte-identical, so the build is still deterministic and the hashes
above are the artifact identity for this revision.

The revision hash moved once more *within* revision 4 (`86791986…` →
`af6ff88d…`) when `package.json` gained the host half's dependencies
(`@deepseek-ai/dsh-tools` as a peer, plus the `dsh-host-webserver` /
`dsh-session` / `dsh-tools` / `dsh-working-directory` dev entries). Only
dependency declarations changed, so the artifacts are byte-identical either side
of that move — re-checked, not assumed.

**Environment** — bun 1.4.4 (macOS arm64), `dsh` 0.2.1-rc.2, `dsh-better-sidebar`
0.28.2 (installed), `@deepseek-ai/cordis` 4.0.5, `react`/`react-dom` 18.3.1,
TypeScript 5.9.3. Date 2026-10-29.

---

## 1. Verdict

| Claim | Verdict | Independent evidence |
| --- | --- | --- |
| **C1** `bun run build` produces `lib/index.js` + `lib/client.js` | **PASS** | clean build, exit 0, both files non-empty, host half importable |
| **C2** `lib/client.js` is a valid DSH boot handoff (`id` = package name, factory returns `apply`/`inject`) | **PASS** | sandbox evaluation + real materialization + **real host serves it** (§6) |
| **C3** factory requires only shell-resolvable specifiers | **PASS** | exact AST extraction + fail-closed text scan + runtime require stub, all three agree — on the built *and* the host-served bytes |
| **C4** registration wiring (one viewer per bio ext, exactly one tab, ids namespaced/unique/non-colliding, no host-owned exts) | **PASS** | real client source through a fake ctx; ids and exts checked against the shipped bundle |
| **C5** graceful degradation without `betterSidebar` | **PASS** | `apply(ctx)` throws nothing, registers nothing, and still works when the service arrives late |
| **C6** contract conformance against the installed types (anti-drift) | **PASS** | descriptor fields vs. installed `service.d.ts`; `extOf`/`HOST_OWNED_EXTS`/`builtinViewers` extracted verbatim |

Acceptance command (the one required by `task-4`):

```
$ bun test tests/registration.test.ts tests/contract.test.ts tests/build.test.ts
 72 pass
 0 fail
 330 expect() calls
Ran 72 tests across 3 files. [1580.00ms]
$ echo $?
0
```

Whole-repository gate (lint → typecheck → build → test):

```
$ bun run verify:fast
...
 299 pass
 0 fail
 3447 expect() calls
Ran 299 tests across 16 files. [1990.00ms]
$ echo $?
0
```

The gate grew by 109 tests and 260 assertions over revision 3: the agent-open
surface (client + host) plus 17 new assertions of mine in
`tests/registration.test.ts` covering the registration guard, the poll floor and
transport base resolution.

```
$ bunx oxlint
Found 0 warnings and 0 errors.
Finished in 8ms on 41 files with 116 rules using 12 threads.
```

---

## 2. Method per claim, and what each method does *not* prove

The client bundle is ~3.3 MB because Mol\* is bundled into it, and it is a
browser artifact. Every claim therefore names the technique used:

| Claim | Technique | Proves | Does **not** prove |
| --- | --- | --- | --- |
| C1 | real `bun run build`, byte sizes, dynamic `import()` of the host half | the two halves exist and the host half is loadable ESM | that the DSH loader mounts them (covered separately in §6) |
| C2 | static wrapper extraction **and** in-process evaluation with a stub `window.__ModuleLoader__`, then calling `factory(require)` with a DOM shim | the handoff registers once with the right id; the factory returns a real `apply`/`inject`; the built `apply` wires the registry | rendering; WebGL; a real browser |
| C3 | exact AST walk (TypeScript parser) + fail-closed text scan + runtime `require` stub that throws on anything outside the allowlist | no executed and no statically present specifier falls outside the allowlist | that the *shell* resolves those four names — materially strengthened in §6 |
| C4 | the real `src/client/index.tsx` imported by `bun test`, driven by a hand-written ctx modelled on cordis 4.0.5 | the exact descriptor objects handed to `registerTab`/`registerFileViewer` | a real cordis fiber; component rendering |
| C4 (gz) | the **shipped** `matchFileViewer` + `extOf`, extracted verbatim from `node_modules/dsh-better-sidebar/lib/client.js`, bound to a registry of built-ins extracted verbatim from `builtinViewers()` plus our descriptors | routing decisions made by the host's own algorithm | the host's `fs.read` → binary re-match plumbing (inferred, see §8) |
| C5 | fake ctx whose `inject` models "callback runs only once the service exists" | `apply` never touches `ctx.betterSidebar` itself | real cordis activation ordering |
| C6 | verbatim extraction of `extOf`, `HOST_OWNED_EXTS`, `builtinViewers()` from the installed bundle; field extraction from the installed `.d.ts` | the plugin's assumptions match the artifact on disk, not a prose paraphrase | future versions of the dependency |

Where a shipped artefact is the authority, the test extracts that code
**verbatim** and runs it — e.g. `extOf` is lifted out of the bundle and executed,
rather than re-implemented:

```js
function extOf(path) { const at = path.lastIndexOf("."); if (at === -1) return "";
  const base = path.slice(at + 1).toLowerCase();
  return base.includes("/") || base.includes("\\") ? "" : base; }
```

---

## 3. Delta since the first PASS run

Revision 1 was `a491e204…` with `lib/client.js` `f2ebe6c0…` (3 347 049 B). What
changed:

| Change | Could it break a claim? | Re-verified |
| --- | --- | --- |
| `src/client/markers.tsx` split into `src/client/cmm.ts` (React-free parser) + `MarkerNotice` moved into `src/client/file-view.tsx`; `tests/markers.test.ts` → `tests/cmm.test.ts` | **C4 yes** — the client import graph changed, so the registration set could have changed; **C1/C2/C3 yes** — the bundle is rebuilt | C4 unchanged (same 11 viewers + 1 tab, 16/16 exts); C1/C2/C3 re-run on the new artifact |
| `src/client/index.tsx` style id `dsh-bioviewer-styles` → `dsh-bioviewer-core-styles`, and `notices.css` now injected alongside `@molstudio/react/styles.css` | **C1/C2/C3 yes** (bundle content); **C4 yes** (entry module changed) | all re-run; nothing else moved |
| New `tests/style-ids.test.ts`, `tests/manifest.test.ts`, `tests/molstar-formats.test.ts` | no (test-only) | executed; falsified by mutation, §5 |
| `AGENTS.md`, `.editorconfig`, `.github/workflows/ci.yml`, `.oxlintrc.json` | no (not part of the plugin file set) | plugin-file hash unchanged before/after |

Confirmed independently rather than accepted: the plugin-file hash `53e17bb6…`
was identical before and after the test-only additions, `lib/index.js` is
byte-identical to revision 1, and the new `lib/client.js` reproduces exactly the
hash the lead reported.

---

## 3b. Revision 3 delta — README pair (assessed inert, and confirmed)

What changed: `README.md` became the Chinese primary with the English text moved
verbatim to the new `README_EN.md` (they cross-link); `package.json` `files`
gained `"README_EN.md"`; `tests/readme.test.ts` (6 tests) pins the pair;
`AGENTS.md` records the convention.

**Assessment: no claim is affected, and that is provable rather than argued.**
Nothing under `src/**`, `scripts/**`, `tsconfig*` or `cordis.patch.yml` moved, so
the build inputs are identical; the build is deterministic (independently
confirmed in §3); and a clean `rm -rf lib && bun run build` reproduces both
artifact hashes exactly:

```
$ rm -rf lib && bun run build && shasum -a 256 lib/index.js lib/client.js
c8bb96433be102a636d005cbcc7660d96bf19ee083803424b066d8b2f8a0e13d  lib/index.js
81a94165ebe0d5dd605b4eabbd717e9077cc8d3bff593a4ad7ec71bb6ed74689  lib/client.js
```

Byte-identical artifacts mean C1/C2/C3 (artifact identity, boot handoff, bundle
purity) and C4/C5/C6 (registration graph, graceful degradation, contract
conformance) cannot have changed. So this delta was **not** re-run through the
full matrix; only the following was executed:

* the acceptance command — still 44 pass / 0 fail (§1);
* `bun run verify:fast` — 149 pass / 0 fail (§1);
* one addition to `tests/build.test.ts`, because the delta did touch
  `package.json`: the `files` array is the npm publish allowlist, and a non-glob
  entry naming a file that does not exist ships a broken package while npm only
  warns. The test now asserts every non-glob `files` entry exists:

  ```
  [C1] package.json files entries checked: lib, src, cordis.patch.yml, icon.svg,
       README.md, README_EN.md, LICENSE
  ```

  (`locale/*.json` is a glob and is exercised by `tests/manifest.test.ts`
  instead.) This is the only change to a file in this task's write scope for the
  revision-3 delta.

One correction worth recording: the verified-revision hash *does* move in this
delta — `53e17bb6…` → `143c722f…` — because `package.json` is part of the hashed
plugin file set. `git diff HEAD~1 -- package.json` shows the `files` entry is the
only change, which is why the artifacts stay identical.

---

## 3c. Revision 4 delta — agent-triggered opens (NOT inert)

What changed, from `git status`:

| Area | Change |
| --- | --- |
| `src/client/agent-opens.ts`, `src/client/transport.ts` (new) | the long-poll loop and this plugin's own route resolver |
| `src/shared/opens.ts` (new) | `parseOpenTarget` / `unsupportedPathReason` / `structureTitle` / `isOpenRequest` |
| `src/client/index.tsx` | a **second tab type** (`dsh-bioviewer:structure`, hidden, with `createTab`) and the guarded poller effect |
| `src/client/{file-view,load,payload,studio}.tsx`, `src/shared/index.ts`, `README.md` | supporting changes |
| `src/index.ts`, `src/host/**` (new) | the host half — `bio_open` tool + its route |
| `tests/{agent-opens,transport,host-registry,host-tool}.test.ts` (new) | the authors' own tests |

Unlike revision 3, this one is **not** inert, so the artifact legs were re-run on
a fresh build rather than argued:

* **C1** — clean build, exit 0; `lib/index.js` 9 293 B, `lib/client.js`
  3 353 472 B; host half still imports and exports `apply`; every `package.json`
  target and every non-glob `files` entry exists. **The host half is no longer a
  stub** — the "intentionally minimal" reading in revision ≤3 is obsolete. It now
  value-imports exactly one external (`@deepseek-ai/dsh-tools`, plus `node:path`),
  and that coupling is pinned by the new C6 invariant below.
* **C2** — the emitted wrapper still registers exactly one handoff with
  `id = "dsh-bioviewer"`; `factory(require)` still returns `{ apply, inject }`;
  the **built** `apply` now wires **2 tabs + 11 viewers**.
* **C3** — unchanged and re-verified on the new bundle: exactly
  `react`, `react-dom`, `react/jsx-runtime`, no computed `require`, no chunk or
  asset requires, 0 parse diagnostics. The new files did **not** disturb the
  bundle's specifier set.
* **C4/C5/C6** — re-run; C4 and C5 needed their expected shape updated (§3c.1).

### 3c.1 Three stale assertions, updated deliberately

These failed on the new tree, and they were **stale, not defects**: the surface
genuinely grew. I changed the expected shape rather than the strictness, and
record why:

| Test | Was | Now | Why |
| --- | --- | --- | --- |
| C4 "registers exactly one tab" | `tabs.length === 1` | exactly `{browser, structure}`, and each one's shape | a count alone would pass on two `browser` tabs; the two types are deliberately different |
| C5 "service arriving late" | `tabs.length === 1` | the two ids, 11 viewers | same surface, reached through the late-service path |
| C2 "built apply wires the registry" | `tabs.length === 1` | the two ids plus `structure.hidden`/`structure.createTab`, 11 viewers | proves the *built* artifact carries the new tab, not just the source |

The shape assertions the lead asked for, all present:

* exactly two ids: `dsh-bioviewer:browser` and `dsh-bioviewer:structure`;
* `browser` — `hidden` **absent** (not merely falsy), `single === true`,
  `order === 45`, has a `component`;
* `structure` — `hidden === true`, `createTab` is a function, and two calls to it
  mint **distinct** ids (otherwise a second structure would replace the first,
  which is exactly what `createTab` exists to prevent);
* 11 viewers, all 16 non-gz extensions claimed, ids namespaced and unique.

---

## 3d. Revision 5 delta — the host-half ordering defect (a REAL defect, found live)

This is the delta that matters most, because it is the one a fake-ctx unit test
could not see.

**D6 — `apply()` raced the host's service providers.** The host half read
`ctx.get("webServer")` / `ctx.get("tools")` synchronously while declaring
`export const inject = []`. Activation is not ordered after the webserver, so on
a real host both lookups returned `undefined`, both registrations took their
documented "degrade to a no-op + log" path, and the plugin *looked* mounted while
`/bioviewer/open` answered the **server's generic 404** — bare, no
`content-type`, nothing thrown, no test failed.

Fixed by `ctx.inject(["webServer", "tools"], (scoped) => scoped.effect(...))`.
Both halves changed in this revision, so every artifact leg was re-run:

* **C1** — clean build, exit 0; `lib/index.js` 9 365 B, `lib/client.js`
  3 353 497 B; both hashes reproduce the lead's exactly; every `package.json`
  target and non-glob `files` entry exists.
* **C2** — one handoff, `id = "dsh-bioviewer"`, `factory(require)` →
  `{ apply, inject }`; the **built** `apply` wires 2 tabs + 11 viewers, 16/16
  non-gz extensions.
* **C3** — unchanged: exactly `react`, `react-dom`, `react/jsx-runtime`, 0 parse
  diagnostics, no computed `require`, no chunk/asset requires.
* **C6** — the host bundle still value-imports exactly
  `@deepseek-ai/dsh-tools` + `node:path`, and that peer is declared and
  non-optional.

### 3d.1 The fix, verified on a real host

A fake ctx cannot see activation ordering or HTTP behaviour, so the fix was
checked against a live `dsh --profile web` on a throwaway `DSH_HOME`
(`/tmp/dsh-verify-final`, deleted; port 59395; the user's GUI on 59290 was never
touched and was still answering afterwards):

| Probe | Expected after the fix | Observed |
| --- | --- | --- |
| `GET /bioviewer/open?sessionId=x` **without a cookie** | 403 with OUR JSON body | `403`, `content-type: application/json; charset=utf-8`, `cache-control: no-store`, `{"ok":false,"error":{"code":"forbidden","message":"forbidden"}}` |
| same, with the session cookie | held ~25 s, then a null envelope | **held 25 s**, then `200 {"ok":true,"value":{"request":null}}` |
| `GET /bioviewer/open` (no `sessionId`) | 400 | `400`, `{"ok":false,"error":{"code":"bad-request","message":"sessionId is required"}}` |
| boot graph | our row present | `{"id":"dsh-bioviewer","url":"plugins/??dsh-bioviewer/client.js&rev=9c416ae11f43","rev":"9c416ae11f43"}` in a 71-entry graph |

The first row is the discriminator: **before** the fix that same request was a
bare `404` with no `content-type` — the server's generic not-found, i.e. the
route had never registered. A 403 carrying our own JSON envelope proves the
route is mounted and reached. Teardown was verified rather than assumed: the
throwaway server stopped (connection refused, no listener), the user's GUI was
still answering, and `~/.dsh` was untouched (mtime unchanged at 12:08).

### 3d.2 The ordering regression test bites (independently confirmed)

`tests/host-tool.test.ts` models the real ordering with
`inject: "now" | "manual" | "never"`. Reverting `apply()` to the pre-fix
synchronous form in a throwaway copy (`/tmp/mut4`, deleted; `src/**` is outside
my write scope) — mutation landing asserted before running — gives:

| `apply()` version | `tests/host-tool.test.ts` |
| --- | --- |
| shipped (`ctx.inject`) | **46 pass / 0 fail** |
| reverted (synchronous `ctx.get`) | **41 pass / 5 fail** |

The five failures are exactly the `apply` describe's ordering tests: *waits for
the host services instead of racing their provider*, *registers immediately when
the services are already up*, *mounts without registering when the host never
provides the services*, *registers the tool and the route inside one effect and
disposes both*, and *releases every parked poll on unload*. (The sixth,
"degrades per registration if a service is unreadable when it runs", still
passes — it tests the degradation path, not the ordering.) This matches
host-dev's report of 5 failures exactly.

### 3d.3 F1 resolved

The poller disposer no longer throws when `subscribeState` returns a
non-function: `unsubscribe` is now held as `unknown` and called behind a
`typeof unsubscribe === "function"` guard (`src/client/agent-opens.ts:245`).

```
[adv] dispose results: ["ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok"]
```

My test no longer merely *records* this — it now **asserts** that every disposer
returns cleanly, so a regression re-opens the finding as a failure. The loop
still tears down normally (all 13 registrations removed on dispose).

---

## 3e. Revision 6 delta — markers render, and a limitation is REVERSED

`@molstudio/core` and `@molstudio/react` went 0.1.3 → **0.1.4**, which adds the
marker API (`loadMarkers`, `setMarkerColor`, `setMarkerSize`,
`MARKER_SIZE_RANGE`). `src/client/cmm.ts` became a DOM-free port of bioviewer's
`cmmMarkers.ts`, `load.ts`/`studio.tsx` gained a `kind: "markers"` route, and the
marker special-casing was removed from `index.tsx`/`file-view.tsx`.

**Correction to earlier revisions of this report.** Revisions 2–5 recorded, as a
deliberate design decision, that `.cmm` "renders an explicit marker pane" because
"Mol\* 5.13 exposes no public shape builder". The premise was true of Mol\* and
the conclusion was wrong: MolStudio builds the shape node itself. Marker models
now render in 3D, the dependency floor is `^0.1.4`, and the claim is retracted in
both READMEs, in AGENTS.md (host contract #12) and in §7's D2 entry here.

A tree-wide scan for the stale wording found exactly one remaining hit —
AGENTS.md:175, which is the **retraction itself** ("that is what an earlier
version of this file wrongly concluded"), i.e. correct:

```
$ grep -rniE "not drawn|不绘制|no public shape builder|cannot be rendered|not rendered" \
    --include="*.md" --include="*.ts" --include="*.tsx" --include="*.json" . | grep -v node_modules
./AGENTS.md:175:    0.1.4.** Mol\* 5.13 genuinely has no public shape builder (`plugin.builders`
```

Artifact legs re-run because the client half changed: C1 both halves build and
every `package.json` target/`files` entry exists; C2 one handoff, id
`dsh-bioviewer`, factory → `{ apply, inject }`, built `apply` wires 2 tabs + 11
viewers, 16/16 non-gz extensions; C3 still exactly `react`, `react-dom`,
`react/jsx-runtime` with 0 parse diagnostics; C6 host imports unchanged.

### 3e.1 The port's fidelity — differential-tested against the reference

cmm-dev's evidence (MolStudio's real `validateMarkerSet`) proves our output is
*acceptable*; it does not prove our numbers match bioviewer's. So the two parsers
were run side by side on the same inputs. The reference needs `DOMParser`, which
Bun does not provide, so a ~40-line XML shim supplied exactly the surface it uses
(`getElementsByTagName`, `children`, `tagName`, `getAttribute`) **plus the
single-root `parsererror` rule** — the first run of this harness produced two
apparent divergences that were shim artifacts (my multi-root cases were not
well-formed XML), which is why the shim now models that rule.

| Input | Result |
| --- | --- |
| `multi_marker_sets.cmm` (real fixture, 2 sets) | **identical** — labels `pocket A · …`, `pocket B · …`, 3+2 markers, 2+1 links |
| `blob_1_NDP_1_prompt.cmm` (real fixture) | **identical** |
| defaults (no `radius`, no `r`/`g`/`b`) | **identical** — radius `1 → 0.5`, colour `#ff0000` |
| radius 3 | **identical** — `1.5` (the ×0.5 scale) |
| colours + links | **identical** — link default `0.2` / `#ffffff`; `r=0.5,g=0.25,b=0` → `#804000` (i.e. `Math.round(x*255)`) |
| 3 sets sharing the label `markers` (real `<marker_sets>` root) | **identical** — 3 sets, identical labels |
| unnamed multi-set | **identical** — `marker set 1 · …`, `named · …` |
| no `<marker_set>`, empty set | **identical** (both reject) |

The four numbers the lead named are therefore confirmed against the reference
*and* matched by ours: marker radius ×0.5, marker default radius 1 with red
`#ff0000`, link default radius 0.2 with white `#ffffff`, and
`Math.round(clamped * 255)` hex.

The only two remaining differences are on **malformed** XML, where ours is
stricter and the reference's behaviour depends on `DOMParser` reporting a
`parsererror` — which my shim can only partially emulate:

* two root elements: both reject; only the message differs (`Invalid CMM XML.` vs
  ours, which names the reason);
* a truncated document: ours rejects (`unclosed <marker_set> element`), the
  shimmed reference accepts because the shim cannot detect unclosed tags. A real
  `DOMParser` would report a `parsererror` and the reference would reject too.

So: **no divergence on any well-formed input**, and the two malformed-input
differences are both cases where our parser is the stricter of the two. This
does not prove the shim is a faithful `DOMParser` in general — only that it is
faithful for the surface the reference uses.

### 3e.2 The shared-label fix — attacked three ways

`loadMarkerSets` removes by label **once, before the first set**, because a
per-set removal deletes the set drawn a moment earlier and Chimera's default
marker-set name is `"markers"`. Driven against a studio double whose snapshot and
`remove` actually track what is on screen:

| Attack | Observed |
| --- | --- |
| three sets all labelled `markers` | `loadMarkers calls=3, objects on screen=3` — all three drawn (a per-set removal would leave **one**) |
| the same file loaded twice | `after two loads: 3 objects` — replacement, not accumulation |
| a set labelled `markers` when a **structure** labelled `markers` is already in the studio | the structure is **removed** — see **F3** |

### 3e.3 The `sets: []` rejection

| Level | Observed |
| --- | --- |
| parser (`<?xml?><marker_sets></marker_sets>`) | throws `CMM file does not contain a marker_set element.` |
| loader (`kind: "markers"` with `sets: []`) | throws `dsh-bioviewer: "model.cmm" contains no marker sets, so there is nothing to draw.` |
| side effects on the way to that error | `loads: []`, `removals: []` — nothing drawn, nothing deleted |
| a studio with no `loadMarkers` | throws `… loadMarkers() is missing, so the markers were not loaded.`, and nothing is added |

So the failure is a rejection with a user-facing message rather than a silent
blank canvas. What I cannot verify without a browser is the *rendering* of that
message (the error panel); the component's error path is asserted only as far as
"the loader rejects", which is what the panel is driven by — consistent with §8.

### 3e.4 The capability floor is real, not vacuous

The new check asserts on the **real imported class**
(`core.MolStudio.prototype.loadMarkers`), not a mock, and deliberately avoids
pinning a version string. Its non-vacuity was checked against the version it
exists to exclude:

```
$ npm pack @molstudio/core@0.1.3 && tar xzf *.tgz
$ grep -rl "loadMarkers" package/dist/          → (nothing)
$ grep -nE "loadMarkers|setMarkerColor|setMarkerSize|MARKER_SIZE_RANGE" package/dist/*.d.ts → (nothing)
$ grep '"version"' node_modules/@molstudio/core/package.json → "0.1.4"
```

0.1.3 contains none of the four marker members anywhere in its `dist`, so the
three `typeof … === "function"` assertions and the `MARKER_SIZE_RANGE` assertion
would all fail against it — the floor fails loudly on a downgrade instead of
turning every `.cmm` into a runtime error.

---

## 3f. Revision 7 delta — F3 fixed with a (label, kind) key, and a fix that would have re-broken dedupe

The removal key became a pair: `removeObjectsMatching(studio, keys)` matches
`label === object.label && (object.kind === undefined || object.kind === key.kind)`.
Artifact legs re-run (the client half changed): C1/C2/C3/C6 all unchanged in
outcome — 2 tabs + 11 viewers, 16/16 non-gz extensions, still exactly
`react`, `react-dom`, `react/jsx-runtime`, 0 parse diagnostics.

### 3f.1 The EMDB kind — the assertion genuinely pins it

`loadEmdb` applies `DownloadDensity` and reads the result out of
`plugin.managers.volume.hierarchy`, so `describeVolume` reports `kind: "volume"`
(`node_modules/@molstudio/core/dist/types.d.ts:110`). Keying EMDB as
`"structure"` matches nothing on reload — a fix that would have silently restored
the duplicate-stacking bug contract #9 exists to prevent.

viewer-dev's test seeds a studio with a volume **and** a structure both labelled
`EMD-1234` and asserts only the volume is replaced. Mutating the kind back to
`"structure"` in a throwaway copy (`/tmp/mut5`, deleted; `src/**` is outside my
write scope; mutation landing asserted first):

| Kind derivation | `tests/load.test.ts` |
| --- | --- |
| shipped (`emdb → "volume"`) | **44 pass / 0 fail** |
| mutated (`emdb → "structure"`) | **43 pass / 1 fail** — only *"an EMDB volume is replaced by label and kind, not by label alone"* |

So the test is not passing either way; it fails precisely when the kind is wrong.

### 3f.2 Every `BIO_FORMATS` entry keys the kind MolStudio really produces

MolStudio's object kinds are exactly `structure | volume | markers`
(`types.d.ts:81,110,149`). The bytes route keys
`format.kind === "volume" ? "volume" : "structure"`, and molecules go through
`loadStructure`. Rather than eyeball it, each non-marker format is loaded with
**both** kinds seeded under the same label, so only an exactly-matching key
replaces:

```
[kind] bytes-route keys checked: pdb:structure, mmcif:structure, ccp4:volume,
       sdf:structure, mol:structure, mol2:structure, pdbqt:structure,
       gro:structure, xyz:structure
```

For every one of the nine, `remove:right` fires and `remove:wrong` does not — a
molecule (SDF/MOL/MOL2) is keyed `structure`, `.mrc`/`.map`/`.ccp4` is keyed
`volume`.

### 3f.3 F3 inverted, both directions

```
[kind] after marker load: events=["load:markers"], survivors=["structure:ref-structure"]
[kind] after structure load: events=["load:structure"]
```

A structure labelled `markers` now **survives** a marker load with that label
(no `remove:` event at all), and a marker set labelled `1abc` survives a
structure load. The converse holds.

### 3f.4 No regression in the shared-label fix

```
[kind] shared-label: 3 marker loads, removed=["remove:old"]
```

Three sets all labelled `markers` still produce three loads, with exactly one
removal (the previously drawn object) — the new key does not reintroduce the
per-set removal that broke this before.

### 3f.5 The `undefined` fallback is genuinely exercised

```
[kind] fallback: events=["remove:legacy", "load:structure"], remaining=0
```

A studio whose snapshot reports no `kind` still replaces by label. The assertion
is on the `remove:legacy` **event**, which is only reachable through the
`object.kind === undefined` branch — so the fallback is exercised, not
incidentally true. (The opposite direction is covered by §3f.2: a *different*
kind is never removed.)

### 3f.6 A lint warning I introduced

My new test tripped `eslint(no-unused-vars)` on an unused `objects`
destructuring, which made `bunx oxlint` report 1 warning where the lead's run
reported 0. Fixed; `bunx oxlint` is back to **0 warnings / 0 errors / 41 files**.
Worth recording because `verify:fast` exits 0 on warnings, so this would not have
failed the gate.

---

## 4. Per-claim evidence

### C1 — build output · PASS

```
$ rm -rf lib && bun run build
$ bun run scripts/build.ts
host   lib/index.js   0.2 KiB
client lib/client.js  3268.5 KiB

real	0m1.670s
```

`lib/client.js` is > 1 MB, which the test asserts: Mol\* is bundled, and a tiny
file would mean the payload was dropped. The host half is imported for real:

```
[C1] host half exports: apply, inject, name; inject=[]
```

Strengthening beyond the claim: every path `package.json` points the shell at
must exist after the build — `exports["."]`, `exports["./client"]`,
`exports["./cordis.patch.yml"]`, `exports["./package.json"]`, `main`, `icon`,
`dsh.bundle.patch` — and `lib/types/client/index.d.ts` must be non-empty (a
silently empty declaration emit would still satisfy `existsSync`).

```
[C1] package.json targets checked: ./lib/types/index.d.ts, ./lib/index.js,
     ./lib/types/client/index.d.ts, ./lib/client.js, ./cordis.patch.yml,
     ./package.json, lib/index.js, icon.svg, ./cordis.patch.yml
```

The test rebuilds `lib/` itself when it is older than `src/`, so a stale artifact
can never be the thing that passes.

### C2 — boot handoff · PASS

The emitted wrapper is read textually and then executed against a stub sink:

```
[C2] sandbox registration: id=dsh-bioviewer
[C2] factory required: react, react-dom, react/jsx-runtime
[C2] factory surface: apply=function, inject=[]
```

`id` equals `package.json#name`, exactly one handoff is registered, and
`factory(require)` returns a surface exporting `apply` (function) and `inject`
(array). Script evaluation happens with a bare `window` object and **no DOM at
all**, so the lazy-registration contract holds: executing the bundle only
registers a factory.

Stronger than the claim: the *built* `apply` is executed through a fake ctx and
must wire the registry itself (a bundle whose factory body had been mangled could
still export a function):

```
[C2] built apply(): 1 tab, 11 viewers -> dsh-bioviewer:browser, dsh-bioviewer:pdb,
     dsh-bioviewer:mmcif, dsh-bioviewer:ccp4, dsh-bioviewer:sdf, dsh-bioviewer:mol,
     dsh-bioviewer:mol2, dsh-bioviewer:pdbqt, dsh-bioviewer:gro, dsh-bioviewer:xyz,
     dsh-bioviewer:cmm, dsh-bioviewer:gzip
[C2] built apply() covers 16/16 non-gz extensions
```

Materialization of ~3.3 MB of bundled Mol\* takes ~130 ms under the shim.

### C3 — bundle purity · PASS

Three independent legs, all agreeing:

```
[C3] AST parse diagnostics: 0
[C3] require literals (AST): react, react-dom, react/jsx-runtime
[C3] runtime-required specifiers: react, react-dom, react/jsx-runtime
```

* **Exact leg** — the bundle is parsed with the TypeScript compiler and the AST is
  walked for `require(<string literal>)`. `parseDiagnostics === 0` also proves the
  emitted artifact is syntactically valid JavaScript. No computed `require`
  (`nonLiteral === []`).
* **Fail-closed leg** — a text scan that reports *every* literal occurrence,
  including decoys inside strings/comments. It may over-report, never
  under-report; it is asserted to be a superset of the AST leg.
* **Runtime leg** — the factory is materialized with a `require` that throws on
  any specifier outside the allowlist. Cross-checked in both directions:
  `static ⊄ runtime` and `runtime ⊄ static` are both empty.

The expected set is named explicitly (`["react", "react-dom", "react/jsx-runtime"]`)
so a regression that drops one is visible rather than silently "equal". The same
checks were re-run against the bytes the **real host serves** — see §6.

Chunk/asset requires — none exist, so there is nothing to report:

```
[C3] relative/chunk requires: (none)
[C3] dynamic import() occurrences: 0
```

CSS is inlined as a string and injected from inside the factory; no `.css`
specifier and no `/plugins/**/*.css` route is referenced anywhere in the bundle.

### C4 — registration wiring · PASS

Run against the real source (`src/client/index.tsx`, which now imports the split
`cmm.ts`/`file-view.tsx`), fake ctx modelled on the installed cordis API
(`ctx.inject(deps, cb)` — registry.d.ts:111; `ctx.effect(body, label?)` —
fiber.d.ts:157). Unknown ctx properties **throw** rather than silently returning
`undefined`, so the test surfaces everything the plugin touches.

```
[C4] exported inject: []
[C4] ctx.inject calls: [["betterSidebar"]]
[C4] tabs: dsh-bioviewer:browser
[C4] claimed exts: ccp4 cif cmm ent gro map mcif mmcif mol mol2 mrc pdb pdbqt sd sdf xyz
[C4] required non-gz exts: ccp4 cif cmm ent gro map mcif mmcif mol mol2 mrc pdb pdbqt sd sdf xyz
[C4] descriptor ids: dsh-bioviewer:browser, dsh-bioviewer:pdb, dsh-bioviewer:mmcif,
     dsh-bioviewer:ccp4, dsh-bioviewer:sdf, dsh-bioviewer:mol, dsh-bioviewer:mol2,
     dsh-bioviewer:pdbqt, dsh-bioviewer:gro, dsh-bioviewer:xyz, dsh-bioviewer:cmm,
     dsh-bioviewer:gzip
[C4] host-owned exts (verbatim from installed bundle): xlsx xls csv tsv fods pdf png
     jpg jpeg gif webp svg bmp ico doc docx ppt pptx
```

* (a) all 16 non-gz extensions in `BIO_EXTENSIONS` are claimed — 15 formats plus
  the `.cmm` marker pane;
* (b) exactly one tab;
* ids are `dsh-bioviewer:*`, unique, non-empty, and disjoint from the built-in
  tab ids (`editor git subagent sidechat diff terminal-bottom`) and viewer ids;
* viewer `exts` never intersect the host-owned hand-over set;
* no viewer is a blind catch-all (`exts: []` without `detect`) — that would claim
  every file in the workspace;
* every descriptor field is declared by the installed `TabDescriptor` /
  `FileViewerDescriptor`, and every `fetchStrategy` is a legal
  `FileFetchStrategy`;
* every registration happens **inside** `ctx.effect`, and disposing the effects
  removes all 12 registrations (HMR safety, guide §9).

The built-in viewer id list is not hardcoded on faith — it is extracted from the
shipped `builtinViewers()` and compared, so a dependency bump fails the test:

```
[C4] shipped built-in viewers: code, html, jsonl, markdown
     (guide §5.4 documents three: markdown, html, code)
```

#### C4 (gz) — the case that originally failed, driven through the shipped matcher

`extOf` takes the **last** dot segment, so `1abc.pdb.gz` has extension `gz` and a
`"pdb.gz"` entry in `exts` can never match. The fix is a sniff-only catch-all
(`exts: []` + `detect`, priority 10). The assertions below drive the host's real
`matchFileViewer` — extracted verbatim from the installed bundle — bound to a
registry of built-ins (also extracted verbatim from `builtinViewers()`) plus the
descriptors the plugin actually registers. Only the registry contents and the
enabled predicate are ours; the algorithm is the shipped one.

```
[gz] built-in registry extracted verbatim: markdown(0), html(0), jsonl(0), code(-100)
[gz] (a) 1abc.pdb -> dsh-bioviewer:pdb
[gz] (b) 1abc.pdb.gz (no head) -> code
[gz] (c) 1abc.pdb.gz (gzip head) -> dsh-bioviewer:gzip
[gz] (d) notes.csv.gz (gzip head) -> code
[gz] (e) 1abc.cif -> dsh-bioviewer:mmcif
```

plus: no descriptor `exts` entry contains a dot.

### C5 — graceful degradation · PASS

```
[C5] after late service: 11 viewers, 1 tab
[C5] disposed 13 effects; remaining registrations: 0
```

* with no `betterSidebar`, `apply(ctx)` neither throws nor registers anything,
  and never calls a sidebar method;
* when the service arrives late, the same callback registers the full set —
  order independence, which is what `ctx.inject` is for;
* disposing every effect unregisters everything, so re-activation cannot hit
  `"already registered"`.

`betterSidebar` is *not* in the static `inject` list (it is `[]`); a hard
dependency would keep the plugin pending forever on a host without the service
(guide §2.2). The real host's boot graph confirms this — our row carries no
`inject` edges (§6).

### C6 — contract conformance / anti-drift · PASS

```
[C6] installed dsh-better-sidebar 0.28.2, declared peer range ^0.28.0
[C6] TabDescriptor: id, title, description, icon, order, hidden, bottomOnly,
     available, single, dedupeKey, createTab, urlTarget, settings, badge,
     rightActions, onOpen, onActivate, onClose, component
[C6] FileViewerDescriptor: id, title, icon, exts, priority, fetchStrategy,
     detect, load, settings, component
[C6] type-only dsh-better-sidebar imports in: src/client/index.tsx
```

* the installed version satisfies the declared peer range, and the package is a
  **peer** dependency (optional), never a runtime dependency;
* `registerTab`, `registerFileViewer`, `hostRouteUrl`, `openFile` all exist with
  the expected signatures in the installed `service.d.ts`;
* every field the plugin passes is declared by the installed interfaces;
* `dsh-better-sidebar` is referenced from `src/` **only** as
  `import type {} from "dsh-better-sidebar/client/service"` — exactly one
  type-only import, zero value imports (the type-only import is also asserted to
  be *present*, so the value-import check cannot pass vacuously);
* the shipped `HOST_OWNED_EXTS` set equals the documented hand-over list;
* the shell-specifier allowlist is pinned in one place and cross-checked against
  `scripts/build.ts`.

---

## 5. Falsifying the three new tests

New tests are only worth their runtime if they can fail. Each was attacked
directly.

### `tests/style-ids.test.ts` — PASS, and it covers every injection site

The bug it guards against is real and was fixed in this revision: `index.tsx` and
`browser.tsx` both declared `STYLE_ELEMENT_ID = "dsh-bioviewer-styles"` with the
same "create only if absent" guard, so whichever ran second injected nothing —
one of the two stylesheets silently never reached the document.

Independent check that the guard is complete rather than name-dependent: the only
style-injection sites in `src/` are the two that use that constant, and both are
matched by the scan (which asserts it found at least two declarations, so it
cannot pass by matching nothing):

```
$ grep -rn "STYLE_ELEMENT_ID" src/
src/client/index.tsx:65:const STYLE_ELEMENT_ID = "dsh-bioviewer-core-styles";
src/client/index.tsx:78:  if (document.getElementById(STYLE_ELEMENT_ID) !== null) return () => {};
src/client/index.tsx:80:  element.id = STYLE_ELEMENT_ID;
src/client/browser.tsx:74:const STYLE_ELEMENT_ID = "dsh-bioviewer-styles";
src/client/browser.tsx:84:  if (document.getElementById(STYLE_ELEMENT_ID) !== null) return;
src/client/browser.tsx:86:  style.id = STYLE_ELEMENT_ID;
```

The two ids are now distinct and both namespaced, and there is no third
`getElementById`/`createElement("style")` site that would escape the scan. This
guard would have caught the original collision.

### `tests/manifest.test.ts` — PASS

Reviewed and executed; it asserts the loader-facing surface (`main`,
`dsh.client.platform`, `dsh.bundle.patch`, `exports["./client"]`,
`./package.json`, `./locale/*.json` with a non-empty `locale/en.json`, the patch
row being enabled and correctly named, better-sidebar being an optional peer, and
no unscoped `cordis` in any dependency group). These were separately confirmed
end-to-end by the real host in §6, which is the stronger evidence.

### `tests/readme.test.ts` — PASS, and falsified by mutation

The README pair only earns its keep if the guards can fail, so six mutations were
applied **in a throwaway copy of the repository** (`/tmp/mut2`, since deleted;
`README*.md` and `package.json` are outside this task's write scope). The real
tree was never modified — `git diff HEAD -- README.md README_EN.md package.json`
was empty afterwards and the plugin-file hash was unchanged.

Baseline: 6 pass / 0 fail / 15 expect() calls.

| Mutation | Observed |
| --- | --- |
| delete one `##` section from `README_EN.md` (a section that mentions no format literal, so only parity can catch it) | `(fail) …both keep the same number of level-2 sections` — `Expected: 7, Received: 6`, and nothing else failed |
| remove **all** backticked `` `xyz` `` from `README_EN.md` | `(fail) …both document every supported extension` **and** `(fail) …both document every Mol* reader the table declares` — exactly the two the lead predicted |
| remove the backticked `` `cifCore` `` from `README.md` | no failure — **because `cifCore` is not in the table at all** (see below); the mutation was mine to fix, not the test's |
| break the cross-link (`(README.md)` → `(README.md.bak)`) | `(fail) …both files are substantial and link to each other` |
| remove `"README_EN.md"` from `package.json#files` | `(fail) …both are shipped in the published package` |
| empty the reader set in the test copy (vacuity guard) | `(fail) …both document every Mol* reader the table declares` — `Expected: >= 5, Received: 0` |

Two notes from doing this honestly:

* My first attempt at the `` `xyz` `` mutation replaced only the **first**
  occurrence, and the test still passed — correctly, because a second occurrence
  remained. A mutation that does not land proves nothing; the second attempt
  removed every occurrence and the assertions bit. The same mistake in the
  vacuity-guard mutation (a `str.replace` whose pattern did not match) silently
  no-op'd until I asserted the replacement had landed.
* The reader set the test checks is
  `pdb, mmcif, ccp4, sdf, mol, mol2, pdbqt, gro, xyz` (9 ids); `cifCore` is **not**
  in the table, because this plugin maps `cif` to the `mmcif` reader. Worth
  knowing: every one of those 9 ids is also an extension today, so the
  "documents every Mol\* reader" assertion is currently implied by the
  "documents every extension" assertion. It has forward value rather than present
  value — it starts doing independent work the moment a format maps an extension
  to a reader id that is not itself an extension (e.g. `cif` → `cifCore`, or
  `lammps` → `lammps_data`).

### `tests/molstar-formats.test.ts` — PASS, non-vacuity falsified by mutation

The concern: a membership test can pass by matching nothing if Mol\*'s export is
renamed. Three mutations were applied **in a throwaway copy of the repository**
(`/tmp/mut`, since deleted) because `src/**` and that test file are outside this
task's write scope. The real tree was never modified — the plugin-file hash was
identical before and after.

| Mutation | Expected | Observed |
| --- | --- | --- |
| baseline (unmutated copy) | pass | 4 pass / 0 fail |
| `molstarFormat: "pdb"` → `"definitely-not-a-reader"` | fail | `(fail) …every structure/molecule format names a real trajectory reader` — `+ "pdb -> \"definitely-not-a-reader\""` |
| `molstarFormat: "ccp4"` → `"not-a-volume-reader"` | fail | `(fail) …every volume format names a real volume reader` — `+ "ccp4 -> \"not-a-volume-reader\""` |
| registries forced empty (simulates a renamed export) | fail | `(fail) …the registries were actually read (not vacuous)` — `Expected: > 5, Received: 0`, plus both membership tests failing |

So a wrong id fails with a precise, actionable message, and an empty registry
cannot slip through the non-vacuity guard.

Two corrections to the accompanying report, from my own run:

* the file contains **4** tests, not 5 (`139 + 4 = 143`, which is exactly the
  observed suite total);
* the registry sizes were reproduced independently and match:
  `trajectory ids (12): mmcif, cifCore, pdb, pdbqt, pqr, gro, xyz, lammps_data,
  lammps_traj_data, mol, sdf, mol2` and
  `volume ids (8): ccp4, dsn6, cube, dx, dscif, segcif, sfcif, mtz`.

The "deliberate boundary" note is confirmed against the source: Mol\* has eight
volume readers but `@molstudio/core` accepts five —
`node_modules/@molstudio/core/dist/MolStudio.d.ts:6`:
`export type VolumeFormat = "ccp4" | "dsn6" | "cube" | "dx" | "dscif";` — so the
table correctly stops at the five.

### The agent-open surface — three targeted falsification attempts

These live in `tests/registration.test.ts` (this task's write scope is fixed to
four files, so they sit beside the C4/C5 wiring tests rather than in a file of
their own).

**1. The registration guard.** `registerAll` capability-checks
`getSnapshot`/`subscribeState` before starting the poller, because an exception
there would take down every registration made before it. Both branches are
asserted, and then the guard is attacked:

| Scenario | Expected | Observed |
| --- | --- | --- |
| service **without** the two methods | full surface, no throw, poller not started, a warning | 2 tabs + 11 viewers, no poller effect, warning `agent-triggered opens are disabled` |
| service **with** them | full surface, poller started as one extra effect | 15 effect labels including `dsh-bioviewer: agent opens` |
| `getSnapshot` throws | must not escape `apply()` | 2 tabs + 11 viewers, poller still started |
| `subscribeState` throws | must not escape `apply()` | 2 tabs + 11 viewers, poller still started |
| `subscribeState` returns a non-function | must not escape `apply()` | 2 tabs + 11 viewers — see **F1** for what it does to teardown |

**2. The poll floor.** A ceiling, not a lullaby — plus a differential proving the
floor is load-bearing:

```
[floor] 150 ms at floor=10 ms -> 14 requests
[floor] 60 ms window -> floor=10 ms: 6 requests, floor=0: 53 requests
[floor] requests at dispose: 12, 60 ms later: 12
```

So a 150 ms window at a 10 ms floor makes 14 requests (ceiling asserted at 20,
floor asserted non-vacuous at ≥ 2); the same 60 ms window makes **53** requests
with the floor removed versus 6 with it; and disposal stops the loop dead.

Doing this honestly produced **F2**: my first differential hung the test run
forever. With `minPollIntervalMs: 0` and an answer that resolves in the
microtask queue, the loop never yields a macrotask, so the `setTimeout` that ends
the measurement window never fires. The floor is what prevents that starvation —
which is why the harness now yields a macrotask per iteration and why the
finding is recorded rather than hidden.

**3. Transport prefix safety.** `pluginRouteUrl` resolves this plugin's own route
because `hostRouteUrl()` only knows better-sidebar's `/sidebar/*`:

```
[transport] leading slash + sub-path -> http://127.0.0.1:5000/gui/bioviewer/open
[transport] base with query -> http://127.0.0.1:5000/gui/bioviewer/open
[transport] injected base -> http://127.0.0.1:6000/prefix/bioviewer/open
[transport] dsh-app scheme -> dsh-app://app/bioviewer/open
[transport] no-trailing-slash base -> http://127.0.0.1:5000/bioviewer/open
```

Covered: a leading-slash route is stripped and stays under a sub-path base; a
base carrying a query keeps its path and drops the query; the injected
`__DSH_TRANSPORT__.streamBaseUrl` wins over the document base; a non-http scheme
(`dsh-app://app/`) is preserved rather than coerced; `""`, `42`, `null`,
`undefined`, `{}` and even a non-object transport all fall back to the document
base; and with no base at all the failure is a loud throw, not a relative URL.
The last line is a **characterisation**, not a defect claim: a base whose path
has no trailing slash resolves by standard relative-URL rules (the last segment
is replaced), exactly as a browser would, so a shell injecting a directory base
must include the trailing slash.

### Host-half dependency declaration, and the registry race

Two more attacks requested by the lead, both in this revision:

**The DSH value-import invariant.** `lib/index.js` value-imports `defineTool`
from `@deepseek-ai/dsh-tools`, which was undeclared until this revision. The
invariant — *every DSH package the host bundle value-imports must be a declared,
non-optional peer, and no `@deepseek-ai/*` may be a runtime dependency* — now has
an assertion, with the import list **derived from the built artifact** rather
than hardcoded:

```
[C6] host bundle imports: @deepseek-ai/dsh-tools, node:path
[C6] DSH packages value-imported by the host half: @deepseek-ai/dsh-tools
```

It also asserts the list is non-empty, so the check cannot pass by scanning
nothing. Note on placement: the lead asked for this in `tests/manifest.test.ts`,
which is outside this task's fixed write scope (`tests/registration.test.ts`,
`tests/contract.test.ts`, `tests/build.test.ts`, `docs/VERIFICATION.md`), so it
lives in `tests/contract.test.ts` beside the other dependency-surface
assertions. Same invariant, same file coverage — just a different file.

**The registry race.** host-dev's fix makes `enqueue` skip a waiter that already
settled (its `finally` has not run yet) instead of handing it the request and
reporting `delivered: true`. The regression test was verified by mutation in a
throwaway copy (`/tmp/mut3`, since deleted — `src/**` is outside my write scope):

| Registry version | `tests/host-registry.test.ts` |
| --- | --- |
| shipped (skips settled waiters) | **12 pass / 0 fail** |
| naive (`parked.shift()` + unconditional `settle`, `delivered: true`) | **11 pass / 1 fail** — only `never hands a request to a waiter that already gave up` |

The failing assertion is `tests/host-registry.test.ts:126` —
`expect(registry.enqueue("s1", open("1ABC"))).toEqual({ delivered: false })` —
which receives `{ delivered: true }` under the naive version, with the request
handed to a waiter that already gave up. That is exactly the silent
"`delivered: true` but the open vanished" failure the feature must not have, and
the test catches it and nothing else. The mutation landed (asserted before
running) and the real tree was never touched.

---

## 6. Live DSH host verification (closes limitations #2 and #3)

The stub-loader checks are weaker than booting the real host, so the real host was
booted — on a throwaway `DSH_HOME` (`/tmp/dsh-verify-v`, since deleted), leaving
the user's `~/.dsh` untouched, and on port 59392 so the user's own GUI on 59290
was never disturbed.

```
$ DSH_HOME=/tmp/dsh-verify-v dsh plugin --profile web add "link:/Users/shuuul/repo/dsh-bioviewer"
dsh: initialized profile web at /tmp/dsh-verify-v/profiles/web
dependencies:
+ dsh-bioviewer <- ../../../../../Users/shuuul/repo/dsh-bioviewer
Done in 77ms using pnpm v12.16.1
```

The CLI auto-appended the bundle by reading our `dsh.bundle.patch` — there is no
hand-written mount line, and the profile's own patch layer is still empty:

```jsonc
// /tmp/dsh-verify-v/profiles/web/package.json
"dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-bioviewer" ] } }
// /tmp/dsh-verify-v/profiles/web/cordis.patch.yml  →  []
```

After adding `dsh-better-sidebar@0.28.2`, the composed config contains our row:

```
$ DSH_HOME=/tmp/dsh-verify-v dsh --profile web --dump-config
# == dsh-bioviewer
- id: dsh-bioviewer
  name: dsh-bioviewer
# == dsh-better-sidebar
- id: better-sidebar
  name: dsh-better-sidebar
```

Booting it and reading the injected boot graph:

```
$ DSH_HOME=/tmp/dsh-verify-v dsh --profile web --no-open --port 59392
dsh web: http://127.0.0.1:59392/?token=…

$ curl -c cookies -L "http://127.0.0.1:59392/?token=…"   → HTTP 200, 38005 bytes
window.__DSH_BOOT__ graph rev 4fb3f0828b7e, 71 entries, including:
  {"id":"dsh-bioviewer","url":"plugins/??dsh-bioviewer/client.js&rev=537066b7e740",
   "rev":"537066b7e740"}
```

Our row has **no `inject` edges**, which is the boot-graph mirror of
`export const inject: string[] = []`; `dsh-better-sidebar`'s row lists five.

Fetching the bundle the shell actually serves:

```
$ curl -b cookies "http://127.0.0.1:59392/plugins/??dsh-bioviewer/client.js&rev=537066b7e740"
HTTP 200 | text/javascript; charset=utf-8 | 3346997 bytes
// Generated by scripts/build.ts — do not edit.
window.__ModuleLoader__.load({
	id: "dsh-bioviewer",
	factory: (require) => {
```

**New finding — the host serves our artifact verbatim plus one appended comment.**
The first 3 346 927 bytes are byte-identical to `lib/client.js` (sha256
`81a94165…` matches exactly); the host appends a 70-byte suffix:

```
;\n//# sourceMappingURL=??dsh-bioviewer/client.js.map&rev=537066b7e740\n
```

The map endpoint answers `HTTP 200` even though `scripts/build.ts` sets
`sourcemap: "none"`, so the host synthesises or stores one. Neither detail
affects the registration contract, and the appended `;` terminates the wrapper
statement harmlessly — but it is why the served byte count (3 346 997) differs
from the artifact size.

Running the C2/C3 checks against those **served** bytes, not the local file:

```
served bytes: 3345668 chars
parse diagnostics: 0
served require specifiers: ["react","react-dom","react/jsx-runtime"]
non-literal require sites: 0
outside allowlist: []
handoff id: dsh-bioviewer | handoffs registered: 1 | factory is fn: true
```

This closes limitation #2: the host really does discover the package, compose the
boot row, and serve the bundle, with the wrapper intact. It materially strengthens
limitation #3: the specifiers our bundle asks for are exactly three of the four
the shell owns, so the shell can resolve all of them.

Teardown was verified rather than assumed: the throwaway server stopped
(`curl` → connection refused, no listener on 59392), the user's GUI on 59290 was
still answering, and `~/.dsh` was untouched (mtime unchanged at 12:08).

---

## 7. Defects found and their resolution

Five real defects were found and reported; all were fixed by the lead and are
covered by the assertions above. Two further defects were found **in this
verification harness itself** and are recorded for transparency.

### D1 — `.gz` bio files could never reach a viewer (found in `src/shared/formats.ts`)

`formats.ts` claimed better-sidebar matches "the last dot segment, so
`1abc.pdb.gz` has extension `pdb.gz`" — self-contradictory, and it built `exts`
as `["pdb", "pdb.gz"]`. The shipped matcher's `extOf` returns `"gz"`, so those
compound entries are inert and, with no viewer claiming `gz`, every `.pdb.gz` /
`.cif.gz` / `.mrc.gz` fell through to the built-in `code` catch-all.

Minimal reproduction (no dependencies, reads the installed artifact):

```
$ node -e 'const fs=require("fs");const s=fs.readFileSync("node_modules/dsh-better-sidebar/lib/client.js","utf8");
  const m=/function extOf\(path\)\s*\{[\s\S]*?\n\t\t\}/.exec(s)[0];
  const f=new Function(m+"; return extOf;")();
  console.log(f("1abc.pdb.gz"))'
gz
```

**Resolution:** compound `"<ext>.gz"` entries removed from `BioFormat.exts`, and a
sniff-only catch-all (`dsh-bioviewer:gzip`, `exts: []`, priority 10, gzip magic
`1f 8b`) registered instead. Re-verified through the shipped matcher — cases
(a)–(e) in §4.

### D2 — `cmm` was advertised but not viewable (found in `src/client/index.tsx`)

`BIO_EXTENSIONS` contains `cmm` and `isBioFile("model.cmm") === true`, so the
BioViewer tab listed `.cmm` files, but the marker format was skipped during
registration — clicking one opened the text editor. `task-4`'s C4(a) was
literally false for `cmm`.

```
$ bun -e 'import {BIO_EXTENSIONS,isBioFile} from "./src/shared/formats";
  console.log(BIO_EXTENSIONS.length); console.log(isBioFile("model.cmm"))'
16
true
```

**Resolution (revised in revision 6):** a real `dsh-bioviewer:cmm` descriptor
(priority 0, `exts: ["cmm"]`, `custom`) was added, so C4(a) became 16/16. The
marker pane it originally rendered reported the counts and claimed there was no
3D path "because Mol\* 5.13 exposes no public shape builder".

> **That claim was WRONG and is retracted.** Mol\* 5.13 really has no public
> shape builder, but `@molstudio/core` builds the shape node itself:
> `MolStudio.loadMarkers(set)` (added in **0.1.4**) adds a set as one object, with
> `setMarkerColor` / `setMarkerSize` driving its display. The dependency floor is
> now `^0.1.4`, and `.cmm` files render in 3D. See §3e — this report carried the
> same wrong claim, and correcting it is part of this revision.

### D5 — two stylesheets shared one element id (found by the lead during audit)

`src/client/index.tsx` and `src/client/browser.tsx` both declared
`STYLE_ELEMENT_ID = "dsh-bioviewer-styles"` and both used the "create the element
only if it is not already there" pattern, so whichever ran second injected
nothing: either Mol\*'s stylesheet or the browser's never reached the document,
depending on injection order. No error, no warning — only unstyled markup.

**Resolution:** the core stylesheet is now `dsh-bioviewer-core-styles` (and also
injects `notices.css`), with `tests/style-ids.test.ts` pinning uniqueness. My
independent check that the guard covers every injection site is in §5.

### D3 — verification harness: false negative in the C3 static scan

An earlier hand-rolled tokenizer mis-detected regex literals in minified Mol\*
(`/` division operators read as regex starts, e.g. at offsets 92553 and 99476)
and skipped the span containing `require("react-dom")` at offset 3271928. The
static leg reported only `react, react/jsx-runtime` while the runtime leg
reported three specifiers — the cross-check caught it.

**Resolution:** the tokenizer was replaced by (1) an exact TypeScript-AST walk as
the primary leg and (2) a deliberately fail-closed text scan as the secondary
leg, with the runtime leg cross-validating both directions. A fixture test proves
neither leg is vacuous: the AST leg finds exactly the two real literals plus the
one computed call, while the text leg additionally reports the decoys.

### D4 — verification harness: `^` without the `m` flag

The C6 type-only-import check used `/^[ \t]*import\s+type…/` without `m`, so `^`
matched only offset 0 and the import on line 29 was never examined. Fixed by
adding `m` (the pattern was already line-bounded). Observed after the fix:

```
[C6] type-only dsh-better-sidebar imports in: src/client/index.tsx
```

### F1 — the poller's disposer throws when `subscribeState` returns a non-function (**RESOLVED in revision 5**)

`startAgentOpens` stores whatever `subscribeSession(...)` returns as its
unsubscribe handle and calls it on teardown. The declared contract is
`subscribeState(listener): () => void`, so a host returning anything else is
already broken — but the failure lands on the *disposer*, which is what cordis
calls during plugin unload / HMR:

```
[adv] dispose results: ["ok", …, "threw: unsubscribe is not a function. (In 'unsubscribe()', 'unsubscribe' is undefined)"]
[adv] F1 disposer throws on a non-function unsubscribe: true
```

`apply()` itself did not throw, all 13 registrations were made, and the tab and
viewer disposers still ran — so the blast radius was the poller effect only.

**Fixed in revision 5** (the handle is held as `unknown` and called behind a
`typeof unsubscribe === "function"` guard), and my test now asserts the clean
teardown instead of recording the throw. See §3d.3.

### F2 — a zero poll floor starves the event loop (property of the option)

Found by my own harness hanging: with `minPollIntervalMs: 0` and a host that
answers immediately, the loop's `await` resolves in the microtask queue and never
yields a macrotask, so timers — including the one my test used to end its
measurement window — never fire. Measured differentially: 53 requests in a 60 ms
window at floor 0 versus 6 at floor 10.

The plugin never passes `0` (the default is 250 ms, and `registerAll` does not
override it), so this is not a live defect. It is recorded because it shows the
floor is load-bearing rather than decorative, and because the option's contract
should be read as "a positive floor, or the loop can starve timers".

### F3 — a marker set whose label matches a structure removed that structure (**RESOLVED in revision 7**)

`loadMarkerSets` removes objects by label alone, so an object that happens to
carry the same label as a marker set is indistinguishable from a set this file
drew earlier. Observed:

```
[markers] survivors after a colliding load: ["markers:markers"]
[markers] F3 the structure was removed: true
```

A studio holding a **structure** labelled `markers` loses it when a marker set
labelled `markers` is drawn — which needs a structure whose label equals the
set's label, e.g. a file literally named `markers.pdb` (the label comes from the
file title). The consequence is a silently missing structure, not a crash.

This was a consequence of the same label-based replacement that makes the
shared-label fix work (contract #9).

**Fixed in revision 7** by keying removal on `(label, kind)`. Verified in both
directions in §3f.3 — a structure labelled `markers` now survives a marker load,
and a marker set labelled like a structure survives a structure load.

**The fix is worth keeping as a worked example of a fix that would have
introduced the bug it was fixing.** The first specification of the kind was
"database → `structure`", which is wrong for EMDB: `loadEmdb` lands a **volume**
(`describeVolume` reports `kind: "volume"`). Keying EMDB as `"structure"` would
have matched nothing on reload and silently restored the duplicate-stacking bug
contract #9 exists to prevent — while looking like a correctness improvement and
passing every label-only assertion. viewer-dev caught it; §3f.1 shows the
regression test fails when the kind is mutated back, so the distinction is now
pinned rather than reviewed.

---

## 8. What is still not verified

1. **No browser was driven.** The real host was booted and served the bundle
   (§6), but no page was loaded, so the bundle was never materialized by the real
   loader, no component ever mounted, and **Mol\*/WebGL rendering and the sidebar
   UI remain unverified**. The in-process materialization in §4 runs under a
   hand-written DOM shim, not a browser. The agent-open loop in particular has
   never run against a real `fetch`, a real host route, or a real session switch.
   This now covers markers too: §3e verifies that a `.cmm` parses to the right
   numbers and reaches `loadMarkers` with the right sets, but **no marker has ever
   been drawn by a real Mol\* renderer** — the shape node, its colour/size
   application and the error panel's appearance are all unverified.
8. **The host route is verified at the HTTP boundary only (revision 5).** Booting
   a real host showed `/bioviewer/open` answering `403` with our JSON envelope when
   unauthenticated, `400` without a `sessionId`, and holding an authenticated poll
   for 25 s before returning a null envelope (§3d.1) — which is what proves the
   route registered at all. What is **not** verified: the tool's argument handling
   and queueing end to end (covered by host-dev's own tests, not re-run here), and
   any real delivery of an open from a model tool call through to a mounted viewer
   — no session was created and no client ever polled with a live `betterSidebar`
   service, so the consume-once handoff has never been exercised against real
   components.
9. **The new client modules are covered for the properties named in §5 only.**
   `parseOpenTarget` / `unsupportedPathReason` / `isOpenRequest`, the loop's
   session-switch abort and its backoff schedule are exercised by the authors'
   `tests/agent-opens.test.ts` and `tests/transport.test.ts`; I verified the
   registration guard, the poll floor and the transport base independently rather
   than re-running those files.
2. **No session was exercised.** The throwaway server was never logged into, so
   no session was created and the `betterSidebar` client service never came up —
   the registration path therefore ran against a fake ctx (§4) and against the
   real cordis type surface, but never against a live service instance.
3. **The host's `fs.read` → binary re-match path is inferred, not executed.**
   `planFsReadOutcome` → `matchFileViewer(path, head)` is taken from guide §5.4
   and from the shipped matcher's semantics; the gz cases drive the real matcher
   directly rather than through the host's file-open plumbing.
4. **Fake ctx, not a real fiber.** `ctx.inject`/`ctx.effect` exist with the
   expected signatures in the installed cordis 4.0.5 types, but no real cordis
   fiber was started, so activation ordering and disposer timing under the real
   loader are not exercised. (The real boot graph does confirm our row is
   composed and carries no `inject` edges.)
5. **The host's `canOpen` funnel is not exercised.** C4 asserts that viewer
   `exts` are disjoint from the extracted `HOST_OWNED_EXTS`; it does not run the
   host's address→kind routing.
6. **`isViewerEnabled` is stubbed to `true`** in the gz matcher driver; the
   user's per-viewer enable/disable preferences are not covered.
7. **Performance and memory of the 3.3 MB bundle** (parse time, Mol\* start-up)
   were not measured in a browser. The host did serve all 3 346 997 bytes
   successfully.

## 9. Anti-drift observations (not defects)

* The installed `dsh-better-sidebar` 0.28.2 registers **four** built-in viewers
  (`markdown`, `html`, `jsonl`, `code`); guide §5.4 still documents three. No id
  collision with `dsh-bioviewer:*` either way; the reserved-id list in
  `tests/registration.test.ts` is derived from the artifact and pinned by a
  comparison against `builtinViewers()`.
* `dsh-better-sidebar`'s bundle requires `@deepseek-ai/dsh-client-ui-primitives`
  and `@deepseek-ai/cordis`; that is legitimate for a first-party plugin but
  would be a hard failure for an external one. `dsh-bioviewer` requires none of
  them — C3 asserts this explicitly.
* Mol\*'s volume registry has three readers (`segcif`, `sfcif`, `mtz`) that
  `@molstudio/core`'s `VolumeFormat` union does not accept, so the format table
  deliberately stops at five. Recorded as a boundary, not an omission.
* The host appends a `sourceMappingURL` comment to served bundles and answers the
  `.map` request with HTTP 200 even though the build emits no source map.
  Harmless for the registration contract; noted because it makes the served bytes
  differ from the artifact.
