import { describe, expect, test } from "bun:test";
import {
  catalogLocale,
  hostLanguage,
  LOCALE_STORAGE_KEY,
  readLocaleOverride,
  writeLocaleOverride,
} from "../src/client/locale";

describe("catalogLocale", () => {
  test("maps DSH and MolStudio Chinese tags onto zh-CN", () => {
    expect(catalogLocale("zh")).toBe("zh-CN");
    expect(catalogLocale("zh-CN")).toBe("zh-CN");
    expect(catalogLocale("zh-TW")).toBe("zh-CN");
    expect(catalogLocale("zh_HK")).toBe("zh-CN");
  });

  test("maps English and unknown languages onto en", () => {
    expect(catalogLocale("en")).toBe("en");
    expect(catalogLocale("en-US")).toBe("en");
    expect(catalogLocale("ja")).toBe("en");
    expect(catalogLocale("")).toBe("en");
    expect(catalogLocale("  ZH-cn  ")).toBe("zh-CN");
  });
});

describe("hostLanguage", () => {
  test("reads html lang, then navigator, then en", () => {
    const html = { documentElement: { lang: "zh" } } as Document;
    expect(hostLanguage(html, { language: "en-US" })).toBe("zh");
    expect(hostLanguage({ documentElement: { lang: "  " } } as Document, { language: "ja" })).toBe("ja");
    expect(hostLanguage({ documentElement: { lang: "" } } as Document, { language: "" })).toBe("en");
    expect(hostLanguage(undefined, undefined)).toBe("en");
  });
});

describe("locale override storage", () => {
  test("round-trips a catalog id and treats missing/blank as follow-host", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    expect(readLocaleOverride(storage)).toBeNull();
    writeLocaleOverride("zh-CN", storage);
    expect(store.get(LOCALE_STORAGE_KEY)).toBe("zh-CN");
    expect(readLocaleOverride(storage)).toBe("zh-CN");
    store.set(LOCALE_STORAGE_KEY, "   ");
    expect(readLocaleOverride(storage)).toBeNull();
  });

  test("survives missing or throwing storage", () => {
    expect(readLocaleOverride(undefined)).toBeNull();
    writeLocaleOverride("en", undefined);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLocaleOverride(throwing)).toBeNull();
    writeLocaleOverride("zh-CN", throwing);
  });
});
