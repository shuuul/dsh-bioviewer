# MolStudio 0.1.7 wasm pipeline — measurements

Evidence for [spec 007](../../007-molstudio-017-wasm-pipeline.md). Two independent
sources: the Lead's isolated probes of the shipped wiring (this document, section
1), and the end-to-end density-map benchmark that produced the numbers spec 007
quotes (section 2).

## 1. Wiring probes (shipped `STUDIO_OPTIONS`, real time)

Rig: `.verification/probe-lead/run-real.ts` drives headless Chrome over CDP and
evaluates a page module (`entry-real.ts`) with real timestamps. Every probe below
runs against the assets `src/client/generated/molstudio-assets.ts` ships, imported
through `src/client/surface-engine.ts`.

| probe | result |
| --- | --- |
| data URL decodes to | 55,026 B, magic `\0asm` |
| main-thread `WasmCore.create` | ok; 16³ grid meshes to 17,016 vertices / 33,624 indices |
| `makeSurfaceWorker()` + `init` | `ready` in 4 ms |
| `createSurfaceEngine(STUDIO_OPTIONS.surfaceEngine, …)` | `WorkerSurfaceEngine`, same 17,016 vertices |
| `downsampleGridRemote` 16³ → 8³, factor 2 | 11 ms, values **bitwise identical** to `downsampleGrid` with axis order `[2, 1, 0]` |
| `downsampleGridRemote` 290³ → 145³, factor 2 | 130 ms (JS `downsampleGrid`: 71 ms), checksum identical |
| engine tier handoff, 146³ wrapped grid | main-thread create 14-46 ms vs worker create 19-23 ms; `mesh()` 10 ms both, 295,516 triangles |

The downsample is off the main thread (the JS path is faster in wall-clock but
blocks), and both backends agree bit-for-bit on Mol*'s z-fastest layout, so the
precomputed result cannot be distinguished from the fallback in the state tree.

### 1.1 Rig trap: `--virtual-time-budget` starves workers

The first attempt drove Chrome with `--virtual-time-budget`, which pauses the
virtual clock once the network goes idle. Worker tasks then never ran: the same
290³ remote downsample measured **29,100 ms** (its own 30 s timeout) under virtual
time and **130 ms** without it, and a worker's second message arrived 8.4 s late.
Any measurement that crosses into a worker must use a live CDP session with real
time; `--dump-dom` and virtual-time flags silently turn a 130 ms call into a
30 s timeout.

## 2. End-to-end benchmark (0.1.5 vs 0.1.7)

Rig: `.verification/wasm-bench` (`bun tools/run.ts`). Every rep is the first studio
in a freshly navigated document, the `loadVolume()` promise is awaited over CDP in
real time (`awaitPromise: true`, never a virtual clock), and the numbers are medians
over the reps in each row. 0.1.5 runs its default (Mol* texture isosurface) path;
0.1.7 runs the wiring this repo ships from `src/client/surface-engine.ts` (embedded
data-URL wasm + blob-URL worker, worker tier on).

Two environments, because the answer differs:

- **hardware GPU** — this machine, `ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro)`,
  `MAX_TEXTURE_SIZE` 16384. This is the environment the product is used in.
- **software GL** — `ANGLE (Google, Vulkan 1.3.0 (SwiftShader …))`, kept because it
  is the reproducible one in CI-like containers and because it exposes what the
  downsample path costs. It is not a stand-in for a real GPU.

### 2.1 Hardware GPU (3 reps; EMD-10087 2 reps)

| map | 0.1.5 grid | 0.1.7 grid | 0.1.5 load | 0.1.7 load | 0.1.7/0.1.5 | 0.1.5 first frame | 0.1.7 first frame | 0.1.7 longest main-thread task | triangles (0.1.7) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EMD-1832 | 64³ | 64³ | 90 ms | 172 ms | 0.52x | 145 ms | 183 ms | 74 ms | 10.3k |
| EMD-3318 | 112³ | 112³ | 408 ms | 458 ms | 0.89x | 414 ms | 484 ms | 325 ms | 117.0k |
| EMD-10088 | 290³ | 290³ | 861 ms | 1.29 s | 0.67x | 926 ms | 1.31 s | 465 ms | 841.4k |
| EMD-10087 | 500³ | 250³ | 3.99 s | 4.98 s | 0.80x | 4.11 s | 5.01 s | 802 ms | 3.21M |

On this GPU `MAX_TEXTURE_SIZE` is 16384, so EMD-10088 is **not** downsampled by 0.1.7
(grid factor 1): both versions mesh the same 290³ grid and commit the same 841.4k
triangles, which makes it the cleanest same-work comparison in the set — and 0.1.7
still costs 1.29 s against 0.1.5's 861 ms. EMD-10087 does still downsample (2× to
250³) and 0.1.7 costs 4.98 s against 3.99 s.

