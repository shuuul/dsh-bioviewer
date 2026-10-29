/**
 * Plugin-owned chrome: loading cards, notices, the workspace browser, tab titles.
 *
 * MolStudio already ships `en` / `zh-CN` catalogs for its own object list and
 * toolbar. This module is the matching catalog for strings *we* draw. Thrown
 * Error messages from Mol* stay as the library wrote them — they are not in
 * this table — and sit under a translated title.
 */
import type { StudioLocale } from "./locale";

const EN = {
  "start.title": "Starting the Mol* viewer…",
  "start.detail": "Creating the WebGL canvas.",
  "load.title": "Loading {title}…",
  "error.title": "Could not display {title}",
  "error.retry": "Retry",
  "error.dismiss": "Dismiss viewer error",
  "load.pdb": "Downloading {id} from the PDB archive.",
  "load.alphafold": "Downloading prediction {id} from AlphaFold DB.",
  "load.emdb": "Downloading map {id} from EMDB (author-recommended contour).",
  "load.markers": "Drawing {markers} markers and {links} links.",
  "notice.noData.title": "No data loaded",
  "notice.noData.body": "The viewer did not receive any bytes for {path}.",
  "notice.unknown.title": "Unknown structure",
  "notice.unknown.body": "This tab does not name a database structure.",
  "notice.unknown.bodyReason": "This tab does not name a database structure: {reason}.",
  "notice.noAddress": "the tab has no address",
  "browser.unavailable":
    "The better-sidebar service is unavailable, so the workspace cannot be listed.",
  "browser.loading": "Loading…",
  "browser.retry": "Try again",
  "browser.folders": "Folders",
  "browser.files": "Bio files",
  "browser.empty": "No bio files here",
  "browser.emptyHint": "Open a folder above to keep looking.",
  "browser.capped": "The host capped this listing — some entries are hidden.",
  "browser.parent": "Go to the parent folder",
  "browser.sessionRoot": "Session root",
  "browser.refresh": "Refresh the listing",
  "browser.openFile": "Open {path}",
  "tab.browser": "BioViewer",
  "tab.browserDescription": "Structures, density maps and ligands in this workspace",
  "tab.gzip": "Compressed bio file",
  "tab.structure": "Structure",
  "format.pdb": "PDB structure",
  "format.mmcif": "mmCIF structure",
  "format.ccp4": "CCP4/MRC density map",
  "format.sdf": "SDF molecule",
  "format.mol": "MOL molecule",
  "format.mol2": "MOL2 molecule",
  "format.pdbqt": "PDBQT molecule",
  "format.gro": "GRO structure",
  "format.xyz": "XYZ coordinates",
  "format.cmm": "Chimera markers",
} as const;

export type CopyKey = keyof typeof EN;

const ZH: { readonly [K in CopyKey]: string } = {
  "start.title": "正在启动 Mol* 查看器…",
  "start.detail": "正在创建 WebGL 画布。",
  "load.title": "正在加载 {title}…",
  "error.title": "无法显示 {title}",
  "error.retry": "重试",
  "error.dismiss": "关闭查看器错误",
  "load.pdb": "正在从 PDB 归档下载 {id}。",
  "load.alphafold": "正在从 AlphaFold DB 下载预测 {id}。",
  "load.emdb": "正在从 EMDB 下载密度图 {id}（作者推荐等高线）。",
  "load.markers": "正在绘制 {markers} 个标记、{links} 条连接。",
  "notice.noData.title": "未加载数据",
  "notice.noData.body": "查看器没有收到 {path} 的任何字节。",
  "notice.unknown.title": "未知结构",
  "notice.unknown.body": "此标签页未指定数据库结构。",
  "notice.unknown.bodyReason": "此标签页未指定数据库结构：{reason}。",
  "notice.noAddress": "标签页没有地址",
  "browser.unavailable": "better-sidebar 服务不可用，无法列出工作区。",
  "browser.loading": "正在加载…",
  "browser.retry": "再试一次",
  "browser.folders": "文件夹",
  "browser.files": "生物文件",
  "browser.empty": "这里没有生物文件",
  "browser.emptyHint": "打开上方的文件夹继续查找。",
  "browser.capped": "宿主截断了此列表，部分条目已隐藏。",
  "browser.parent": "转到上级文件夹",
  "browser.sessionRoot": "会话根目录",
  "browser.refresh": "刷新列表",
  "browser.openFile": "打开 {path}",
  "tab.browser": "BioViewer",
  "tab.browserDescription": "此工作区中的结构、密度图与配体",
  "tab.gzip": "压缩的生物文件",
  "tab.structure": "结构",
  "format.pdb": "PDB 结构",
  "format.mmcif": "mmCIF 结构",
  "format.ccp4": "CCP4/MRC 密度图",
  "format.sdf": "SDF 分子",
  "format.mol": "MOL 分子",
  "format.mol2": "MOL2 分子",
  "format.pdbqt": "PDBQT 分子",
  "format.gro": "GRO 结构",
  "format.xyz": "XYZ 坐标",
  "format.cmm": "Chimera 标记",
};

const CATALOGS: Record<StudioLocale, { readonly [K in CopyKey]: string }> = {
  en: EN,
  "zh-CN": ZH,
};

export type CopyVars = Record<string, string | number>;

/** Look up a chrome string and substitute `{name}` placeholders. */
export function t(locale: StudioLocale, key: CopyKey, vars?: CopyVars): string {
  const template = CATALOGS[locale][key];
  if (vars === undefined) return template;
  return template.replace(/\{([a-zA-Z]+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

export function isCopyKey(value: string): value is CopyKey {
  return Object.hasOwn(EN, value);
}

/** Translated format label; English copy is required to match `BIO_FORMATS`. */
export function formatLabel(locale: StudioLocale, formatId: string, fallback: string): string {
  const key = `format.${formatId}`;
  return isCopyKey(key) ? t(locale, key) : fallback;
}

/** English catalog, for tests that pin key/placeholder parity. */
export const COPY_EN: { readonly [K in CopyKey]: string } = EN;
export const COPY_ZH: { readonly [K in CopyKey]: string } = ZH;
