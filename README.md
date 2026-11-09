# dsh-bioviewer

[English](README_EN.md) · **中文**

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 侧边栏里查看生物大分子、冷冻电镜密度图与小分子。插件向 [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar) 注册预览器，用 [Mol\*](https://molstar.org)（[`@molstudio/react`](https://www.npmjs.com/package/@molstudio/react)）渲染，与 [BioViewer VS Code 扩展](https://github.com/shuuul/bioviewer) 同一套 viewer。

![冷冻电镜密度图与拟合模型](docs/screenshots/em-map.jpeg)

## 功能

- PDB / mmCIF / Binary CIF、MRC 密度图、小分子，以及 Chimera `.cmm` 标记（可与密度图叠图）
- 所有格式支持 `.gz`；「BioViewer」tab 浏览工作区；跟随 DSH 明暗主题与界面语言
- 文件被改写时**替换**重载，不叠加
- 模型可用 `bio_open` 打开文件或数据库条目（`pdb:1cbs`、`alphafold:P00533`、`emdb:EMD-1234`）

## 密度图加速（Wasm）

从 [`@molstudio/core`](https://www.npmjs.com/package/@molstudio/core) 0.1.6 起，密度图的等值面改由 MolStudio 自带的 WebAssembly marching-cubes 内核重建。插件把这份 54 KB 的 `molstudio-wasm-engine.wasm` 和它的 worker 一起以 base64 内嵌进 `lib/client.js`，随插件分发：不新增资源路由，不依赖 `node_modules`、CDN 或构建机路径，离线可用。运行时先试 worker 里的引擎（不占界面线程），没有 worker 就用主线程里的同一份 wasm，两者都不可用才回落到 Mol\* 自己的等值面。资产由 `bun run sync:molstudio-assets` 从已安装的 `@molstudio/core` 重新生成。

同样的网格、同样的等值面、同样的三角形数，直接对比两套 marching cubes（Chrome 157 / V8，单线程，真实 EMDB 数据）：

| 重建的网格 | 三角形 | Mol\* JS 内核 | wasm 内核 | 倍数 |
| --- | --- | --- | --- | --- |
| 65³ | 10 k | 9 ms | <1 ms | 22.8× |
| 113³ | 117 k | 35 ms | 4 ms | 9.2× |
| 146³ | 112 k | 58 ms | 6 ms | 9.1× |
| 251³ | 3.2 M | 440 ms | 97 ms | 4.6× |

表面越密，倍数越接近下限：几百万三角形时约 2–5 倍（我们另用 1000 万三角形的噪声网格测得 3.4 倍）。

从 [`@molstudio/core`](https://www.npmjs.com/package/@molstudio/core) **0.1.8** 起，周期固体等值面重新走 Mol\* 的 GPU texture-mesh（与 0.1.5 同一套 `useGpu` 判定）。打开一张典型冷冻电镜密度图时**不启动 worker**。Wasm 只加速 CPU 路径：线框、没有 float 纹理、软件 GL。超过 GPU 纹理上限的网格在进程内用 wasm `ds_from_staging` 降采样，降完若能进 GPU 就走 GPU。

真机（ANGLE Metal，Apple M2 Pro）上：300³ 周期固体打开与 0.1.5 持平（~455–473 ms，无 worker，texture-mesh），等值面拖动约 17 ms；线框 iso 约 8 倍（~1 s → ~120 ms）；512³ 先降到 256³ 再走 GPU，打开 2.9 → 1.3 s，iso 约 230–280 倍（~4 s → ~14–17 ms）。先前用 SwiftShader 测得的打开时间不代表真机路径，已从产品说明中撤下。

## 截图

![Cas9 的蛋白、RNA 与 DNA](docs/screenshots/nucleic-acids.jpeg)

![结合口袋中的配体](docs/screenshots/ligand.jpeg)

![工作区浏览器](docs/screenshots/workspace.jpeg)

## 支持的格式

| 类别 | 扩展名 | Mol\* reader |
| --- | --- | --- |
| 结构 | `pdb` `ent` | `pdb` |
| 结构 | `cif` `mmcif` `mcif` `bcif` | `mmcif` |
| 体数据 | `mrc` `map` `ccp4` | `ccp4` |
| 小分子 | `sdf` `sd` | `sdf` |
| 小分子 | `mol` | `mol` |
| 小分子 | `mol2` | `mol2` |
| 小分子 | `pdbqt` | `pdbqt` |
| 小分子 | `gro` | `gro` |
| 小分子 | `xyz` | `xyz` |
| 标记模型 | `cmm` | MolStudio 画成球与管 |

每个扩展名也都支持 `.gz`（`1abc.pdb.gz`、`map.mrc.gz` 等）。

## 安装

需要 **DSH 0.2.2-rc.1** 或更新版本（`cordis` 4.1.0、Node.js 24.9+）。

```sh
dsh plugin --profile web add dsh-bioviewer
dsh plugin --profile web add dsh-better-sidebar@latest
```

没有 better-sidebar 时插件会加载，但不显示 viewer。开发用本地检出：

```sh
bun install && bun run build
dsh plugin --profile web add "link:$PWD"
```

## 市场上架

插件会出现在读取 GitHub `dsh-plugin` topic 的市场，以及 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 目录。商店图见 `screenshots.json`。图标与 [BioViewer VS Code 扩展](https://github.com/shuuul/bioviewer) 共用 `resources/img/icon.png`。

## 使用

侧边栏 `+` 菜单打开「BioViewer」，或从文件树 / 聊天链接打开受支持的文件。`.gz` 与未压缩文件用法相同。

## Agent 打开

`bio_open` 的 `target` 是路径或 `pdb:` / `alphafold:` / `emdb:` 条目，打开**新**标签。`bio_add` 用同样的 `target` 把对象叠进当前 BioViewer（密度图叠结构、标记叠密度图、再开一个 PDB）。没有已打开的 viewer 时 `bio_add` 会先创建一个。`title` 可选。`delivered: true` 表示已到达客户端；`false` 表示侧边栏未挂载、已排队。不支持的扩展名会被拒绝，并列出可支持格式。

## 开发

Bun **1.4.4**。`bun run verify:fast` 是 pre-push 与 CI 的门禁。架构与宿主契约见 [AGENTS.md](AGENTS.md)；规格见 [规格索引](specs/README.md)；[历史验证](docs/VERIFICATION.md) 不是当前验收。

```sh
bun install
bun run verify:fast
```

## 已知限制

工作区浏览器只列一层。

## 许可证

MIT
