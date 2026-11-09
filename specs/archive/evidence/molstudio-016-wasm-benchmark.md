# MolStudio 0.1.6 wasm surface engine — speedup evidence (spec 006)

Preserved evidence for [spec 006](../006-molstudio-016-wasm.md). Two measurements,
both in Chrome/V8:

1. **End-to-end** — `loadVolume()` of the real viewer on real EMDB maps, 0.1.5 vs
   0.1.6 (with the embedded engine and without it). 31 scenarios, 0 failed reps,
   fresh document per rep, 3-5 reps per cell.
2. **Isolated** — the two marching-cubes implementations on identical grids and
   identical output geometry: Mol*'s `computeMarchingCubesMesh` (what 0.1.5 uses
   when it must mesh on the CPU, and what 0.1.6 falls back to) against
   `@molstudio/core` 0.1.6's wasm kernel.

## Environment

| item | value |
| --- | --- |
| Host | macOS (arm64), Apple Silicon |
| Browser | Chrome/157.0.8103.39, `--headless=new` |
| GL | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device)), `MAX_TEXTURE_SIZE` 8192, `colorBufferFloat` true |
| Flags | `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox --disable-gpu-sandbox --disable-dev-shm-usage` + a fresh `--user-data-dir` |
| `@molstudio/core` | 0.1.5 (baseline) and 0.1.6 (its 54,448-byte wasm engine embedded by this plugin) |
| Harness | `.verification/wasm-bench/tools/run.ts` (gitignored working copy) |

`--no-sandbox` is mandatory in this sandboxed session: without it Chrome's GPU
process fails sandbox initialisation, exits with `exit_code=6` and takes the
browser down with `SIGTRAP`. Environmental; unrelated to MolStudio.

## A. End-to-end: opening a real map (median `loadVolume()` ms, fresh document per rep)

| map | grid | 0.1.5 | 0.1.6 (no engine) | 0.1.6 + wasm wiring | 0.1.5 path | 0.1.6 path | grid 0.1.5 → 0.1.6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EMD-1832 | 64³ | 1,444 (5) | 1,928 (5) | 2,142 (5) | Mol* GPU texture isosurface | wasm CPU (no GPU for periodic volumes) | 64³ → 64³ |
| EMD-3318 | 112³ | 1,485 (5) | 2,066 (5) | 2,055 (5) | Mol* GPU texture isosurface | wasm CPU | 112³ → 112³ |
| EMD-10088 | 290³ | **610 (3)** | 2,275-2,310 (3) | 2,214 (3) | Mol* JS MC over 290³ | wasm MC over **145³** | 290³ → 145³ (factor 2) |
| EMD-10087 | 500³ | **4,260 (2)** | 6,000 (2) | 5,410 (2) | Mol* JS MC over 500³ | wasm MC over **250³** | 500³ → 250³ (factor 2) |

- Every grid is periodic (`Volume.isPeriodic` true), and 0.1.6 refuses its GPU
  isosurface for wrapped volumes (`!needsWrap` in `dist/volume/representation.js`),
  so every 0.1.6 row is CPU; 0.1.5 takes Mol*'s GPU texture path on the two grids
  that fit `maxTextureSize/2`.
- 0.1.6 is slower than 0.1.5 on **every** real map, including the 290³ map where it
  also meshes an 8× smaller grid.

## A.2 What was actually meshed

| map | triangles, 0.1.6 | triangles, 0.1.5's JS-MC analogue |
| --- | --- | --- |
| EMD-1832 | 10,284 | (GPU texture mesh, not countable in JS) |
| EMD-3318 | 117,044 | (GPU texture mesh) |
| EMD-10088 | 111,760 on 145³ | 841,412 on the full 290³ |
| EMD-10087 | 3,205,936 on 250³ | 14.5 M on the full 500³ |

## A.3 The kernels, isolated (identical grid, iso level and triangle count)

Measured inside 0.1.6's own page: its JS fallback call vs its engine call on the
same wrapped grid.

| map | grid | JS MC | wasm mesh | speedup |
| --- | --- | --- | --- | --- |
| EMD-1832 | 65³ | 9 ms | <1 ms | 22.8× |
| EMD-3318 | 113³ | 35 ms | 4 ms | 9.2× |
| EMD-10088 | 146³ | 58 ms | 6 ms | 9.1× |
| EMD-10087 | 251³ | 440 ms | 97 ms | 4.6× |

