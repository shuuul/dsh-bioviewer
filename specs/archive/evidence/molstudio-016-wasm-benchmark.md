# MolStudio 0.1.6 wasm surface engine — speedup evidence (spec 006)

Preserved evidence for [spec 006](../006-molstudio-016-wasm.md). Two independent
measurements:

1. **End-to-end** — `loadVolume()` and first-frame time of the real viewer on real
   EMDB maps, 0.1.5 vs 0.1.6 (± the embedded wasm engine), in headless Chrome.
2. **Isolated** — the two marching-cubes implementations head to head on identical
   float grids with identical output geometry, in the same browser engine.

## Environment

| item | value |
| --- | --- |
| Host | macOS (arm64), Apple Silicon |
| Browser | Chrome 157.0.8103.39, `--headless=new` |
| GL | ANGLE + SwiftShader (software rasteriser), WebGL 2.0, `MAX_TEXTURE_SIZE` 8192 |
| Flags | `--no-sandbox --disable-gpu-sandbox --disable-crash-reporter --disable-breakpad --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` |
| `@molstudio/core` | 0.1.5 (baseline) and 0.1.6 (+ its 54,448-byte wasm engine) |
| Harness | `.verification/wasm-bench/tools/run.ts` (gitignored working copy) |

`--no-sandbox` is required in this sandboxed session: without it Chrome's GPU
process fails sandbox initialisation, exits with `exit_code=6` and takes the
browser down with `SIGTRAP`. That is environmental and unrelated to MolStudio.

The GL renderer is SwiftShader, not the user's GPU. 0.1.5 takes Mol*'s GPU
texture-isosurface path for periodic grids that fit `maxTextureSize/2`; on real
hardware that path is faster still, so the 0.1.5 numbers below are, if anything,
pessimistic for 0.1.5.

## End-to-end: opening a real map (median of 5 loads, load / first frame)

| map | grid | 0.1.5 | 0.1.6 (no engine) | 0.1.6 + wasm | 0.1.6 downsample |
| --- | --- | --- | --- | --- | --- |
| EMD-1832 | 64³ | 1.65 s / 1.73 s | 1.71 s / 2.41 s | 1.70 s / **2.46 s** | 1× |
| EMD-3318 | 112³ | 1.52 s / 1.59 s | 1.67 s / 2.32 s | 1.66 s / **2.33 s** | 1× |
| EMD-10088 | 290³ | 971 ms / 1.92 s | 2.93 s / 3.56 s | 2.01 s / **2.69 s** | 2× (145³) |

- All three grids are periodic (`Volume.isPeriodic` true), i.e. the CPU/wasm path in
  0.1.6 — 0.1.6 refuses its GPU isosurface for wrapped volumes (`!needsWrap` in
  `dist/volume/representation.js`), and for 290³ it also downsamples to 145³ first.
- `loadVolume()` resolves at different pipeline stages in the two versions (0.1.5
  resolves before the isosurface is painted), so the first-frame column is the
  comparable one.
- **No end-to-end speedup**: 0.1.6 + wasm is 30-40% slower to first frame than
  0.1.5 on every map measured, including the large one where 0.1.5 meshes on the
  CPU as well.
- Inside 0.1.6 the engine is still worth 31% on a large map: 2.93 s → 2.01 s
  (290³, the difference is Mol*'s own JS marching cubes being replaced).

## Isolated: Mol*'s JS marching cubes vs the wasm kernel

Identical grids, identical absolute iso level, identical triangle counts, median
of 3, single thread, Chrome/V8. Mol* side: `computeMarchingCubesMesh` from
`molstar/lib/mol-geo/util/marching-cubes/algorithm.js` on the same wrapped tensor
shape Mol* uses (`(n+1)³` for periodic volumes). wasm side: `WasmCore.setGrid` +
`mesh` from `@molstudio/core` 0.1.6. Driven by `.verification/probe-lead/run-mesh.ts`.

| grid | triangles | Mol* JS | wasm | speedup |
| --- | --- | --- | --- | --- |
| 96³ | 364,712 | 35 ms | 14 ms | 2.5× |
| 128³ | 871,368 | 74 ms | 35 ms | 2.1× |
| 192³ | 2,960,064 | 271 ms | 117 ms | 2.3× |
| 240³ | 5,763,556 | 555 ms | 261 ms | 2.1× |
| 290³ | 10,038,380 | 1,227 ms | 365 ms | 3.4× |

Meshing time scales with triangle count, not voxel count. Synthetic grids with a
smooth analytic surface produce orders of magnitude fewer triangles than a noisy
grid of the same size, which is why an earlier synthetic-only run reported the
engine at 0.5-5 ms and could not see any difference at all.

## What the numbers mean

- The wasm kernel is genuinely 2-3.4× faster than Mol*'s JS marching cubes, and it
  removes that cost from 0.1.6's own CPU fallback.
- Opening a map is dominated by Mol*'s/MolStudio's volume pipeline (parse, state
  commit, representation, first paint): a 64³ load spends ~1.5 s there and a few
  milliseconds meshing. A 2-3× meshing speedup therefore cannot show up
  end-to-end on small and medium maps.
- This 0.1.6 repaints the periodic-volume path as CPU-only and downsamples large
  grids, so the upgrade as shipped is slower than 0.1.5 for the maps this plugin
  displays. The wasm engine is the faster kernel inside a heavier pipeline.

## Reproduce

```sh
# end-to-end matrix (needs the gitignored harness + downloaded maps)
bun .verification/wasm-bench/tools/run.ts --reps 5 --gpu swiftshader

# isolated meshing comparison
bun .verification/probe-lead/run-mesh.ts

# browser engine-created probe (shipped wiring: data URL + blob worker)
bun .verification/probe-lead/run.ts
```

The harness directories are gitignored working copies, not part of the package.
