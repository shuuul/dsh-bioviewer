/**
 * `README.md` is the Chinese primary; `README_EN.md` is its English mirror.
 *
 * Two documents that must say the same thing drift apart silently — the English
 * one is the one nobody reading the repo day to day will notice going stale. So
 * the parts that are *facts about the code* are asserted here rather than left to
 * review: every extension and every Mol* reader the plugin claims must be
 * documented in both, and the two must link to each other.
 *
 * Deliberately not asserted: prose, section titles or ordering. Those are
 * translations, and a test that demands identical wording would only teach
 * people to delete it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BIO_EXTENSIONS, BIO_FORMATS } from "../src/shared/formats";

const root = join(import.meta.dir, "..");
const zh = readFileSync(join(root, "README.md"), "utf8");
const en = readFileSync(join(root, "README_EN.md"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { files?: string[] };

/** Count of level-2 sections, as a cheap structural-parity signal. */
const sections = (markdown: string): number => markdown.match(/^## /gm)?.length ?? 0;

const readmes: readonly [string, string][] = [
  ["README.md", zh],
  ["README_EN.md", en],
];

describe("README pair", () => {
  test("both files are substantial and link to each other", () => {
    for (const [, text] of readmes) {
      expect(text.length).toBeGreaterThan(1500);
      expect(text).toContain("[AGENTS.md](AGENTS.md)");
    }
    expect(zh).toContain("(README_EN.md)");
    expect(en).toContain("(README.md)");
  });

  test("both are shipped in the published package", () => {
    expect(pkg.files).toContain("README.md");
    expect(pkg.files).toContain("README_EN.md");
  });

  test("both document every supported extension", () => {
    const missing: string[] = [];
    for (const [name, text] of readmes) {
      for (const ext of BIO_EXTENSIONS) {
        // The backticked form keeps `mol` from matching `mol2` / `molstar`.
        if (!text.includes(`\`${ext}\``)) missing.push(`${name}: ${ext}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("both document every Mol* reader the table declares", () => {
    const readers = [...new Set(BIO_FORMATS.map((format) => format.molstarFormat).filter((id) => id !== ""))];
    // Guard against the filter above silently emptying the set.
    expect(readers.length).toBeGreaterThanOrEqual(5);

    const missing: string[] = [];
    for (const [name, text] of readmes) {
      for (const reader of readers) {
        if (!text.includes(`\`${reader}\``)) missing.push(`${name}: ${reader}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("both keep the same number of level-2 sections", () => {
    // A section added to one language only is the most common way these drift.
    expect(sections(en)).toBe(sections(zh));
    expect(sections(zh)).toBeGreaterThanOrEqual(5);
  });
});