Same JS kernel on the grids 0.1.5 actually meshes: 290³ → 384 ms / 841 k triangles;
500³ → 2.59 s / 14.5 M triangles.

Independent cross-check on noisy grids (Leads own
`.verification/probe-lead/run-mesh.ts`, identical triangle counts, median of 3):

| grid | triangles | Mol* JS | wasm | speedup |
| --- | --- | --- | --- | --- |
| 96³ | 364,712 | 35 ms | 14 ms | 2.5× |
| 128³ | 871,368 | 74 ms | 35 ms | 2.1× |
| 192³ | 2,960,064 | 271 ms | 117 ms | 2.3× |
| 240³ | 5,763,556 | 555 ms | 261 ms | 2.1× |
| 290³ | 10,038,380 | 1,227 ms | 365 ms | 3.4× |

Both measurements agree on the mechanism: meshing time tracks triangle count, not
voxel count, and the wasm/JS ratio shrinks as the surface gets denser (fixed JS
overhead dominates on small surfaces, memory bandwidth on huge ones). Smooth
synthetic grids produce so few triangles that the engine returns in 1-5 ms
regardless of voxel count — which is why an early synthetic-only run saw nothing.

## Why the kernel win does not reach the user

- 0.1.6 pays roughly **2 s of fixed pipeline cost per load**: a 64³ map (1.93 s) and
  a 500³-downsampled map (6.0 s) differ far less than their mesh cost does, and the
  ~380 ms meshing saving at 290³ is swamped.
- **The GPU path is gone for periodic volumes.** 0.1.5 wraps a periodic grid and
  meshes on the GPU when it fits `maxTextureSize/2`; 0.1.6 always meshes such grids
  on the CPU (`useGpuIsosurface()` includes `!needsWrap(volume, props.wrap)`).
- **The downsample is unconditional and not host-avoidable.** `MolStudioOptions`
  exposes only `surfaceEngine` (`dist/MolStudio.d.ts:15-17`) and
  `SurfaceEngineAssets` only `wasmUrl/workerUrl/makeWorker/preferMainThread`
  (`dist/compute/types.d.ts:24-33`); the factor comes from
  `downsampleFactorFor(volume, plugin.canvas3d?.webgl)`
  (`dist/volume/operations.js:53`, policy in `dist/volume/policy.js:10`) and is
  applied whenever it is > 1. It is factor 2 for both 290³ and 500³ (the packed
  size lands on `maxTextureSize/2` = 4096), and because the relative iso level is
  resolved against the downsampled statistics (2σ 0.0157 → 0.0143) the rendered
  surface is a different one, not just a coarser one.

## Corrections recorded during the run

- An earlier 2-rep run reported 0.1.5 EMD-1832 at 858 ms and made the gap look like
  a pure GPU-vs-CPU loss; with a fresh document per rep and 5 reps the 0.1.5 number
  is 1,444 ms. The second and later WebGL contexts in one browser cost ~1.2 s under
  SwiftShader (both versions pay it; section E of the harness report).
- The 0.1.5 GPU rows are software-GL artefacts: the same meshes cost only 9 ms
  (64³) / 35 ms (112³) of CPU marching cubes, so those 1.4 s medians are SwiftShader
  rasterising cost. Do not present 64³/112³ as a real-GPU regression; the durable
  facts are the missing GPU path for periodic volumes and the unconditional
  downsample.
- An early tie-detection row reported "engine none" for the data-URL configuration;
  that was a harness bug (options passed flat instead of under `surfaceEngine`). The
  shipped wiring is verified independently by `.verification/probe-lead/run.ts`,
  which gets a `WorkerSurfaceEngine` from the embedded data URL + blob worker.

## Reproduce

```sh
cd /Users/shuuul/repo/dsh-bioviewer
bun .verification/wasm-bench/tools/run.ts --reps 5 --append
bun .verification/wasm-bench/tools/run.ts --huge --reps 3 --append
bun .verification/probe-lead/run-mesh.ts   # isolated kernel cross-check
bun .verification/probe-lead/run.ts        # shipped wiring: data URL + blob worker
```

The harness directories are gitignored working copies, not part of the package.
