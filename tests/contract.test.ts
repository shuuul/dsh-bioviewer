/**
 * C6 — contract conformance / anti-drift against the INSTALLED
 * `dsh-better-sidebar` (node_modules, version 0.28.2).
 *
 * Adversarial stance: every fact below is read out of the shipped artifact or
 * the installed type surface, never out of a prose paraphrase of it. Where the
 * shipped JavaScript is the authority (extension matching, the host-owned
 * extension set, the built-in descriptor ids), the test extracts that code
 * VERBATIM from `lib/client.js` and runs it, so a version bump that changes the
 * rule fails this file instead of silently invalidating the plugin's
 * assumptions.
 *
 * What this file does NOT prove: that the descriptors dsh-bioviewer registers
 * are accepted by the real service (that is `registration.test.ts`, which uses a
 * fake ctx) nor that the built bundle is a valid boot handoff (that is
 * `build.test.ts`).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const sidebarDir = join(root, "node_modules/dsh-better-sidebar");
const serviceDts = join(sidebarDir, "lib/types/client/service.d.ts");
const shippedClientJs = join(sidebarDir, "lib/client.js");

/** The guide's built-in descriptor ids that must not be re-registered (§4.4 / §5.4). */
const BUILTIN_TAB_IDS = ["editor", "git", "subagent", "sidechat", "diff", "terminal-bottom"];
const BUILTIN_VIEWER_IDS = ["markdown", "html", "code"];

/** The extensions better-sidebar's `canOpen` hands to DSH's own document preview (§5.4). */
const GUIDE_HOST_OWNED_EXTS = [
  "xlsx", "xls", "csv", "tsv", "fods", "pdf", "png", "jpg", "jpeg", "gif",
  "webp", "svg", "bmp", "ico", "doc", "docx", "ppt", "pptx",
];

/** Specifiers the DSH web shell resolves for a third-party client bundle. */
const SHELL_RESOLVABLE_SPECIFIERS = ["react", "react-dom", "react-dom/client", "react/jsx-runtime"];

const read = (path: string): string => readFileSync(path, "utf8");

