/**
 * C4/C5 — registration wiring and graceful degradation, exercised against the
 * REAL client source (imported through Bun's TS/TSX support), not the built
 * bundle. The fake `ctx` records every `registerTab` / `registerFileViewer`
 * call, so the assertions below are made on the exact descriptor objects the
 * plugin hands to better-sidebar.
 *
 * The host-owned extension set and the host's extension matcher are extracted
 * VERBATIM from the installed `dsh-better-sidebar/lib/client.js` (0.28.2), so
 * this file fails if the installed package drifts from what the plugin assumes.
 *
 * What this file does NOT prove: that a real cordis fiber activates the plugin,
 * that the components render, or that the host's own file-open funnel reaches
 * the viewer (that last one is covered for the `gz` case by the explicit
 * ADVERSARIAL block at the bottom, which mirrors the shipped matcher).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BIO_EXTENSIONS } from "../src/shared/formats";

const root = join(import.meta.dir, "..");
const shippedClientJs = join(root, "node_modules/dsh-better-sidebar/lib/client.js");
const serviceDts = join(root, "node_modules/dsh-better-sidebar/lib/types/client/service.d.ts");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string };

/**
 * Built-in descriptor ids that must not be re-registered.
 *
 * Tabs come from guide §4.4. Viewers are extracted VERBATIM from the shipped
 * `builtinViewers()` below — the shipped 0.28.2 registers four (markdown, html,
 * jsonl, code) while guide §5.4 still documents three, so this list is derived
 * from the artifact and only cross-checked against the guide.
 */
const BUILTIN_TAB_IDS = ["editor", "git", "subagent", "sidechat", "diff", "terminal-bottom"];
const BUILTIN_VIEWER_IDS = ["markdown", "html", "jsonl", "code"];

/** Legal `fetchStrategy` values, mirrored from the installed `FileFetchStrategy` union. */
const FETCH_STRATEGIES = ["none", "fsRead", "mediaUrl", "custom", "binary-download"];

// ---------------------------------------------------------------------------
// Verbatim extraction from the shipped better-sidebar bundle
// ---------------------------------------------------------------------------

const shipped = readFileSync(shippedClientJs, "utf8");

/** The host's own extension rule, run verbatim: it takes the LAST dot segment. */
const hostExtOf = ((): ((path: string) => string) => {
  const match = /function extOf\(path\)\s*\{[\s\S]*?\n\t\t\}/.exec(shipped);
  if (!match) throw new Error("installed dsh-better-sidebar no longer ships extOf()");
  return new Function(`${match[0]}; return extOf;`)() as (path: string) => string;
})();

/** The extensions better-sidebar hands to DSH's own document preview. */
const HOST_OWNED_EXTS = ((): string[] => {
  const match = /const HOST_OWNED_EXTS = [^=]*?new Set\(\[([\s\S]*?)\]\)/.exec(shipped);
  if (!match) throw new Error("installed dsh-better-sidebar no longer ships HOST_OWNED_EXTS");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
})();

/**
 * Extract a top-level `const NAME = (...) => { ... }` from shipped JS by
 * brace-matching (skipping strings and comments). Used to lift the host's real
 * matching algorithm out of the installed bundle instead of paraphrasing it.
 */
