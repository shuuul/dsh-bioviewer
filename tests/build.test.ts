/**
 * C1/C2/C3 — packaging and client-bundle purity of the built artifacts.
 *
 * Method, per claim:
 * - C1 is checked end to end: if `lib/` is missing or older than `src/`, this
 *   file runs `bun run build` itself and asserts on the result.
 * - C2 is checked by STATIC EXTRACTION of the emitted
 *   `window.__ModuleLoader__.load({ id, factory })` wrapper AND by evaluating
 *   the emitted bundle in-process against a stub `window.__ModuleLoader__`.
 *   Evaluating the script proves the registration handoff; it does NOT prove
 *   the factory's behaviour inside a real browser.
 * - C3 is checked twice: statically (a mini-lexer walks the bundle and reports
 *   every `require(...)` call site that is real code, not a string/comment) and
 *   dynamically (materializing the factory with a `require` stub that THROWS on
 *   any specifier outside the shell allowlist).
 *
 * Everything Mol* needs is bundled, so `factory(require)` executes several MB of
 * module bodies. When materialization needs a browser global the test installs a
 * minimal shim and says so in its output; if materialization is impossible in
 * this environment the test fails loudly rather than skipping, unless the
 * failure is reported in `docs/VERIFICATION.md` as an explicit limitation.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

import {
  createSourceFile,
  forEachChild,
  isCallExpression,
  isIdentifier,
  isStringLiteralLike,
  ScriptKind,
  ScriptTarget,
  type Node,
} from "typescript";

import { BIO_EXTENSIONS } from "../src/shared/formats";

const root = join(import.meta.dir, "..");
const libDir = join(root, "lib");
const hostHalf = join(libDir, "index.js");
const clientHalf = join(libDir, "client.js");

const ourPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string };

/** Specifiers the DSH web shell resolves for a third-party client bundle (see docs/VERIFICATION.md). */
const SHELL_RESOLVABLE_SPECIFIERS = ["react", "react-dom", "react-dom/client", "react/jsx-runtime"];

const nodeRequire = createRequire(join(root, "package.json"));

/** Read an artifact, surfacing the captured build log when it is missing. */
function readArtifact(path: string): string {
  if (!existsSync(path)) {
    throw new Error(
      `${path} does not exist. Build command: ${build.command} (exit ${build.exitCode})\n${build.output}`,
    );
  }
  return readFileSync(path, "utf8");
}

// ---------------------------------------------------------------------------
// C1 — build
// ---------------------------------------------------------------------------

