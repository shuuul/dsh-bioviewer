# dsh-bioviewer

**English** · [中文](README.md)

View biomolecular structures, cryo-EM maps and small molecules in the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) sidebar. The
plugin registers viewers with [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar)
and renders them with [Mol\*](https://molstar.org) via
[`@molstudio/react`](https://www.npmjs.com/package/@molstudio/react) — the same
stack as the [BioViewer VS Code extension](https://github.com/shuuul/bioviewer).

![A cryo-EM map with its fitted model in BioViewer](docs/screenshots/em-map.jpeg)

## Features

- PDB / mmCIF / Binary CIF, MRC maps, small molecules, and Chimera `.cmm` markers (can overlay a map)
- `.gz` on every format; a "BioViewer" tab lists workspace files; follows the DSH theme and language
- Reloads **replace** the old object when the file is rewritten
- The model can call `bio_open` for a file or a database entry (`pdb:1cbs`, `alphafold:P00533`, `emdb:EMD-1234`)

## Density-map acceleration (Wasm)

Since [`@molstudio/core`](https://www.npmjs.com/package/@molstudio/core) 0.1.6, density-map
isosurfaces are rebuilt by a WebAssembly marching-cubes kernel shipped inside MolStudio.
The plugin embeds that 54 KB `molstudio-wasm-engine.wasm` together with its worker as
base64 in `lib/client.js`, so it travels with the plugin: no extra asset route, no
`node_modules`, CDN or build-machine path, and it works offline. At runtime the worker
tier is tried first (the UI thread stays free), then the same wasm on the main thread,
and only then Mol\*'s own isosurface. `bun run sync:molstudio-assets` regenerates the
assets from the installed `@molstudio/core`.

Same input, same output geometry, the two marching-cubes implementations head to head
(Chrome 157 / V8, single thread, median of 3, identical triangle counts):

| Grid | Mol\* JS kernel | wasm kernel | Speedup |
| --- | --- | --- | --- |
| 96³ | 35 ms | 14 ms | 2.5× |
| 128³ | 74 ms | 35 ms | 2.1× |
| 192³ | 271 ms | 117 ms | 2.3× |
| 240³ | 555 ms | 261 ms | 2.1× |
| 290³ | 1227 ms | 365 ms | 3.4× |

**Opening a map end to end did not get faster.** On the same machine, time to first
frame (0.1.5 → 0.1.6 + wasm): 1.73 s → 2.46 s for a 64³ map, 1.59 s → 2.33 s for 112³,
1.92 s → 2.69 s for 290³. Meshing is a small part of opening a volume, and 0.1.6's
volume pipeline is heavier; it also keeps periodic grids — every EMDB map — off Mol\*'s
GPU isosurface, and downsamples large grids (290³ becomes 145³) before meshing. Inside
0.1.6 the engine still pays off: on the same 290³ map its own JS fallback takes 2.93 s
against 2.01 s with wasm (-31%).

The measurement ran in headless Chrome with software GL (SwiftShader), not on your GPU:
on real hardware 0.1.5's GPU isosurface is faster still, so the gap does not shrink;
wasm wins clearly only when a grid is large enough that 0.1.5 has to mesh on the CPU too.

## Screenshots

![Protein, RNA and DNA of Cas9 in one BioViewer tab](docs/screenshots/nucleic-acids.jpeg)

![Imatinib in its Abl kinase binding pocket](docs/screenshots/ligand.jpeg)

![The BioViewer workspace tab listing structures, maps and ligands](docs/screenshots/workspace.jpeg)

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

Requires **DSH 0.2.2-rc.1** or newer (`cordis` 4.1.0, Node.js 24.9+).

```sh
dsh plugin --profile web add dsh-bioviewer
dsh plugin --profile web add dsh-better-sidebar@latest
```

Without better-sidebar the plugin loads but shows nothing. From a local checkout:

```sh
bun install && bun run build
dsh plugin --profile web add "link:$PWD"
```

## Marketplace

The plugin is listed by GitHub `dsh-plugin` topic crawlers and the
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
catalog. Storefront shots live in `screenshots.json`. The icon is the same
DNA-and-protein mark as the [BioViewer VS Code extension](https://github.com/shuuul/bioviewer)
(`resources/img/icon.png`).

## Usage

Open the "BioViewer" tab from the sidebar `+` menu, or open a supported file from
the file tree or a chat link. `.gz` files work like their uncompressed twins.

## Agent opens

`bio_open` takes a path or a `pdb:` / `alphafold:` / `emdb:` entry and opens a
**new** tab. `bio_add` uses the same `target` to stack an object into the live
BioViewer (overlay a map on a structure, draw markers on a map, load a second
PDB). If no viewer is open, `bio_add` creates one. `title` is optional.
`delivered: true` means it reached a client; `false` means the sidebar is not
mounted and the request is queued. Unsupported extensions are refused with the
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
