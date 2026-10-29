/**
 * Guards against a class of bug that is invisible until the UI looks broken:
 * two modules injecting a stylesheet under the SAME element id.
 *
 * Both `src/client/index.tsx` and `src/client/browser.tsx` inject their sheet
 * with the same "create the element only if it is not already there" pattern.
 * If the ids collide, whichever runs second finds the element and injects
 * nothing — so one of the two sheets silently never reaches the document. There
 * is no error, no warning, and the only symptom is unstyled markup.
 *
 * A unit test is the right place for this: the failure depends on injection
 * order, which no single module can observe.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

/** Every `const STYLE_ELEMENT_ID = "..."` declaration under `src/`. */
function styleIds(): { file: string; id: string }[] {
  const found: { file: string; id: string }[] = [];
  for (const file of globSync("src/**/*.{ts,tsx}", { cwd: root })) {
    const source = readFileSync(join(root, file), "utf8");
    for (const match of source.matchAll(/STYLE_ELEMENT_ID\s*=\s*"([^"]+)"/g)) {
      if (match[1] !== undefined) found.push({ file, id: match[1] });
    }
  }
  return found;
}

describe("injected stylesheet ids", () => {
  test("every STYLE_ELEMENT_ID declaration uses a distinct id", () => {
    const declared = styleIds();
    // Guard against the scan silently matching nothing and passing vacuously.
    expect(declared.length).toBeGreaterThanOrEqual(2);

    const byId = new Map<string, string[]>();
    for (const { file, id } of declared) {
      byId.set(id, [...(byId.get(id) ?? []), file]);
    }
    const collisions = [...byId.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([id, files]) => `${id} declared in ${files.join(", ")}`);

    expect(collisions).toEqual([]);
  });

  test("the plugin's own stylesheets are namespaced", () => {
    for (const { id } of styleIds()) {
      expect(id.startsWith("dsh-bioviewer")).toBe(true);
    }
  });
});
