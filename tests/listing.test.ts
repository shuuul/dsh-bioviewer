/**
 * Storefront artifacts: the shared BioViewer PNG, screenshots.json, and the
 * README hero shots. Markets read these off the default branch, not npm.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  icon?: string;
  files?: string[];
};

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) {
    throw new Error("not a PNG");
  }
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === undefined) break;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!, width: (bytes[offset + 7]! << 8) | bytes[offset + 8]! };
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    offset += 2 + length;
  }
  throw new Error("JPEG SOF not found");
}

describe("marketplace listing artifacts", () => {
  test("package icon is the shared 1024 BioViewer PNG", () => {
    expect(pkg.icon).toBe("resources/img/icon.png");
    expect(pkg.files).toContain("resources/img/icon.png");
    expect(pkg.files).not.toContain("icon.svg");
    expect(existsSync(join(root, "icon.svg"))).toBe(false);
    const bytes = readFileSync(join(root, "resources/img/icon.png"));
    expect(pngSize(bytes)).toEqual({ width: 1024, height: 1024 });
    const tile = readFileSync(join(root, "resources/img/icon-180.png"));
    expect(pngSize(tile)).toEqual({ width: 180, height: 180 });
  });

  test("screenshots.json lists committed 2400x1710 JPEGs", () => {
    const listing = JSON.parse(readFileSync(join(root, "screenshots.json"), "utf8")) as unknown;
    expect(Array.isArray(listing)).toBe(true);
    const paths = listing as string[];
    expect(paths.length).toBeGreaterThanOrEqual(3);
    expect(paths.length).toBeLessThanOrEqual(8);
    expect(pkg.files ?? []).not.toContain("docs/screenshots");
    expect(pkg.files ?? []).not.toContain("screenshots.json");
    for (const src of paths) {
      expect(typeof src).toBe("string");
      expect(src.startsWith("docs/screenshots/")).toBe(true);
      expect(src.includes("..")).toBe(false);
      const bytes = readFileSync(join(root, src));
      expect(jpegSize(bytes)).toEqual({ width: 2400, height: 1710 });
    }
  });

  test("both READMEs show every screenshot listed in screenshots.json", () => {
    const paths = JSON.parse(readFileSync(join(root, "screenshots.json"), "utf8")) as string[];
    const zh = readFileSync(join(root, "README.md"), "utf8");
    const en = readFileSync(join(root, "README_EN.md"), "utf8");
    for (const src of paths) {
      expect(zh).toContain(`](${src})`);
      expect(en).toContain(`](${src})`);
    }
  });
});
