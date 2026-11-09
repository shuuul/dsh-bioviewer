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

Same grid, same iso level, same triangle count, the two marching-cubes implementations
head to head (Chrome 157 / V8, single thread, real EMDB data):

| Grid meshed | Triangles | Mol\* JS kernel | wasm kernel | Speedup |
| --- | --- | --- | --- | --- |
| 65³ | 10 k | 9 ms | <1 ms | 22.8× |
| 113³ | 117 k | 35 ms | 4 ms | 9.2× |
| 146³ | 112 k | 58 ms | 6 ms | 9.1× |
| 251³ | 3.2 M | 440 ms | 97 ms | 4.6× |

The denser the surface, the closer the ratio gets to its floor: about 2-5× once a grid
produces millions of triangles (a 10-million-triangle noise grid measured 3.4×).

**Opening a map did not get faster — it got slower.** Same load path (`loadVolume`,
median of 3-5):

| Map | Grid | 0.1.5 | 0.1.6 + wasm | Grid 0.1.6 actually meshes |
| --- | --- | --- | --- | --- |
| EMD-1832 | 64³ | 1.44 s | 2.14 s | 64³ |
| EMD-3318 | 112³ | 1.49 s | 2.06 s | 112³ |
| EMD-10088 | 290³ | **0.61 s** | 2.22 s | **145³** (2× downsample) |
| EMD-10087 | 500³ | **4.26 s** | 5.41 s | **250³** (2× downsample) |

Three effects stack up:

1. 0.1.6 pays about 2 s of fixed pipeline cost per load (64³ and 250³ differ by only
   0.3 s), which swamps the few hundred milliseconds meshing saves;
2. for periodic grids — every EMDB map — 0.1.6 **no longer uses Mol\*'s GPU
   isosurface** and always meshes on the CPU;
3. grids above the texture limit are **downsampled unconditionally** (290³ → 145³,
   500³ → 250³; a host cannot turn it off), and the relative iso level is resolved
   against the downsampled statistics (2σ 0.0157 → 0.0143), so it renders a different
   surface — 841 k triangles collapse to 112 k on EMD-10088.

The measurement ran in headless Chrome with software GL (SwiftShader), not on your GPU.
The 1.4 s 0.1.5 rows above pay for software rasterising Mol\*'s GPU path (the same mesh
costs 9 ms of CPU marching cubes), so do not read the 64³/112³ gap as a real-GPU
regression; on real hardware 0.1.5 is faster still. Points 2 and 3 do not depend on the
GPU at all.

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