function newestMtime(dir: string, filter: (name: string) => boolean): number {
  let newest = 0;
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (filter(entry)) newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

interface BuildEvidence {
  rebuilt: boolean;
  command: string;
  exitCode: number;
  output: string;
}

let build: BuildEvidence = { rebuilt: false, command: "", exitCode: -1, output: "" };

beforeAll(() => {
  const srcNewest = newestMtime(join(root, "src"), (name) => /\.(ts|tsx|css)$/.test(name));
  const libNewest = [hostHalf, clientHalf].every((f) => existsSync(f))
    ? Math.min(statSync(hostHalf).mtimeMs, statSync(clientHalf).mtimeMs)
    : 0;

  if (libNewest >= srcNewest && libNewest > 0) {
    build = {
      rebuilt: false,
      command: "bun run build (skipped: lib/ is newer than src/)",
      exitCode: 0,
      output: `existing artifacts: ${hostHalf}, ${clientHalf}`,
    };
    return;
  }

  const proc = Bun.spawnSync(["bun", "run", "build"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  build = {
    rebuilt: true,
    command: "bun run build",
    exitCode: proc.exitCode,
    output: `${proc.stdout.toString()}${proc.stderr.toString()}`.trim(),
  };
}, 600_000);

describe("C1 build output", () => {
  test("`bun run build` exits 0 and emits lib/index.js + lib/client.js", () => {
    console.log(`[C1] ${build.command}`);
    console.log(`[C1] exit=${build.exitCode}\n${build.output}`);
    expect(build.exitCode).toBe(0);
    expect(existsSync(hostHalf)).toBe(true);
    expect(existsSync(clientHalf)).toBe(true);
    const hostSize = statSync(hostHalf).size;
    const clientSize = statSync(clientHalf).size;
    console.log(`[C1] lib/index.js ${hostSize} B, lib/client.js ${clientSize} B`);
    expect(hostSize).toBeGreaterThan(0);
    // Mol* is bundled into the client half; a tiny file means the bundle lost its payload.
    expect(clientSize).toBeGreaterThan(1_000_000);
  });

  test("host half is an importable ESM cordis plugin exposing apply()", async () => {
    const host = (await import(hostHalf)) as { apply?: unknown; inject?: unknown };
    expect(typeof host.apply).toBe("function");
    if (host.inject !== undefined) expect(Array.isArray(host.inject)).toBe(true);
    console.log(`[C1] host half exports: ${Object.keys(host).join(", ")}; inject=${JSON.stringify(host.inject)}`);
  });

  test("every path package.json points the shell at exists after the build", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      main?: string;
      icon?: string;
      files?: string[];
      exports?: Record<string, string | Record<string, string>>;
      dsh?: { bundle?: { patch?: string } };
    };
    const targets: string[] = [];
    for (const value of Object.values(pkg.exports ?? {})) {
      if (typeof value === "string") targets.push(value);
      else targets.push(...Object.values(value));
    }
    targets.push(pkg.main ?? "", pkg.icon ?? "", pkg.dsh?.bundle?.patch ?? "");
    // Wildcard subpath patterns are resolved by the shell, not by this check.
    const missing = targets.filter((t) => t !== "" && !t.includes("*") && !existsSync(join(root, t)));
    console.log(`[C1] package.json targets checked: ${targets.filter((t) => t !== "" && !t.includes("*")).join(", ")}`);
    expect(missing).toEqual([]);
    // `files` is the npm publish allowlist: a non-glob entry naming a file that
    // does not exist ships a broken package (npm only warns). Globs are skipped
    // here — `locale/*.json` is exercised by the manifest test instead.
    const filesList = (pkg.files ?? []).filter((entry) => !entry.includes("*"));
    const missingFiles = filesList.filter((entry) => !existsSync(join(root, entry)));
    console.log(`[C1] package.json files entries checked: ${filesList.join(", ")}`);
    expect(missingFiles).toEqual([]);
    // The declaration emit is part of `bun run build`; a silently empty one
    // would still satisfy existsSync, so check it has content.
    expect(statSync(join(root, "lib/types/client/index.d.ts")).size).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// C2 — the client bundle is a valid boot handoff
// ---------------------------------------------------------------------------

interface Handoff {
  id: string;
  factory: (require: (spec: string) => unknown) => Record<string, unknown>;
}

/** Evaluate the emitted bundle against a stub registration sink; returns what it registered. */
function registerInSandbox(src: string): Handoff[] {
  const handoffs: Handoff[] = [];
  const win = {
    __ModuleLoader__: {
      load(handoff: Handoff) {
        handoffs.push(handoff);
      },
    },
  };
  // A missing top-level `document`/`navigator`/`self` reference would throw here,
  // which is itself the check that the script body only REGISTERS its factory.
  const run = new Function("window", "self", "globalThis", src);
  run(win, win, win);
  return handoffs;
}

/** Extract the wrapper facts textually (works even if evaluation is impossible). */
function extractWrapper(src: string): { id?: string; factoryArgs?: string } {
  const id = /__ModuleLoader__\s*\.\s*load\s*\(\s*\{\s*id\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(src)?.[1];
  const factoryArgs = /factory\s*:\s*\(([^)]*)\)\s*=>/.exec(src)?.[1];
  return { id, factoryArgs };
}

/**
 * Materialize the emitted factory once, recording every specifier it asks for.
 * Cached so C2 and C3 assert on the same execution.
 */
let materialized: { surface: Record<string, unknown>; required: string[] } | undefined;

function materializeBundle(): { surface: Record<string, unknown>; required: string[] } {
  if (materialized !== undefined) return materialized;
  const src = readArtifact(clientHalf);
  const [handoff] = registerInSandbox(src);
  if (handoff === undefined) throw new Error("client bundle registered no handoff");

  const required: string[] = [];
  const requireStub = (spec: string): unknown => {
    required.push(spec);
    if (!SHELL_RESOLVABLE_SPECIFIERS.includes(spec)) {
      throw new Error(`client bundle required a non-shell specifier: ${JSON.stringify(spec)}`);
    }
    return nodeRequire(spec);
  };

  const dom = installDomShim();
  let surface: Record<string, unknown>;
  try {
    surface = handoff.factory(requireStub);
  } finally {
    dom.restore();
  }
  materialized = { surface, required };
  return materialized;
}

describe("C2 client bundle registration handoff", () => {
  test("the emitted wrapper registers exactly one handoff whose id is the package name", () => {
    const src = readArtifact(clientHalf);
    const wrapper = extractWrapper(src);
    expect(wrapper.id).toBe(ourPkg.name);
    expect(wrapper.factoryArgs).toBe("require");

    const handoffs = registerInSandbox(src);
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].id).toBe(ourPkg.name);
    expect(typeof handoffs[0].factory).toBe("function");
    console.log(`[C2] sandbox registration: id=${handoffs[0].id}`);
  });

  test("factory(require) returns a surface exporting apply (function) and inject (array)", () => {
    const { surface, required } = materializeBundle();
    console.log(`[C2] factory required: ${[...new Set(required)].sort().join(", ") || "(none)"}`);
    expect(typeof surface.apply).toBe("function");
    expect(Array.isArray(surface.inject)).toBe(true);
    console.log(`[C2] factory surface: apply=${typeof surface.apply}, inject=${JSON.stringify(surface.inject)}`);
  });

  test("materialization did not require a browser global at script-evaluation time", () => {
    // The lazy-registration contract: executing the script must only register.
    // registerInSandbox() runs with a bare `window` and no DOM at all; if this
    // throws, the bundle has an eager top-level side effect.
    const src = readArtifact(clientHalf);
    expect(() => registerInSandbox(src)).not.toThrow();
  });

  test("the built bundle's exported apply(ctx) actually wires the registry", () => {
    // Stronger than "apply is a function": a bundle that mangled the factory
    // body could still export a stub. This drives the BUILT surface (not the
    // TS source) through the same fake-ctx shape registration.test.ts uses.
    //
    // The service here deliberately lacks getSnapshot/subscribeState, so the
    // agent-open poller is skipped: this test is about the descriptors the
    // bundle carries, and a started poller would leave a live loop behind.
    const { surface } = materializeBundle();
    const tabs: Array<{ id: string; hidden?: boolean; createTab?: unknown }> = [];
    const viewers: Array<{ id: string; exts?: readonly string[] }> = [];
    const sidebar = {
      registerTab: (descriptor: { id: string; hidden?: boolean; createTab?: unknown }) => {
        tabs.push(descriptor);
        return () => {};
      },
      registerFileViewer: (descriptor: { id: string; exts?: readonly string[] }) => {
        viewers.push(descriptor);
        return () => {};
      },
      hostRouteUrl: (route: string) => `/sidebar/${route}`,
      openFile: () => {},
      openTab: () => {},
    };
    const ctx: Record<string, unknown> = {
      betterSidebar: sidebar,
      get: () => sidebar,
      effect: (callback: () => unknown) => {
        const result = callback();
        return typeof result === "function" ? result : () => {};
      },
      inject: (_deps: readonly string[], callback: (scoped: unknown) => void) => {
        callback(ctx);
        return () => {};
      },
      on: () => () => {},
      logger: Object.assign(() => {}, { info: () => {}, warn: () => {}, error: () => {} }),
    };

    (surface.apply as (c: unknown) => void)(ctx);
    const ids = [...tabs, ...viewers].map((descriptor) => descriptor.id);
    console.log(`[C2] built apply(): ${tabs.length} tabs, ${viewers.length} viewers -> ${ids.join(", ")}`);
    // Two tab types since the agent-open delta: the browser and the hidden
    // structure tab an agent-opened database entry lands in.
    expect(tabs.map((tab) => tab.id).sort()).toEqual(
      [`${ourPkg.name}:browser`, `${ourPkg.name}:structure`].sort(),
    );
    const structure = tabs.find((tab) => tab.id === `${ourPkg.name}:structure`)!;
    expect(structure.hidden).toBe(true);
    expect(typeof structure.createTab).toBe("function");
    expect(ids).toContain(`${ourPkg.name}:pdb`);
    expect(ids).toContain(`${ourPkg.name}:gzip`);
    expect(new Set(ids).size).toBe(ids.length);
    // The built artifact must carry the whole format table, not a subset.
    const claimed = new Set(viewers.flatMap((descriptor) => [...(descriptor.exts ?? [])]));
    const required = BIO_EXTENSIONS.filter((ext) => !ext.endsWith(".gz"));
    console.log(`[C2] built apply() covers ${required.filter((ext) => claimed.has(ext)).length}/${required.length} non-gz extensions`);
    expect(required.filter((ext) => !claimed.has(ext))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C3 — bundle purity: only shell-resolvable specifiers
// ---------------------------------------------------------------------------

/**
 * Exact static extraction: parse the bundle with the TypeScript compiler and
 * walk the AST for `require(<string literal>)` calls.
 *
 * This is the primary static leg. A real parser cannot produce a false negative
 * (an earlier hand-rolled tokenizer did: its regex-vs-division heuristic
 * mis-read `/` division operators in minified Mol* as regex starts and skipped
 * the span containing `require("react-dom")`). `parseErrors === 0` additionally
 * proves the emitted artifact is syntactically valid JavaScript.
 */
function scanRequireSitesAst(src: string): { literals: string[]; nonLiteral: string[]; parseErrors: number } {
  const source = createSourceFile("lib/client.js", src, ScriptTarget.Latest, true, ScriptKind.JS);
  const literals: string[] = [];
  const nonLiteral: string[] = [];
  const visit = (node: Node): void => {
    if (isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === "require") {
      const argument = node.arguments[0];
      if (argument !== undefined && isStringLiteralLike(argument)) literals.push(argument.text);
      else nonLiteral.push(node.getText(source).replace(/\s+/g, " ").slice(0, 80));
    }
    forEachChild(node, visit);
  };
  visit(source);
  // `parseDiagnostics` is internal to the compiler's public `SourceFile` type.
  const parseErrors = (source as unknown as { parseDiagnostics: readonly unknown[] }).parseDiagnostics.length;
  return { literals, nonLiteral, parseErrors };
}

/**
 * Collect every `require("...")` TEXT occurrence in the bundle.
 *
 * Deliberately NOT a lexer. An earlier hand-rolled tokenizer mis-detected regex
 * literals in minified Mol* (division operators such as `a/Be*2/...` read as
 * regex starts) and silently swallowed the span containing
 * `require("react-dom")` — a FALSE NEGATIVE that made the purity check pass for
 * the wrong reason. That failure mode is worse than over-reporting, so this scan
 * is intentionally fail-closed:
 *
 * - it reports every literal occurrence, INCLUDING any that appear inside a
 *   string literal or a comment (minified bundles have no comments, and a
 *   decoy inside a string is vanishingly unlikely);
 * - over-reporting surfaces as a specifier outside the shell allowlist, which
 *   FAILS the test and gets investigated. Under-reporting would silently pass.
 *
 * The runtime leg below (`dynamic`) cross-validates it in the other direction.
 */
function scanRequireSpecifiers(src: string): { literals: string[]; nonLiteral: string[] } {
  const literals = [...src.matchAll(/\brequire\(\s*(["'])((?:[^"'\\\n]|\\.)*)\1\s*\)/g)].map((m) => m[2]);
  const nonLiteral = [...src.matchAll(/\brequire\s*\(/g)]
    .filter((m) => !/^\s*(["'])/.test(src.slice(m.index! + m[0].length)))
    .map((m) => src.slice(Math.max(0, m.index! - 60), m.index! + 60).replace(/\s+/g, " "));
  return { literals, nonLiteral };
}

describe("C3 client bundle purity", () => {
  test("the require scanner is not vacuous: it finds known sites and ignores decoys", () => {
    // Guards against the failure mode where the scanner silently returns an
    // empty set and every purity assertion passes for the wrong reason.
    const fixture = [
      'var a = require("react");',
      'var b = require("react/jsx-runtime");',
      "// require(\"commented-out\")",
      "/* require(\"block-commented\") */",
      'var s = "require(\\"in-a-string\\")";',
      "var t = 'require(\"in-a-single-quoted-string\")';",
      "var r = /require\\(\"in-a-regex\"\\)/;",
      'var q = /["\']/;',
      'var d = 6 / 2;',
      'var e = require(someVariable);',
    ].join("\n");
    // Exact leg (TypeScript parser): real call sites only, decoys excluded.
    const ast = scanRequireSitesAst(fixture);
    expect(ast.parseErrors).toBe(0);
    expect([...new Set(ast.literals)].sort()).toEqual(["react", "react/jsx-runtime"]);
    expect(ast.nonLiteral).toHaveLength(1);
    expect(ast.nonLiteral[0]).toContain("someVariable");

    // Fail-closed leg (text scan): a superset of the exact leg — it also reports
    // decoys, so it can over-report but never hide a specifier.
    const { literals, nonLiteral } = scanRequireSpecifiers(fixture);
    expect(literals).toContain("react");
    expect(literals).toContain("react/jsx-runtime");
    expect(literals).toContain("commented-out");
    expect(literals).toContain("block-commented");
    expect(nonLiteral.some((site) => site.includes("someVariable"))).toBe(true);
    console.log(
      `[C3] fixture: ast=${ast.literals.length} exact, text=${literals.length} incl. decoys, nonLiteral(ast)=${ast.nonLiteral.length}`,
    );
  });

  test("every real require() call site in the bundle uses a shell-resolvable specifier", () => {
    const src = readArtifact(clientHalf);

    // Primary static leg: exact AST extraction.
    const ast = scanRequireSitesAst(src);
    console.log(`[C3] AST parse diagnostics: ${ast.parseErrors}`);
    expect(ast.parseErrors).toBe(0);
    expect(ast.nonLiteral).toEqual([]);
    const unique = [...new Set(ast.literals)].sort();
    console.log(`[C3] require literals (AST): ${unique.join(", ") || "(none)"}`);

    // Secondary static leg: the fail-closed text scan must not miss any site the
    // parser found (a text scan that under-reports is how the earlier false
    // negative slipped through).
    const text = scanRequireSpecifiers(src);
    expect(unique.filter((spec) => !text.literals.includes(spec))).toEqual([]);

    const offenders = unique.filter((spec) => !SHELL_RESOLVABLE_SPECIFIERS.includes(spec));
    expect(offenders).toEqual([]);

    // Runtime leg, cross-validated in both directions: the factory must not
    // require anything the static scan missed, and no static literal may be dead.
    const dynamic = [...new Set(materializeBundle().required)].sort();
    console.log(`[C3] runtime-required specifiers: ${dynamic.join(", ") || "(none)"}`);
    expect(dynamic.length).toBeGreaterThan(0);
    expect(unique.filter((spec) => !dynamic.includes(spec))).toEqual([]);
    expect(dynamic.filter((spec) => !unique.includes(spec))).toEqual([]);
    // The three specifiers this bundle is expected to need, named explicitly so
    // a regression that drops one is visible rather than silently "equal".
    expect(unique).toEqual(["react", "react-dom", "react/jsx-runtime"]);
    // Cross-plugin value imports are a build error in DSH; be explicit about it.
    for (const spec of unique) {
      expect(spec.startsWith("@dsh-external/")).toBe(false);
      expect(spec.startsWith("@deepseek-ai/")).toBe(false);
    }
  });

  test("the bundle ships no separate chunk/asset requires", () => {
    const src = readArtifact(clientHalf);
    const { literals } = scanRequireSitesAst(src);
    const chunkish = [...new Set(literals)].filter((s) => /^[./]/.test(s));
    console.log(`[C3] relative/chunk requires: ${chunkish.join(", ") || "(none)"}`);
    expect(chunkish).toEqual([]);
  });

  test("dynamic import()/chunk loaders are absent (nothing loads at materialization)", () => {
    const src = readArtifact(clientHalf);
    const dynamicImports = [...src.matchAll(/\bimport\s*\(/g)].length;
    console.log(`[C3] dynamic import() occurrences: ${dynamicImports}`);
    expect(src).not.toContain("__dshChunks__");
  });

  test("CSS is inlined, not fetched through a separate asset route", () => {
    const src = readArtifact(clientHalf);
    expect(src).not.toMatch(/\.css["'`]/);
    expect(src).not.toMatch(/\/plugins\/[^"']*\.css/);
  });
});

// ---------------------------------------------------------------------------
// DOM shim for materialization
// ---------------------------------------------------------------------------

/**
 * Minimal browser-global shim so Mol*'s module bodies can be evaluated in Bun.
 * It is intentionally shallow: it exists to get past import-time feature
 * detection, not to run a viewer. Restored by the caller.
 */
function installDomShim(): { restore: () => void } {
  const target = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  const define = (key: string, value: unknown): void => {
    saved.set(key, target[key]);
    target[key] = value;
  };

  const element = (): Record<string, unknown> => {
    const el: Record<string, unknown> = {
      style: {},
      dataset: {},
      classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
      children: [] as unknown[],
      childNodes: [] as unknown[],
      appendChild: (c: unknown) => c,
      removeChild: (c: unknown) => c,
      insertBefore: (c: unknown) => c,
      setAttribute: () => {},
      removeAttribute: () => {},
      getAttribute: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
      append: () => {},
      remove: () => {},
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }),
      getContext: () => null,
      toDataURL: () => "",
      focus: () => {},
      click: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    el.firstChild = null;
    el.parentNode = null;
    return el;
  };

  const head = element();
  const body = element();
  const doc = {
    createElement: () => element(),
    createElementNS: () => element(),
    createTextNode: () => element(),
    createDocumentFragment: () => element(),
    head,
    body,
    documentElement: element(),
    fonts: { add: () => {}, ready: Promise.resolve() },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
    visibilityState: "visible",
    createRange: () => ({ selectNodeContents: () => {}, setStart: () => {}, setEnd: () => {}, getBoundingClientRect: () => ({}) }),
  };

  const win = {
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(0), 0) as unknown as number,
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    document: doc,
    location: { href: "http://localhost/", protocol: "http:", host: "localhost", search: "" },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    performance: globalThis.performance,
  };

  define("window", win);
  define("self", win);
  define("document", doc);
  define("navigator", { userAgent: "bun-test", platform: "test", clipboard: { writeText: async () => {} } });
  define("devicePixelRatio", 1);
  define("matchMedia", win.matchMedia);
  define("requestAnimationFrame", win.requestAnimationFrame);
  define("cancelAnimationFrame", win.cancelAnimationFrame);
  define("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  define("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  define("MutationObserver", class { observe() {} disconnect() {} takeRecords() { return []; } });
  define("HTMLElement", class {});
  define("HTMLCanvasElement", class {});
  define("Element", class {});
  define("Node", class {});
  define("getComputedStyle", win.getComputedStyle);
  define("localStorage", win.localStorage);

  return {
    restore: () => {
      for (const [key, value] of saved) {
        if (value === undefined) delete target[key];
        else target[key] = value;
      }
    },
  };
}

// Keep an explicit record of the rebuild in the test log.
afterAll(() => {
  if (build.rebuilt) console.log(`[C1] rebuilt lib/ during this test run (${build.command})`);
});

// mkdirSync is imported for symmetry with build.ts; fail loudly if lib/ vanished.
test("lib/ directory exists", () => {
  expect(existsSync(libDir)).toBe(true);
  mkdirSync(libDir, { recursive: true });
});
