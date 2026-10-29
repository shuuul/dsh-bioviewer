/**
 * Packaging checks: what the DSH loader reads off this package before it ever
 * runs our code.
 *
 * A mistake here does not throw anywhere we can see — the loader either skips
 * the plugin or mounts a host half with no client half, and the only symptom is
 * that nothing appears in the sidebar. So these are asserted directly against
 * `package.json` and the files it points at.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string;
  main: string;
  exports: Record<string, unknown>;
  dsh?: { bundle?: { patch?: string }; client?: { platform?: string; inject?: string[] } };
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

/** Resolve the `default` (or bare string) target of an `exports` entry. */
function exportTarget(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null) {
    const record = entry as Record<string, unknown>;
    const value = record["default"] ?? record["import"];
    if (typeof value === "string") return value;
  }
  return undefined;
}

describe("DSH package manifest", () => {
  test("the host half entry exists", () => {
    expect(existsSync(join(root, pkg.main))).toBe(true);
  });

  test("declares a web client half and the bundle patch", () => {
    expect(pkg.dsh?.client?.platform).toBe("web");
    const patch = pkg.dsh?.bundle?.patch;
    expect(typeof patch).toBe("string");
    expect(existsSync(join(root, patch as string))).toBe(true);
  });

  test("the ./client export resolves to a file the loader can serve", () => {
    const target = exportTarget(pkg.exports["./client"]);
    expect(typeof target).toBe("string");
    expect(existsSync(join(root, target as string))).toBe(true);
  });

  test("exposes ./package.json and ./locale/*.json, which plugin discovery reads", () => {
    expect(pkg.exports["./package.json"]).toBe("./package.json");
    expect(pkg.exports["./locale/*.json"]).toBeDefined();
    // locale/en.json is the discovery baseline: without it the whole directory
    // is skipped and the plugin shows up as a bare line with no title.
    const english = JSON.parse(readFileSync(join(root, "locale/en.json"), "utf8")) as {
      meta?: { title?: string; description?: string };
    };
    expect(typeof english.meta?.title).toBe("string");
    expect(typeof english.meta?.description).toBe("string");
  });

  test("the bundle patch inserts this plugin under its own id", () => {
    const patch = readFileSync(join(root, pkg.dsh?.bundle?.patch as string), "utf8");
    // Minimal structural check: the row must exist, be enabled, and name the
    // package. A typo here silently mounts nothing.
    expect(patch).toContain("insert:");
    expect(patch).toContain(`id: ${pkg.name}`);
    expect(patch).toContain(`name: '${pkg.name}'`);
    expect(patch).not.toContain("disabled:");
  });

  test("better-sidebar is an optional peer, never a hard dependency", () => {
    expect(pkg.dependencies?.["dsh-better-sidebar"]).toBeUndefined();
    expect(pkg.optionalDependencies?.["dsh-better-sidebar"]).toBeUndefined();
    expect(pkg.peerDependencies?.["dsh-better-sidebar"]).toBeDefined();
    expect(pkg.peerDependenciesMeta?.["dsh-better-sidebar"]?.optional).toBe(true);
  });

  test("no dependency or peer is the unscoped cordis package (marketplace rule)", () => {
    for (const group of [pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies]) {
      expect(Object.keys(group ?? {})).not.toContain("cordis");
    }
  });
});
