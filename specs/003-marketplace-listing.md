---
id: "003"
title: "Marketplace listing and product screenshots"
status: Active
created: 2026-10-30
updated: 2026-10-30
coordinator: "omp"
---

# 003 — Marketplace listing and product screenshots

## Context

`dsh-bioviewer@0.1.2` is already on npm. GitHub `shuuul/dsh-bioviewer` is still private, has no `dsh-plugin` topic, and has no `screenshots.json`. Community markets that ingest that topic (dshmarketplace, HackSing, lwmxiaobei) cannot see it. The curated [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) registry that feeds dsh-market also has no `shuuul__dsh-bioviewer.yml`. The plugin icon is a geometric SVG, not the DNA-and-protein mark used by [BioViewer for VS Code](https://github.com/shuuul/bioviewer).

## Goal and success criteria

- [ ] The GitHub repository is public with topics `dsh-plugin` and `dsh-better-sidebar`, homepage `https://github.com/shuuul/dsh-bioviewer#readme`, and a description that matches the English marketplace line.
- [ ] `resources/img/icon.png` is the same 1024×1024 DNA-and-protein mark as `../bioviewer/resources/img/icon.png`. `package.json` `icon` points at that PNG. `icon.svg` is gone.
- [ ] `docs/screenshots/` holds at least three App Store-style product shots (cryo-EM map, nucleic-acid complex, ligand pocket) at 2400×1710, plus a workspace-browser shot. `screenshots.json` lists them relative to the repository root.
- [ ] Both READMEs show the hero screenshot, a Screenshots section, and a marketplace listing section. Level-2 section counts stay equal.
- [ ] A PR exists against `awesome-dsh-plugin/awesome-dsh-plugin` adding `data/plugins/shuuul__dsh-bioviewer.yml` (category `tools`, bilingual descriptions, `icon:` pointing at the GitHub-hosted PNG).
- [ ] A GitHub issue exists on `HackSing/dsh-plugins` using the submit-plugin form. A listing PR exists against `omdsh-dev/DSH-better-sidebar` adding this plugin to `plugins-viewers.ts` with locale keys.
- [ ] `bun run verify:fast` passes on the listing artifacts.

## Scope and non-goals

In scope:

- Public GitHub listing metadata (visibility, topics, homepage, description).
- Shared BioViewer logo as a GitHub-hosted raster for storefronts.
- Product screenshots, `screenshots.json`, README wiring, listing tests.
- Catalog PRs / issues against awesome-dsh-plugin, DSH-better-sidebar, and HackSing.
- A throwaway capture page that loads MolStudio the same way the plugin does.

Not in scope:

- A new npm version or GitHub Release. Listing does not require bumping `0.1.2`.
- Changing tab/file-viewer chrome from the 16 px atom glyph to a raster logo.
- Adding `engines.dsh` (this package already declares `@deepseek-ai/dsh-tools` as a peer).
- Automating `npm publish` or a release-please workflow.
- Rewriting `docs/VERIFICATION.md` historical evidence.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
| --- | --- | --- | --- |
| 2026-10-30 | Share the VS Code BioViewer 1024×1024 PNG as the DSH storefront icon. | User request. awesome-dsh-plugin refuses SVG and third-party hosts; a GitHub-hosted PNG is the storefront tile. The 16 px tab glyph stays a stroke icon so it remains readable at sidebar size. | WS-01 |
| 2026-10-30 | Capture MolStudio through a throwaway React page, then composite App Store chrome matching `../bioviewer/docs/screenshots`. | The plugin is a better-sidebar consumer; a full DSH host is not needed to photograph the viewer. Same scenes as the VS Code shots (EMD-5778+3J5P, PDB 4OO8, PDB 1IEP) plus a workspace-browser shot unique to DSH. | WS-02 |
| 2026-10-30 | Category `ui` in awesome-dsh-plugin. | Sibling file previewers (`CMoyuer/dsh-cad-viewer`, `Crosery/dsh-viewer`) sit under `ui`. This plugin is a better-sidebar file viewer, not a new agent capability. Maintainers can refile. | WS-03 |
| 2026-10-30 | Do not bump the published version for listing-only assets. | npm already has 0.1.2; storefronts read GitHub `screenshots.json` and the PNG from the default branch. | WS-01 WS-03 |

## Workstreams

Use Pending, Claimed, In progress, Blocked, or Done. Workers claim before editing.

| ID | Deliverable | Owner | Status | Dependencies | Verification |
| --- | --- | --- | --- | --- | --- |
| WS-01 | Logo, screenshots.json, README, tests, package files, public GitHub metadata | omp | In progress | None | `bun test tests/listing.test.ts tests/readme.test.ts`; `gh api` topics/visibility |
| WS-02 | Product screenshots at 2400×1710 | omp | Done | WS-01 logo | JPEG files exist, listed in screenshots.json, render in README |
| WS-03 | Catalog PRs/issues (awesome-dsh-plugin, better-sidebar, HackSing) | omp | Pending | WS-01 public repo | PR/issue URLs recorded |

## Verification

- `bun run check:specs` and `bun test tests/specs.test.ts` before closeout.
- `bun run verify:fast` after listing files land.
- `file` / JPEG dimensions of each screenshot.
- `gh api repos/shuuul/dsh-bioviewer --jq '{visibility,topics}'` after making the repo public.
- Catalog PR URLs in the completion summary.

## Documentation sync

- Durable product/developer docs: README.md, README_EN.md, screenshots.json
- Nearest local `AGENTS.md`: files list and marketplace icon note
- Parent/package guidance: none
- Root guidance and roadmap: this spec

### Experiment refs

None.

## Progress and handoff

### 2026-10-30 — omp — WS-01 WS-02

- Changed: shared BioViewer 1024 PNG as `resources/img/icon.png`; four 2400×1710 App Store shots; `screenshots.json` is a path array; README hero + marketplace sections; listing tests.
- Evidence: `bun run verify:fast` 385 pass; JPEG SOF 2400×1710; PNG checksum matches `../bioviewer/resources/img/icon.png`.
- Remaining: commit, make the GitHub repo public, set topics, open catalog PRs/issues.
- Blockers: none
- Next action: commit listing artifacts, then publish GitHub metadata and catalog PRs.

## Completion summary

Not yet complete.
