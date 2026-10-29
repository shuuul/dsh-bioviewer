# dsh-bioviewer

[English](README_EN.md) · **中文**

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的侧边栏里，直接查看文件系统中的生物大分子结构、冷冻电镜密度图与小分子。

这是一个 DSH 插件：它向第三方插件 [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar) 注册结构生物学格式的文件预览器，因此在侧边栏打开 `.pdb`、`.cif` 或 `.mrc` 时，会用 [Mol\*](https://molstar.org)（经 [`@molstudio/react`](https://www.npmjs.com/package/@molstudio/react)）以 3D 渲染——与 [BioViewer VS Code 扩展](https://github.com/shuuul/bioviewer) 使用同一套 viewer 栈。

## 功能

- **结构** —— PDB 与 mmCIF，带 MolStudio 的对象列表，以及按对象的表示方式、配色方案、不透明度与聚焦控制。
- **密度图** —— MRC / MAP / CCP4 体数据，带等值面控制与密度直方图。
- **小分子** —— SDF、MOL、MOL2、PDBQT、GRO 与 XYZ。
- **压缩文件** —— 上述所有格式都支持 `.gz` 后缀；文件在传输时保持压缩，在浏览器中解压。
- **工作区浏览器** —— 一个「BioViewer」侧边栏 tab，列出会话工作目录下的生物文件，不用离开侧边栏就能找到它们。
- **Agent 可以自己打开** —— 模型可以调用 `bio_open` 工具，把某个文件或某个数据库条目（`pdb:1cbs`、`alphafold:P00533`、`emdb:EMD-1234`）直接推到你的侧边栏里。
- **跟随宿主** —— viewer 跟随 DSH 的明暗主题，并使用 DSH 设计令牌，因此所有皮肤都无需逐个适配。
- **实时重载** —— 当你正在查看的文件被模型改写时，视图会自行重载，并**替换**旧对象，而不是叠加一个重复项。

## 支持的格式

| 类别 | 扩展名 | Mol\* reader |
| --- | --- | --- |
| 结构 | `pdb` `ent` | `pdb` |
| 结构 | `cif` `mmcif` `mcif` | `mmcif` |
| 体数据 | `mrc` `map` `ccp4` | `ccp4` |
| 小分子 | `sdf` `sd` | `sdf` |
| 小分子 | `mol` | `mol` |
| 小分子 | `mol2` | `mol2` |
| 小分子 | `pdbqt` | `pdbqt` |
| 小分子 | `gro` | `gro` |
| 小分子 | `xyz` | `xyz` |
| 标记模型 | `cmm` | 能识别、能解析，**但不绘制** —— 见[已知限制](#已知限制) |

每个扩展名也都支持 `.gz` 后缀（`1abc.pdb.gz`、`map.mrc.gz` 等）。

## 安装

插件尚未发布到 npm，因此从本地检出安装。

**用 DSH CLI**（发布之后）：

```sh
dsh plugin --profile web add dsh-bioviewer
```

**从本地检出安装**，把插件挂进某个 profile：

```sh
bun install && bun run build
```

然后在 `~/.dsh/profiles/<profile>/` 下：

1. 把插件加进 `package.json`：

   ```json
   { "dependencies": { "dsh-bioviewer": "link:/absolute/path/to/dsh-bioviewer" } }
   ```

2. 往 `cordis.patch.yml` 加挂载行（或者直接依赖 `dsh.bundle.patch`，官方 CLI 走的就是这条路）：

   ```yaml
   - insert:
       - id: dsh-bioviewer
         name: 'dsh-bioviewer'
   ```

3. 在 profile 目录里执行 `pnpm install`，然后硬刷新浏览器（Cmd/Ctrl+Shift+R）。

`dsh-better-sidebar` 是**可选**依赖：没有它，插件照常加载，但什么都不做。要看到 viewer，请安装它：

```sh
dsh plugin --profile web add dsh-better-sidebar@latest
```

## 使用

- **从侧边栏** —— 在 `+` 菜单里打开「BioViewer」tab，列出会话工作目录下的生物文件，然后点一个。或者通过宿主的文件树、聊天里的链接打开任意受支持的文件，注册的 viewer 会接管编辑区。
- **压缩文件** —— `.gz` 文件通过内容嗅探路由，用起来和未压缩版本完全一样。

## Agent 触发打开

除了自己点文件，你也可以让模型直接把东西推到侧边栏。宿主半注册了一个 `bio_open` 工具：

| 参数 | 说明 |
| --- | --- |
| `target` | 文件路径（绝对路径，或相对于会话工作目录），或数据库条目：`pdb:1cbs`、`alphafold:P00533`、`emdb:EMD-1234` |
| `title` | 可选，tab 标题（默认用文件名，或数据库名 + 编号） |

它的返回值带一个 `delivered` 字段：`true` 表示侧边栏当时连着、已经上屏；`false` 表示那一侧的会话侧边栏还没挂载，这次打开**排队**在那里，等它下次上屏时送达。

和 better-sidebar 自带的 `sidebar_open` 的区别在于它是**生物感知**的：扩展名会先跟本插件的格式表核对，不支持的文件会被明确拒绝并附上可支持的扩展名清单，而不是悄悄落到文本编辑器里；数据库条目则完全不需要本地文件。

链路是：工具把请求按会话入队 → 侧边栏用一个长轮询（`GET bioviewer/open?sessionId=…`）取走 → 客户端打开文件（走编辑器，由注册的 viewer 接管）或打开一个结构 tab。之所以要自己搭这条链路，是因为 `ctx.sidebarRight` 是**纯客户端**服务（它的宿主半对宿主树没有任何贡献），宿主侧没有别的办法把一次打开推进浏览器。

## 开发

```sh
bun install
bun run build        # lib/index.js（宿主半）+ lib/client.js（客户端半）
bun run typecheck    # tsc --noEmit
bun run lint         # oxlint
bun test             # bun:test
bun run verify:fast  # lint + typecheck + build + test —— 钩子与 CI 用的就是这条
```

`verify:fast` 就是 `.husky/pre-push` 与 CI 跑的同一件事；`pre-commit` 只对暂存文件跑 `oxlint`，`commit-msg` 强制 Conventional Commits。

架构、本插件依赖的宿主契约，以及那些容易被重新引入的坑，都记在 [AGENTS.md](AGENTS.md) 里。

## 已知限制

- **不绘制标记模型（`.cmm`）。** Mol\* 5.13 没有公开的 shape builder（`PluginContext.builders` 只有 `data`、`structure` 和 `preset`），要画球和连线就得直接操作 state tree。插件能识别、能列出、能解析这类文件，viewer 会报告 marker set 名称、marker 数与 link 数，而不是给你一个空视口。等 Mol\* 提供 shape builder，或者做一层「合成结构」桥接，才能真正画出来。
- **不支持 Binary CIF（`.bcif`）** —— 它不在 Mol\* 内置的 trajectory 格式列表里。
- 工作区浏览器一次只列一层目录，没有跨工作区的索引。
- viewer 界面目前只有英文。

## 许可证

MIT
