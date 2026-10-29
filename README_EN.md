# dsh-bioviewer

**English** · [中文](README.md)

View biomolecular structures, cryo-EM density maps and small molecules from the
filesystem inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

It is a DSH plugin: it registers file viewers for structural-biology formats with
[`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar), so opening
a `.pdb`, `.cif` or `.mrc` in the sidebar renders it in 3D with
[Mol\*](https://molstar.org) through [`@molstudio/react`](https://www.npmjs.com/package/@molstudio/react) —
the same viewer stack as the
[BioViewer VS Code extension](https://github.com/shuuul/bioviewer).

## Features

- **Structures** — PDB and mmCIF, with MolStudio's objects list and per-object
  representation, colour scheme, opacity and focus controls.
- **Density maps** — MRC / MAP / CCP4 volumes with the contour control and the
  density histogram.
- **Small molecules** — SDF, MOL, MOL2, PDBQT, GRO and XYZ.
- **Marker models** — Chimera `.cmm`: markers drawn as spheres, links as tubes,
  each with its own colour and radius, able to sit over a density map in the same
  viewport.
- **Compressed files** — every format above also works with a trailing `.gz`;
  the file stays compressed on the wire and is inflated in the browser.
- **A workspace browser** — a "BioViewer" sidebar tab lists the bio files in the
  session working directory, so you can find them without leaving the sidebar.
- **The agent can open things itself** — the model can call the `bio_open` tool to
  push a file or a database entry (`pdb:1cbs`, `alphafold:P00533`, `emdb:EMD-1234`)
  straight into your sidebar.
- **Follows the shell** — the viewer tracks the DSH light/dark scheme and uses
  DSH design tokens, so every skin applies without per-skin work.
- **Live reload** — when the model rewrites a file you are looking at, the view
  reloads itself and **replaces** the old object instead of stacking a duplicate.

## Supported formats

| Kind | Extensions | Mol\* reader |
| --- | --- | --- |
| Structure | `pdb` `ent` | `pdb` |
| Structure | `cif` `mmcif` `mcif` | `mmcif` |
| Volume | `mrc` `map` `ccp4` | `ccp4` |
| Molecule | `sdf` `sd` | `sdf` |
| Molecule | `mol` | `mol` |
| Molecule | `mol2` | `mol2` |
| Molecule | `pdbqt` | `pdbqt` |
| Molecule | `gro` | `gro` |
| Molecule | `xyz` | `xyz` |
| Marker model | `cmm` | drawn by MolStudio as spheres and tubes (markers / links) |

Every extension also works with a `.gz` suffix (`1abc.pdb.gz`, `map.mrc.gz`, …).

## Install

```sh
dsh plugin --profile web add dsh-bioviewer
```

`dsh-better-sidebar` is **optional**: without it the plugin loads and does
nothing. Install it to get the viewers:

```sh
dsh plugin --profile web add dsh-better-sidebar@latest
```

**From a local checkout** (for development), build first, then mount it into a
profile:

```sh
bun install && bun run build
```

Then, in `~/.dsh/profiles/<profile>/`:

1. add the plugin to `package.json`:

   ```json
   { "dependencies": { "dsh-bioviewer": "link:/absolute/path/to/dsh-bioviewer" } }
   ```

2. add the mount row to `cordis.patch.yml` (or rely on `dsh.bundle.patch`, which
   the official CLI uses):

   ```yaml
   - insert:
       - id: dsh-bioviewer
         name: 'dsh-bioviewer'
   ```

3. `pnpm install` in the profile directory, then hard-refresh the browser
   (Cmd/Ctrl+Shift+R).

## Usage

- **From the sidebar** — open the "BioViewer" tab (`+` menu) to list the bio
  files under the session working directory, then click one. Or open any
  supported file through the host's file tree or a chat link; the registered
  viewer takes over the editor pane.
- **Compressed files** — `.gz` files are routed by content sniffing, so they work
  the same way as their uncompressed counterparts.

## Agent-triggered opens

Besides clicking a file yourself, you can ask the model to put something in the
sidebar. The host half registers a `bio_open` tool:

| Parameter | Meaning |
| --- | --- |
| `target` | A file path (absolute, or relative to the session working directory), or a database entry: `pdb:1cbs`, `alphafold:P00533`, `emdb:EMD-1234` |
| `title` | Optional tab title (defaults to the file name, or the database and id) |

Its result carries a `delivered` flag: `true` means a sidebar was connected and
the open is on screen; `false` means that session's sidebar view is not mounted
yet, so the open is **queued** there and lands when it is next shown.

The difference from better-sidebar's own `sidebar_open` is that this one is
**bio-aware**: the extension is checked against this plugin's format table first,
so an unsupported file is refused with the list of supported extensions instead of
silently landing in the text editor — and a database entry needs no local file at
all.

The path is: the tool queues the request per session → the sidebar takes it with a
long poll (`GET bioviewer/open?sessionId=…`) → the client opens the file (through
the editor, where the registered viewer takes over) or opens a structure tab. The
reason this link had to be built at all is that `ctx.sidebarRight` is a
**client-only** service — its host half contributes nothing to the host tree — so
there is no host-side API that can push an open into the browser.

## Development

Local development and CI use Bun **1.4.4**, pinned in `packageManager` and `setup-bun`.

```sh
bun install
bun run build        # lib/index.js (host half) + lib/client.js (client half)
bun run typecheck    # tsc --noEmit
bun run lint         # oxlint
bun test             # bun:test
bun run check:specs  # spec lifecycle, numbering and index validation
bun run verify:fast  # specs + lint + typecheck + build + test — the hook and CI gate
```

`verify:fast` is what `.husky/pre-push` and CI run; `pre-commit` runs `oxlint` on
staged files, and `commit-msg` enforces Conventional Commits.

See [AGENTS.md](AGENTS.md) for the architecture, the host contracts this plugin
depends on, and the gotchas that are easy to reintroduce.
Cross-repository and parallel execution records live in the [spec index](specs/README.md).
The [historical verification entry point](docs/VERIFICATION.md) links original evidence,
not acceptance of the current version or completion of unfinished UI checks.
Markdown/spec-only PRs run the same gate. Releases remain manual; no release automation is added.

## Limitations

- **Binary CIF (`.bcif`) is not supported** — it is not in Mol\*'s built-in
  trajectory format list.
- The workspace browser lists one directory level at a time; there is no
  cross-workspace index.
- The workspace browser and loading/error copy are still English; MolStudio's
  object list and toolbar follow the DSH language and can be switched in the
  viewer.

## License

MIT
