import { describe, expect, test } from "bun:test";
import { COPY_EN, COPY_ZH, formatLabel, isCopyKey, t, type CopyKey } from "../src/client/copy";
import { BIO_FORMATS } from "../src/shared/formats";

const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

function placeholders(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (match[1] !== undefined) names.push(match[1]);
  }
  return names.sort();
}

describe("copy catalogs", () => {
  test("zh-CN has every English key, with the same placeholders", () => {
    const enKeys = (Object.keys(COPY_EN) as CopyKey[]).sort();
    const zhKeys = (Object.keys(COPY_ZH) as CopyKey[]).sort();
    expect(zhKeys).toEqual(enKeys);
    for (const key of enKeys) {
      expect(placeholders(COPY_ZH[key])).toEqual(placeholders(COPY_EN[key]));
    }
  });

  test("every BIO_FORMATS id has a format.* key whose English copy matches the table", () => {
    for (const format of BIO_FORMATS) {
      const key = `format.${format.id}`;
      expect(isCopyKey(key)).toBe(true);
      expect(t("en", key as CopyKey)).toBe(format.label);
      expect(formatLabel("en", format.id, "fallback")).toBe(format.label);
      expect(formatLabel("zh-CN", format.id, "fallback")).not.toBe(format.label);
    }
  });

  test("substitutes named placeholders and leaves unknown ones intact", () => {
    expect(t("en", "error.title", { title: "1abc.pdb" })).toBe("Could not display 1abc.pdb");
    expect(t("zh-CN", "error.title", { title: "1abc.pdb" })).toBe("无法显示 1abc.pdb");
    expect(t("en", "load.markers", { markers: 1, links: 0 })).toBe("Drawing 1 markers and 0 links.");
    expect(t("zh-CN", "load.markers", { markers: 12, links: 3 })).toBe("正在绘制 12 个标记、3 条连接。");
    expect(t("en", "load.title")).toBe("Loading {title}…");
  });

  test("formatLabel falls back when the id has no catalog entry", () => {
    expect(formatLabel("zh-CN", "not-a-format", "kept")).toBe("kept");
  });
});