0.1.5's 64³ baseline is bimodal on hardware (reps 810/90/89 ms, first rep cold), so
that row's ratio is the least stable; 0.1.7 wins no map once the cold rep is
excluded on the 0.1.5 side.

### 2.2 Software GL / SwiftShader (5 reps; EMD-10088 3, EMD-10087 2)

| map | 0.1.5 grid | 0.1.7 grid | 0.1.5 load | 0.1.7 load | 0.1.7/0.1.5 | 0.1.5 first frame | 0.1.7 first frame | 0.1.7 longest main-thread task | triangles (0.1.7) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EMD-1832 | 64³ | 64³ | 1.51 s | 2.24 s | 0.67x | 1.59 s | 2.51 s | 1.48 s | 10.3k |
| EMD-3318 | 112³ | 112³ | 1.68 s | 2.23 s | 0.75x | 1.77 s | 2.65 s | 1.43 s | 117.0k |
| EMD-10088 | 290³ | 145³ | 599 ms | 2.25 s | 0.27x | 1.72 s | 2.44 s | 1.21 s | 111.8k |
| EMD-10087 | 500³ | 250³ | 4.46 s | 14.99 s | 0.30x | 4.60 s | 15.81 s | 8.95 s | 3.21M |

The software-GL ratios are not a GPU verdict: 0.1.5's rows are Mol*'s texture
isosurface rasterised by SwiftShader, while 0.1.7 refuses that GPU path for periodic
volumes at all, so the comparison there is "software GPU texture isosurface" vs
"CPU wasm" and the 0.1.5 side is penalised by the software rasteriser. The 500³ row
is also the one place 0.1.7's off-thread downsample hurts in wall-clock: the main
thread blocks in a single 8.9-16.4 s task and the reps took 22.7 s / 7.3 s.
`Float32Array.from` of that 125M-element array measures 73 ms in isolation, so the
500 MB transfer/allocation behaviour around the worker is **not** the copy and stays
unattributed (a profiler trace, not this harness, would name it).

### 2.3 Where 0.1.7's extra time goes (and where it does not)

| claim | evidence |
| --- | --- |
| not the wasm kernel | 0.1.7 with the engine completely unwired (packaged wasm/worker URLs resolve to nothing → Mol*'s JS marching cubes, **no wasm at all**) is as slow as the wired row: 2.24 s / 2.13 s / 2.56 s on the 64³ / 112³ / 290³ maps under software GL, against 2.24 s / 2.23 s / 2.25 s wired. |
| not the downsample | the same fixed cost appears on `synth-nonperiodic-96`, a GPU-eligible non-periodic grid where no `needsWrap` CPU fallback exists: 0.1.7 2.23 s vs 0.1.5 1.54 s. |
| not a shader/link/upload call | wrapping `compileShader`, `linkProgram`, `getProgramParameter(LINK_STATUS)`, `texStorage3D`, `texSubImage3D`, `texImage2D`, `bufferData` over the same window sums to ~1 ms while the longest task is 1.48 s (software) / 74 ms (Metal) — the stall is a blocking GPU-side operation inside a draw/commit the probe does not wrap, which is why it scales with the GPU. |
| the kernel win is real but invisible end to end | isolated, same grid / same iso / same triangles: the wasm engine meshes 4.6-23x faster than Mol*'s JS marching cubes (0.1.7 rows: 15.5x at 65³, 8.6x at 113³, 8.7x at 146³). Open time is dominated by Mol*'s parse + representation commit + the fixed cost above, so none of that reaches `loadVolume()`. |

Consequence recorded in the spec: 0.1.7's wiring is correct and worth keeping (the
kernel and the off-thread downsample are real), but it does not recover 0.1.5's open
time; the fixed cost is above the engine tier, so neither a tier swap nor a
downsample change can reach it. Spec 008 takes 0.1.8, which moves periodic solids
back onto Mol*'s `useGpu` path and removes the parse-time rebuild.

### 2.4 Rerun

```sh
cd /Users/shuuul/repo/dsh-bioviewer
bun .verification/wasm-bench/tools/run.ts --reps 5 --append              # software GL matrix
bun .verification/wasm-bench/tools/run.ts --huge --reps 3 --append       # 500³ map
bun .verification/wasm-bench/tools/run.ts --gpu hardware --reps 3 --append  # real GPU
```

Full matrices, every internal configuration (forced main-thread, packaged defaults,
served assets, per-rep timings, long-task and GL-call probes): gitignored
`.verification/wasm-bench/results/` (`results.md`, `results.json`,
`results-hardware.md`, `results-hardware.json`, and the derived
`handoff-0.1.5-vs-0.1.7.md`).