function extractArrowFunction(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = `);
  if (start === -1) throw new Error(`installed dsh-better-sidebar no longer defines ${name}`);
  const bodyStart = src.indexOf("{", src.indexOf("=>", start));
  if (bodyStart === -1) throw new Error(`${name}: no function body in the shipped bundle`);
  let depth = 0;
  let i = bodyStart;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < src.length) {
        if (src[i] === "\\") i += 2;
        else if (src[i] === quote) {
          i += 1;
          break;
        } else i += 1;
      }
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
    i += 1;
  }
  return src.slice(start, i);
}

/** The host's built-in viewer registry, read verbatim out of `builtinViewers()`. */
const BUILTIN_VIEWERS = ((): Descriptor[] => {
  const region = shipped.slice(shipped.indexOf("function builtinViewers()"));
  if (region.length === 0) throw new Error("installed dsh-better-sidebar no longer ships builtinViewers()");
  const ids = [...region.matchAll(/\bid:\s*"([a-z0-9_-]+)",\s*\n\s*title:/g)];
  return ids.map((match, index) => {
    const segment = region.slice(match.index!, index + 1 < ids.length ? ids[index + 1].index! : match.index! + 900);
    const exts = /exts:\s*\[([^\]]*)\]/.exec(segment);
    const priority = /priority:\s*(-?\d+)/.exec(segment);
    return {
      id: match[1],
      exts: exts ? [...exts[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [],
      priority: priority ? Number(priority[1]) : 0,
    };
  });
})();

/** The host's real `matchFileViewer`, bound to a registry we control. */
function makeHostMatcher(descriptors: Descriptor[]): (path: string, head?: Uint8Array) => Descriptor | undefined {
  const matcherSrc = extractArrowFunction(shipped, "matchFileViewer");
  const viewers = new Map(descriptors.map((d) => [d.id, d]));
  const isViewerEnabled = (): boolean => true;
  return new Function(
    "extOf",
    "viewers",
    "isViewerEnabled",
    `${matcherSrc}; return matchFileViewer;`,
  )(hostExtOf, viewers, isViewerEnabled) as (path: string, head?: Uint8Array) => Descriptor | undefined;
}

/** Top-level field names declared by an interface in the installed type surface. */
function declaredFields(interfaceName: string): string[] {
  const dts = readFileSync(serviceDts, "utf8");
  const start = dts.indexOf(`export interface ${interfaceName} {`);
  if (start === -1) throw new Error(`installed service.d.ts no longer declares ${interfaceName}`);
  const body = dts.slice(start + `export interface ${interfaceName} {`.length);
  return [...body.slice(0, body.indexOf("\n}")).matchAll(/^ {4}([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// Fake ctx
// ---------------------------------------------------------------------------

interface Descriptor {
  id: string;
  exts?: readonly string[];
  [key: string]: unknown;
}

interface Recorder {
  ctx: unknown;
  tabs: Descriptor[];
  viewers: Descriptor[];
  disposers: Array<() => void>;
  /** Live count: the fake ctx increments it after this object is built. */
  readonly effectCalls: number;
  registrationsOutsideEffect: string[];
  sidebarCalls: string[];
  injectCalls: Array<readonly string[]>;
  /** Runs the `ctx.inject` callback as if the service had just become available. */
  provideService: () => void;
}

/**
 * A fake client context modelling the installed cordis 4.0.5 semantics of
 * `ctx.inject(deps, callback)` — "run a callback once the requested services are
 * available" (node_modules/@deepseek-ai/cordis/lib/types/registry.d.ts:111) —
 * and `ctx.effect(body, label?)`.
 *
 * Unknown property reads THROW (instead of silently returning undefined) so the
 * test surfaces every part of the real Context the plugin actually touches.
 */
function makeCtx(options: { withSidebar: boolean }): Recorder {
  const tabs: Descriptor[] = [];
  const viewers: Descriptor[] = [];
  const disposers: Array<() => void> = [];
  const registrationsOutsideEffect: string[] = [];
  const sidebarCalls: string[] = [];
  const injectCalls: Array<readonly string[]> = [];
  let effectCalls = 0;
  let insideEffect = false;

  const sidebar = {
    version: "0.28.2",
    features: ["hostRouteUrl", "openFile"],
    registerTab(descriptor: Descriptor): () => void {
      if (!insideEffect) registrationsOutsideEffect.push(`registerTab(${descriptor.id})`);
      tabs.push(descriptor);
      return () => {
        const at = tabs.indexOf(descriptor);
        if (at >= 0) tabs.splice(at, 1);
      };
    },
    registerFileViewer(descriptor: Descriptor): () => void {
      if (!insideEffect) registrationsOutsideEffect.push(`registerFileViewer(${descriptor.id})`);
      viewers.push(descriptor);
      return () => {
        const at = viewers.indexOf(descriptor);
        if (at >= 0) viewers.splice(at, 1);
      };
    },
    hostRouteUrl(path: string): string {
      sidebarCalls.push(`hostRouteUrl(${path})`);
      return `/sidebar/${path}`;
    },
    openFile(scope: unknown, path: string, title?: string): void {
      sidebarCalls.push(`openFile(${path}, ${title ?? ""})`);
    },
    matchFileViewer: () => undefined,
  };

  const effect = (callback: () => unknown, _label?: string): (() => void) => {
    effectCalls += 1;
    insideEffect = true;
    let result: unknown;
    try {
      result = callback();
    } finally {
      insideEffect = false;
    }
    const disposer = typeof result === "function" ? (result as () => void) : () => {};
    disposers.push(disposer);
    return disposer;
  };

  /** The child-fiber context cordis hands to an `inject` callback. */
  const makeScoped = (): Record<string, unknown> => ({
    betterSidebar: sidebar,
    get: (name: string) => (name === "betterSidebar" ? sidebar : undefined),
    effect,
    on: () => () => {},
    logger: Object.assign(() => {}, { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  });

  const injectCallbacks: Array<(scoped: unknown) => void> = [];
  const inject = (deps: readonly string[], callback: (scoped: unknown) => void): (() => void) => {
    injectCalls.push(deps);
    injectCallbacks.push(callback);
    if (options.withSidebar) callback(makeScoped());
    return () => {};
  };

  const base: Record<string, unknown> = {
    betterSidebar: options.withSidebar ? sidebar : undefined,
    get(name: string): unknown {
      return options.withSidebar && name === "betterSidebar" ? sidebar : undefined;
    },
    effect,
    inject,
    on: () => () => {},
    logger: Object.assign(() => {}, { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
    scope: {},
  };

  const strict = (target: Record<string, unknown>): unknown =>
    new Proxy(target, {
      get(t, property, receiver) {
        if (typeof property === "symbol") return Reflect.get(t, property, receiver);
        if (property in t) return Reflect.get(t, property, receiver);
        throw new Error(`fake ctx: unhandled Context property "${property}"`);
      },
    });

  return {
    ctx: strict(base),
    tabs,
    viewers,
    disposers,
    get effectCalls() {
      return effectCalls;
    },
    registrationsOutsideEffect,
    sidebarCalls,
    injectCalls,
    provideService: () => {
      // Models cordis delivering the service to the waiting child fiber.
      for (const callback of injectCallbacks) callback(makeScoped());
    },
  };
}

// ---------------------------------------------------------------------------
// Client entry loading
// ---------------------------------------------------------------------------

const ENTRY_CANDIDATES = ["src/client/index.tsx", "src/client/index.ts"];

interface ClientModule {
  apply?: (ctx: unknown) => unknown;
  inject?: unknown;
}

let entryPath: string;
let clientModule: ClientModule;

beforeAll(async () => {
  const found = ENTRY_CANDIDATES.map((p) => join(root, p)).find((p) => existsSync(p));
  if (!found) throw new Error(`client entry not found; looked for ${ENTRY_CANDIDATES.join(", ")}`);
  entryPath = found;
  installDomShim();
  clientModule = (await import(found)) as ClientModule;
});

describe("C4 registration wiring (real client source, fake ctx)", () => {
  test("client entry exports apply() and waits for betterSidebar through ctx.inject", () => {
    console.log(`[C4] client entry: ${entryPath.replace(`${root}/`, "")}`);
    expect(typeof clientModule.apply).toBe("function");
    // The exported `inject` must be an array (cordis plugin contract). An empty
    // array is the optional-peer shape; a hard dependency would keep the plugin
    // pending forever on a host without better-sidebar.
    expect(Array.isArray(clientModule.inject)).toBe(true);
    console.log(`[C4] exported inject: ${JSON.stringify(clientModule.inject)}`);

    const rec = makeCtx({ withSidebar: false });
    (clientModule.apply as (ctx: unknown) => void)(rec.ctx);
    console.log(`[C4] ctx.inject calls: ${JSON.stringify(rec.injectCalls)}`);
    expect(rec.injectCalls).toEqual([["betterSidebar"]]);
  });

  test("apply(ctx) registers exactly one tab", () => {
    const rec = makeCtx({ withSidebar: true });
    (clientModule.apply as (ctx: unknown) => void)(rec.ctx);
    console.log(`[C4] tabs: ${rec.tabs.map((t) => t.id).join(", ")}`);
    expect(rec.tabs).toHaveLength(1);
    expect(rec.viewers.length).toBeGreaterThan(0);
  });

  test("every non-gz bio extension is claimed by at least one viewer", () => {
    const rec = makeCtx({ withSidebar: true });
    (clientModule.apply as (ctx: unknown) => void)(rec.ctx);
    const claimed = new Set(rec.viewers.flatMap((v) => [...(v.exts ?? [])]));
    const required = BIO_EXTENSIONS.filter((ext) => !ext.endsWith(".gz"));
    const missing = required.filter((ext) => !claimed.has(ext));
    console.log(`[C4] claimed exts: ${[...claimed].sort().join(" ")}`);
    console.log(`[C4] required non-gz exts: ${required.join(" ")}`);
    if (missing.length > 0) console.log(`[C4] MISSING: ${missing.join(" ")}`);
    expect(missing).toEqual([]);
  });

  test("descriptor ids are namespaced, unique and non-empty", () => {
    const rec = makeCtx({ withSidebar: true });
    (clientModule.apply as (ctx: unknown) => void)(rec.ctx);
    const ids = [...rec.tabs, ...rec.viewers].map((d) => d.id);
    console.log(`[C4] descriptor ids: ${ids.join(", ")}`);
    for (const id of ids) {
      expect(typeof id).toBe("string");
      expect(id.startsWith(`${pkg.name}:`)).toBe(true);
      expect(id.length).toBeGreaterThan(pkg.name.length + 1);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("no descriptor id collides with a better-sidebar built-in", () => {
    const rec = makeCtx({ withSidebar: true });
    (clientModule.apply as (ctx: unknown) => void)(rec.ctx);
    const reserved = [...BUILTIN_TAB_IDS, ...BUILTIN_VIEWER_IDS];
    const collisions = [...rec.tabs, ...rec.viewers].map((d) => d.id).filter((id) => reserved.includes(id));
    expect(collisions).toEqual([]);
  });

  test("the reserved viewer id list matches what the shipped bundle registers (drift guard)", () => {
    const shippedIds = BUILTIN_VIEWERS.map((v) => v.id).sort();
    console.log(`[C4] shipped built-in viewers: ${shippedIds.join(", ")} (guide §5.4 documents three: markdown, html, code)`);
    expect(shippedIds).toEqual([...BUILTIN_VIEWER_IDS].sort());
  });

  test("viewer exts never intersect the host-owned hand-over set", () => {
    const rec = makeCtx({ withSidebar: true });
    (clientModule.apply as (ctx: unknown) => void)(rec.ctx);
    const used = [...new Set(rec.viewers.flatMap((v) => [...(v.exts ?? [])]))];
    const collisions = used.filter((ext) => HOST_OWNED_EXTS.includes(ext));
    console.log(`[C4] host-owned exts (verbatim from installed bundle): ${HOST_OWNED_EXTS.join(" ")}`);
    expect(collisions).toEqual([]);
  });

  test("no viewer is a blind catch-all and every viewer has a component", () => {
    const rec = makeCtx({ withSidebar: true });
    (clientModule.apply as (ctx: unknown) => void)(rec.ctx);
    for (const viewer of rec.viewers) {
      // `exts: []` without `detect` claims EVERY file in the workspace (guide §5.4).
      if ((viewer.exts ?? []).length === 0) expect(typeof viewer.detect).toBe("function");
      expect(typeof viewer.component).toBe("function");
    }
  });

  test("every descriptor field is declared by the installed type surface", () => {
    const rec = makeCtx({ withSidebar: true });
    (clientModule.apply as (ctx: unknown) => void)(rec.ctx);
    const tabFields = declaredFields("TabDescriptor");
    const viewerFields = declaredFields("FileViewerDescriptor");
    for (const tab of rec.tabs) {
      expect(Object.keys(tab).filter((k) => !tabFields.includes(k))).toEqual([]);
    }
    for (const viewer of rec.viewers) {
      expect(Object.keys(viewer).filter((k) => !viewerFields.includes(k))).toEqual([]);
      expect(FETCH_STRATEGIES).toContain(viewer.fetchStrategy as string);
      expect(Array.isArray(viewer.exts)).toBe(true);
    }
  });

  test("registrations are wrapped in ctx.effect and are disposable", () => {
    const rec = makeCtx({ withSidebar: true });
    (clientModule.apply as (ctx: unknown) => void)(rec.ctx);
    // Every registration must happen inside an effect, or HMR leaves it behind
    // and the next activation throws "already registered" (guide §9).
    expect(rec.registrationsOutsideEffect).toEqual([]);
    expect(rec.effectCalls).toBeGreaterThanOrEqual(rec.tabs.length + rec.viewers.length);
    const before = rec.tabs.length + rec.viewers.length;
    for (const dispose of rec.disposers) dispose();
    expect(rec.tabs.length + rec.viewers.length).toBe(0);
    expect(before).toBeGreaterThan(0);
  });
});

describe("C5 graceful degradation without betterSidebar", () => {
  test("apply(ctx) with no betterSidebar service neither throws nor registers", () => {
    const rec = makeCtx({ withSidebar: false });
    expect(() => (clientModule.apply as (ctx: unknown) => void)(rec.ctx)).not.toThrow();
    expect(rec.tabs).toEqual([]);
    expect(rec.viewers).toEqual([]);
    expect(rec.sidebarCalls).toEqual([]);
  });

  test("the service arriving late still registers the full set (order independence)", () => {
    const rec = makeCtx({ withSidebar: false });
    (clientModule.apply as (ctx: unknown) => void)(rec.ctx);
    expect(rec.viewers).toEqual([]);
    rec.provideService();
    console.log(`[C5] after late service: ${rec.viewers.length} viewers, ${rec.tabs.length} tab`);
    expect(rec.tabs).toHaveLength(1);
    expect(rec.viewers.length).toBeGreaterThan(0);
    expect(rec.registrationsOutsideEffect).toEqual([]);
  });

  test("disposing every effect unregisters everything (HMR safety)", () => {
    const rec = makeCtx({ withSidebar: true });
    (clientModule.apply as (ctx: unknown) => void)(rec.ctx);
    const ids = [...rec.tabs, ...rec.viewers].map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const dispose of rec.disposers) dispose();
    console.log(`[C5] disposed ${rec.disposers.length} effects; remaining registrations: ${rec.tabs.length + rec.viewers.length}`);
    expect(rec.tabs.length + rec.viewers.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL — gz routing through the SHIPPED matcher
//
// The matcher below is the host's real `matchFileViewer`, extracted verbatim
// from the installed bundle and bound to a registry of the built-in viewers
// (also extracted verbatim from `builtinViewers()`) plus the descriptors the
// plugin actually registers. Only the registry contents and the enabled
// predicate are ours; the matching algorithm is the shipped one.
// ---------------------------------------------------------------------------

describe("ADVERSARIAL gz routing (drives the shipped matchFileViewer)", () => {
  const registerAndMatch = (path: string, head?: Uint8Array): { matched?: Descriptor; registry: Descriptor[] } => {
    const rec = makeCtx({ withSidebar: true });
    (clientModule.apply as (ctx: unknown) => void)(rec.ctx);
    const registry = [...BUILTIN_VIEWERS, ...rec.viewers];
    return { matched: makeHostMatcher(registry)(path, head), registry };
  };

  test("baseline: the shipped matcher maps a gz name to ext 'gz' and a plain name to its own ext", () => {
    expect(hostExtOf("1abc.pdb")).toBe("pdb");
    expect(hostExtOf("1abc.pdb.gz")).toBe("gz");
    console.log(`[gz] built-in registry extracted verbatim: ${BUILTIN_VIEWERS.map((v) => `${v.id}(${v.priority})`).join(", ")}`);
  });

  test("(a) matchFileViewer('1abc.pdb') returns the plugin's pdb viewer", () => {
    const { matched } = registerAndMatch("1abc.pdb");
    console.log(`[gz] (a) 1abc.pdb -> ${matched?.id}`);
    expect(matched?.id).toBe(`${pkg.name}:pdb`);
  });

  test("(b) matchFileViewer('1abc.pdb.gz') with no head does NOT return a plugin viewer", () => {
    const { matched } = registerAndMatch("1abc.pdb.gz");
    console.log(`[gz] (b) 1abc.pdb.gz (no head) -> ${matched?.id ?? "(no match)"}`);
    expect(matched?.id.startsWith(`${pkg.name}:`) ?? false).toBe(false);
  });

  test("(c) matchFileViewer('1abc.pdb.gz', gzip head) returns the plugin's gzip viewer", () => {
    const head = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const { matched } = registerAndMatch("1abc.pdb.gz", head);
    console.log(`[gz] (c) 1abc.pdb.gz (gzip head) -> ${matched?.id}`);
    expect(matched?.id).toBe(`${pkg.name}:gzip`);
  });

  test("(d) matchFileViewer('notes.csv.gz', gzip head) does NOT return a plugin viewer", () => {
    const head = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const { matched } = registerAndMatch("notes.csv.gz", head);
    console.log(`[gz] (d) notes.csv.gz (gzip head) -> ${matched?.id ?? "(no match)"}`);
    expect(matched?.id.startsWith(`${pkg.name}:`) ?? false).toBe(false);
  });

  test("(e) an uncompressed bio file still reaches the plugin viewer, not the gzip sniffer", () => {
    const { matched } = registerAndMatch("1abc.cif");
    console.log(`[gz] (e) 1abc.cif -> ${matched?.id}`);
    expect(matched?.id).toBe(`${pkg.name}:mmcif`);
  });

  test("no descriptor exts entry contains a dot (the host only ever sees one dot segment)", () => {
    const rec = makeCtx({ withSidebar: true });
    (clientModule.apply as (ctx: unknown) => void)(rec.ctx);
    const dotted = rec.viewers.flatMap((v) => (v.exts ?? []).filter((ext) => ext.includes(".")));
    expect(dotted).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DOM shim (duplicated from build.test.ts: a shared helper would live outside
// this task's write scope)
// ---------------------------------------------------------------------------

function installDomShim(): void {
  const target = globalThis as Record<string, unknown>;
  const element = (): Record<string, unknown> => ({
    style: {},
    dataset: {},
    classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
    children: [],
    childNodes: [],
    appendChild: (c: unknown) => c,
    removeChild: (c: unknown) => c,
    insertBefore: (c: unknown) => c,
    setAttribute: () => {},
    removeAttribute: () => {},
    getAttribute: () => null,
    hasAttribute: () => false,
    addEventListener: () => {},
    removeEventListener: () => {},
    append: () => {},
    remove: () => {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }),
    getContext: () => null,
    focus: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const doc = {
    createElement: () => element(),
    createElementNS: () => element(),
    createTextNode: () => element(),
    createDocumentFragment: () => element(),
    head: element(),
    body: element(),
    documentElement: { style: { colorScheme: "" }, hasAttribute: () => false },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
    visibilityState: "visible",
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
  };
  target.window = win;
  target.self = win;
  target.document = doc;
  target.navigator = { userAgent: "bun-test", platform: "test" };
  target.matchMedia = win.matchMedia;
  target.requestAnimationFrame = win.requestAnimationFrame;
  target.cancelAnimationFrame = win.cancelAnimationFrame;
  target.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  target.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  target.MutationObserver = class {
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  target.HTMLElement = class {};
  target.Element = class {};
  target.Node = class {};
}
