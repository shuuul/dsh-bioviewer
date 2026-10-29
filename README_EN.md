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
- **Compressed files** — every format above also works with a trailing `.gz`;
  the file stays compressed on the wire and is inflated in the browser.
- **A workspace browser** — a "BioViewer" sidebar tab lists the bio files in the
  session working directory, so you can find them without leaving the sidebar.
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
| Marker model | `cmm` | recognised, parsed, **not drawn** — see [Limitations](#limitations) |

Every extension also works with a `.gz` suffix (`1abc.pdb.gz`, `map.mrc.gz`, …).

## Install

The plugin is not published to npm yet, so install it from a checkout.

**With the DSH CLI** (once published):

```sh
dsh plugin --profile web add dsh-bioviewer
```

**From a local checkout**, mount it into a profile:

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

`dsh-better-sidebar` is **optional**: without it the plugin loads and does
nothing. Install it to get the viewers:

```sh
dsh plugin --profile web add dsh-better-sidebar@latest
```

## Usage

- **From the sidebar** — open the "BioViewer" tab (`+` menu) to list the bio
  files under the session working directory, then click one. Or open any
  supported file through the host's file tree or a chat link; the registered
  viewer takes over the editor pane.
- **Compressed files** — `.gz` files are routed by content sniffing, so they work
  the same way as their uncompressed counterparts.

## Development

```sh
bun install
bun run build        # lib/index.js (host half) + lib/client.js (client half)
bun run typecheck    # tsc --noEmit
bun run lint         # oxlint
bun test             # bun:test
bun run verify:fast  # lint + typecheck + build + test — the hook and CI gate
```

`verify:fast` is what `.husky/pre-push` and CI run; `pre-commit` runs `oxlint` on
staged files, and `commit-msg` enforces Conventional Commits.

See [AGENTS.md](AGENTS.md) for the architecture, the host contracts this plugin
depends on, and the gotchas that are easy to reintroduce.

## Limitations

- **Marker models (`.cmm`) are not drawn.** Mol\* 5.13 exposes no public shape
  builder (`PluginContext.builders` has only `data`, `structure` and `preset`),
  so rendering spheres and links would mean reaching into the state tree. The
  file is recognised, listed and parsed, and the viewer reports the marker-set
  name, marker count and link count instead of showing an empty viewport. The
  fix is a shape-builder-backed renderer once Mol\* exposes one, or a
  synthesised-structure bridge.
- **Binary CIF (`.bcif`) is not supported** — it is not in Mol\*'s built-in
  trajectory format list.
- The workspace browser lists one directory level at a time; there is no
  cross-workspace index.
- The viewer UI is English-only.

## License

MIT