/** Extract the source text of a top-level `function name(...) { ... }` from shipped JS. */
function extractFunction(src: string, name: string): string {
  const match = new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\t{2}\\}`).exec(src);
  if (!match) throw new Error(`shipped bundle no longer contains function ${name}()`);
  return match[0];
}

/** Extract a top-level `const NAME = ... new Set([...])` string-array literal. */
function extractStringSet(src: string, name: string): string[] {
  const match = new RegExp(`const ${name} = [^=]*?new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(src);
  if (!match) throw new Error(`shipped bundle no longer contains const ${name}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Field names declared at the top level of an `export interface X { ... }` block. */
function declaredFields(dts: string, interfaceName: string): string[] {
  const start = dts.indexOf(`export interface ${interfaceName} {`);
  if (start === -1) throw new Error(`service.d.ts no longer declares ${interfaceName}`);
  const body = dts.slice(start + `export interface ${interfaceName} {`.length);
  const end = body.indexOf("\n}");
  if (end === -1) throw new Error(`unterminated ${interfaceName} body`);
  return [...body.slice(0, end).matchAll(/^ {4}([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map((m) => m[1]);
}

/** Every .ts/.tsx file under src/, for source-level rules. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const sidebarPkg = JSON.parse(read(join(sidebarDir, "package.json"))) as { name: string; version: string };
const ourPkg = JSON.parse(read(join(root, "package.json"))) as {
  name: string;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  exports: Record<string, unknown>;
  dsh?: { client?: { platform?: string }; manifestVersion?: number };
  dependencies?: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("C6 installed dsh-better-sidebar contract", () => {
  test("installed package is present and its version satisfies the declared peer range", () => {
    expect(sidebarPkg.name).toBe("dsh-better-sidebar");
    const range = ourPkg.peerDependencies["dsh-better-sidebar"];
    expect(range).toBeDefined();
    // ^0.28.0 accepts 0.28.2. Assert the installed major/minor is the declared one.
    const declared = /^\^?(\d+)\.(\d+)\./.exec(range!)!;
    const installed = /^(\d+)\.(\d+)\.(\d+)/.exec(sidebarPkg.version)!;
    console.log(`[C6] installed dsh-better-sidebar ${sidebarPkg.version}, declared peer range ${range}`);
    expect(`${installed[1]}.${installed[2]}`).toBe(`${declared[1]}.${declared[2]}`);
  });

  test("dsh-better-sidebar is a peer dependency (optional), never a runtime dependency", () => {
    expect(ourPkg.peerDependencies["dsh-better-sidebar"]).toBeDefined();
    expect(ourPkg.dependencies?.["dsh-better-sidebar"]).toBeUndefined();
    expect(ourPkg.peerDependenciesMeta?.["dsh-better-sidebar"]?.optional).toBe(true);
  });

  test("the service surface the plugin calls exists in the installed types", () => {
    const dts = read(serviceDts);
    for (const method of [
      "registerTab(descriptor: TabDescriptor): () => void",
      "registerFileViewer(descriptor: FileViewerDescriptor): () => void",
      "hostRouteUrl(path: string): string",
      "openFile(scope: SessionScope, path: string, title?: string): void",
    ]) {
      expect(dts).toContain(method);
    }
  });

  test("TabDescriptor / FileViewerDescriptor declare every field the plugin passes", () => {
    const dts = read(serviceDts);
    const tabFields = declaredFields(dts, "TabDescriptor");
    const viewerFields = declaredFields(dts, "FileViewerDescriptor");
    console.log(`[C6] TabDescriptor: ${tabFields.join(", ")}`);
    console.log(`[C6] FileViewerDescriptor: ${viewerFields.join(", ")}`);

    // Fields registration.test.ts observes on the descriptors we hand over.
    const tabUsed = ["id", "title", "icon", "order", "component", "dedupeKey", "single"];
    const viewerUsed = ["id", "title", "exts", "fetchStrategy", "load", "component", "priority"];
    for (const field of tabUsed) expect(tabFields).toContain(field);
    for (const field of viewerUsed) expect(viewerFields).toContain(field);

    // Drift guards on the exact shapes the plugin relies on.
    expect(dts).toMatch(/exts: readonly string\[\]/);
    expect(dts).toMatch(/fetchStrategy: FileFetchStrategy/);
    expect(dts).toMatch(/component: \(props: FileViewerProps\) => ReactNode/);
  });

  test("the shipped extension matcher resolves a gz name to 'gz' (verbatim extraction)", () => {
    expect(existsSync(shippedClientJs)).toBe(true);
    const shipped = read(shippedClientJs);
    const extOf = new Function(`${extractFunction(shipped, "extOf")}; return extOf;`)() as (p: string) => string;
    // better-sidebar matches a descriptor against the LAST dot segment only.
    expect(extOf("1abc.pdb")).toBe("pdb");
    expect(extOf("1abc.pdb.gz")).toBe("gz");
    expect(extOf("1abc.cif.gz")).toBe("gz");
    expect(extOf("1abc.mol2")).toBe("mol2");
    expect(extOf("/a/b/1abc.CIF")).toBe("cif");
    expect(extOf("noext")).toBe("");
  });

  test("the shipped HOST_OWNED_EXTS set equals the documented hand-over list", () => {
    const shipped = read(shippedClientJs);
    const hostOwned = extractStringSet(shipped, "HOST_OWNED_EXTS");
    expect([...hostOwned].sort()).toEqual([...GUIDE_HOST_OWNED_EXTS].sort());
  });

  test("every built-in descriptor id is a literal in the shipped bundle", () => {
    const shipped = read(shippedClientJs);
    for (const id of [...BUILTIN_TAB_IDS, ...BUILTIN_VIEWER_IDS]) {
      expect(shipped).toContain(`id: "${id}"`);
    }
  });

  test("package.json tells the shell where both halves are", () => {
    expect(ourPkg.exports["./client"]).toEqual({
      types: "./lib/types/client/index.d.ts",
      default: "./lib/client.js",
    });
    expect(ourPkg.exports["."]).toEqual({
      types: "./lib/types/index.d.ts",
      default: "./lib/index.js",
    });
    expect(ourPkg.dsh?.client?.platform).toBe("web");
    expect(ourPkg.dsh?.manifestVersion).toBe(1);
  });

  test("no source file value-imports dsh-better-sidebar", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(root, "src"))) {
      const src = read(file);
      // Line-bounded on purpose: `[\s\S]*?` would let one import statement's
      // match run across newlines and mis-attribute the NEXT import.
      for (const match of src.matchAll(
        /^[ \t]*import\s+(type\s+)?([^\n]*?)\s+from\s+["']dsh-better-sidebar(?:\/[^"']*)?["']/gm,
      )) {
        if (match[1] === undefined) offenders.push(`${file}: ${match[0].trim()}`);
      }
      // Side-effect imports have no `from` clause and are always value imports.
      for (const match of src.matchAll(/^[ \t]*import\s+["']dsh-better-sidebar[^"']*["']/gm)) {
        offenders.push(`${file}: ${match[0].trim()}`);
      }
      for (const match of src.matchAll(/require\(\s*["']dsh-better-sidebar[^"']*["']\s*\)/g)) {
        offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the type-only import that triggers the ctx.betterSidebar augmentation is present", () => {
    // Guard against the value-import check above passing vacuously: the plugin
    // MUST import the augmentation somewhere, and only as a type.
    const typeOnly = sourceFiles(join(root, "src")).filter((file) =>
      /^[ \t]*import\s+type\s+[^\n]*from\s+["']dsh-better-sidebar/m.test(read(file)),
    );
    console.log(`[C6] type-only dsh-better-sidebar imports in: ${typeOnly.map((f) => f.replace(`${root}/`, "")).join(", ") || "(none)"}`);
    expect(typeOnly.length).toBeGreaterThan(0);
  });

  test("every DSH package the host bundle value-imports is a declared, non-optional peer", () => {
    // The host half is a real Node plugin now: it value-imports `defineTool`
    // from @deepseek-ai/dsh-tools. That coupling must be declared, because a
    // missing package fails the module import outright — the loader cannot even
    // report a useful error.
    //
    // The import list is DERIVED from the built artifact rather than hardcoded,
    // so the next value-import someone adds cannot slip through undeclared. The
    // current peer list is just this invariant's current value.
    const host = read(join(root, "lib/index.js"));
    const specifiers = [
      ...new Set(
        [...host.matchAll(/\bfrom\s*["']([^"']+)["']/g), ...host.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)].map(
          (match) => match[1],
        ),
      ),
    ].sort();
    const dshPackages = specifiers.filter((spec) => spec.startsWith("@deepseek-ai/"));
    console.log(`[C6] host bundle imports: ${specifiers.join(", ") || "(none)"}`);
    console.log(`[C6] DSH packages value-imported by the host half: ${dshPackages.join(", ") || "(none)"}`);
    // Non-vacuity: if the scan finds nothing, the invariant below proves nothing.
    expect(dshPackages.length).toBeGreaterThan(0);

    for (const spec of dshPackages) {
      expect(ourPkg.peerDependencies[spec]).toBeDefined();
      // Required, not optional: a missing package here is an import failure,
      // not a degraded feature.
      expect(ourPkg.peerDependenciesMeta?.[spec]?.optional ?? false).toBe(false);
    }

    // The other half of the rule: a DSH package must never be a runtime
    // dependency, because the profile provides it.
    const asDependency = Object.keys(ourPkg.dependencies ?? {}).filter((name) => name.startsWith("@deepseek-ai/"));
    expect(asDependency).toEqual([]);
  });

  test("the shell-resolvable specifier allowlist used by the build is the documented one", () => {
    // The allowlist is pinned here so build.test.ts and this file cannot drift
    // apart; build.test.ts asserts the emitted bundle stays inside it.
    expect(SHELL_RESOLVABLE_SPECIFIERS).toEqual(["react", "react-dom", "react-dom/client", "react/jsx-runtime"]);
    const buildScript = read(join(root, "scripts/build.ts"));
    for (const spec of SHELL_RESOLVABLE_SPECIFIERS) {
      expect(buildScript).toContain(`"${spec}"`);
    }
  });
});
