# dsh-bioviewer

**English** · [中文](README.md)

View biomolecular structures, cryo-EM maps and small molecules in the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) sidebar. The
plugin registers viewers with [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar)
and renders them with [Mol\*](https://molstar.org) via
[`@molstudio/react`](https://www.npmjs.com/package/@molstudio/react) — the same
stack as the [BioViewer VS Code extension](https://github.com/shuuul/bioviewer).

## Features

- PDB / mmCIF / Binary CIF, MRC maps, small molecules, and Chimera `.cmm` markers (can overlay a map)
- `.gz` on every format; a "BioViewer" tab lists workspace files; follows the DSH theme and language
- Reloads **replace** the old object when the file is rewritten
- The model can call `bio_open` for a file or a database entry (`pdb:1cbs`, `alphafold:P00533`, `emdb:EMD-1234`)

## Supported formats

| Kind | Extensions | Mol\* reader |
| --- | --- | --- |
| Structure | `pdb` `ent` | `pdb` |
| Structure | `cif` `mmcif` `mcif` `bcif` | `mmcif` |
| Volume | `mrc` `map` `ccp4` | `ccp4` |
| Molecule | `sdf` `sd` | `sdf` |
| Molecule | `mol` | `mol` |
| Molecule | `mol2` | `mol2` |
| Molecule | `pdbqt` | `pdbqt` |
| Molecule | `gro` | `gro` |
| Molecule | `xyz` | `xyz` |
| Marker model | `cmm` | drawn by MolStudio as spheres and tubes |

Every extension also works with a `.gz` suffix (`1abc.pdb.gz`, `map.mrc.gz`, …).

## Install

```sh
dsh plugin --profile web add dsh-bioviewer
dsh plugin --profile web add dsh-better-sidebar@latest
```

Without better-sidebar the plugin loads but shows nothing. From a local checkout:

```sh
bun install && bun run build
dsh plugin --profile web add "link:$PWD"
```

## Usage

Open the "BioViewer" tab from the sidebar `+` menu, or open a supported file from
the file tree or a chat link. `.gz` files work like their uncompressed twins.

## Agent opens

`bio_open` takes a path or a `pdb:` / `alphafold:` / `emdb:` entry; `title` is
optional. `delivered: true` means it is on screen; `false` means the sidebar is
not mounted and the open is queued. Unsupported extensions are refused with the
supported list.

## Development

Bun **1.4.4**. `bun run verify:fast` is the pre-push and CI gate. Architecture
and host contracts: [AGENTS.md](AGENTS.md). Specs: [spec index](specs/README.md).
[Historical verification](docs/VERIFICATION.md) is not current acceptance.

```sh
bun install
bun run verify:fast
```

## Limitations

The workspace browser lists one directory level.

## License

MIT
