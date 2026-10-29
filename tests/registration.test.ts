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
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BIO_EXTENSIONS, BIO_FORMATS } from "../src/shared/formats";
import { OPEN_ROUTE, STRUCTURE_TAB_ID, startAgentOpens } from "../src/client/agent-opens";
import { pluginRouteUrl, transportBase } from "../src/client/transport";
import { loadIntoStudio } from "../src/client/load";
import { parseCmmMarkerSets } from "../src/client/cmm";

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
  /** Effect labels in registration order — how the poller effect is identified. */
  effectLabels: string[];
  registrationsOutsideEffect: string[];
  sidebarCalls: string[];
  injectCalls: Array<readonly string[]>;
  /** Runs the `ctx.inject` callback as if the service had just become available. */
  provideService: () => void;
}

/**
 * How the fake service exposes the `getSnapshot`/`subscribeState` pair that the
 * agent-open poller probes before starting.
 *
 * - `present` — both methods behave (the normal host).
 * - `absent` — neither exists (a better-sidebar older than the two methods).
 * - `getSnapshot-throws` / `subscribe-throws` — the method exists but explodes.
 * - `subscribe-returns-nonfunction` — the method returns something that is not
 *   the disposer its type promises.
 */
type AgentOpensMode =
  | "present"
  | "absent"
  | "getSnapshot-throws"
  | "subscribe-throws"
  | "subscribe-returns-nonfunction";

interface CtxOptions {
  withSidebar: boolean;
  agentOpens?: AgentOpensMode;
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
function makeCtx(options: CtxOptions): Recorder {
  const tabs: Descriptor[] = [];
  const viewers: Descriptor[] = [];
  const disposers: Array<() => void> = [];
  const registrationsOutsideEffect: string[] = [];
  const sidebarCalls: string[] = [];
  const injectCalls: Array<readonly string[]> = [];
  const effectLabels: string[] = [];
  let effectCalls = 0;
  let insideEffect = false;

  const sidebar: Record<string, unknown> = {
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
    openTab(seed: unknown, scope?: { sessionId?: string }): void {
      sidebarCalls.push(`openTab(${JSON.stringify(seed)}, ${scope?.sessionId ?? ""})`);
    },
    matchFileViewer: () => undefined,
  };

  const agentOpens = options.agentOpens ?? "present";
  if (options.withSidebar && agentOpens !== "absent") {
    switch (agentOpens) {
      case "getSnapshot-throws":
        sidebar["getSnapshot"] = () => {
          throw new Error("fake: getSnapshot exploded");
        };
        sidebar["subscribeState"] = () => () => {};
        break;
      case "subscribe-throws":
        sidebar["getSnapshot"] = () => ({ sessionId: "session-1" });
        sidebar["subscribeState"] = () => {
          throw new Error("fake: subscribeState exploded");
        };
        break;
      case "subscribe-returns-nonfunction":
        sidebar["getSnapshot"] = () => ({ sessionId: "session-1" });
        sidebar["subscribeState"] = () => undefined;
        break;
      default:
        sidebar["getSnapshot"] = () => ({ sessionId: "session-1" });
        sidebar["subscribeState"] = () => () => {};
    }
  }

  const effect = (callback: () => unknown, label?: string): (() => void) => {
    effectCalls += 1;
    effectLabels.push(label ?? "(unlabelled)");
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
    effectLabels,
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

/** Run `body` with `console.warn` captured (the plugin reports degradation there). */
function captureWarnings(body: () => void): string[] {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    body();
  } finally {
    console.warn = original;
  }
  return warnings;
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
  // `apply()` starts the agent-open poller on a capable service, and it uses
  // the global fetch. A promise that never settles parks the loop with no
  // timer and no socket, so an un-disposed poller cannot keep the process
  // alive or hit the network. Tests that exercise the loop pass their own
  // `fetchImpl`.
  savedFetch = globalThis.fetch;
  globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  clientModule = (await import(found)) as ClientModule;
});

let savedFetch: typeof fetch;

afterAll(() => {
  globalThis.fetch = savedFetch;
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

  test("apply(ctx) registers exactly the two expected tab types, with their shapes", () => {
    // The surface grew in the agent-open delta: `browser` (the workspace file
    // browser) plus `structure` (where an agent-opened database entry lands).
    // This asserts the SHAPE, not just the count — the two tabs are deliberately
    // different, and getting either wrong is a silent behavioural bug:
    //   - `structure` must be hidden (it is never opened from the + menu);
    //   - `structure` must declare `createTab`, because the native surface
    //     otherwise focuses an existing tab of the same type, so a second
    //     structure would REPLACE the first instead of opening beside it.
    const rec = makeCtx({ withSidebar: true });
    (clientModule.apply as (ctx: unknown) => void)(rec.ctx);
    console.log(`[C4] tabs: ${rec.tabs.map((t) => t.id).join(", ")}`);

    expect(rec.tabs.map((tab) => tab.id).sort()).toEqual(
      [`${pkg.name}:browser`, `${pkg.name}:structure`].sort(),
    );

    const browser = rec.tabs.find((tab) => tab.id === `${pkg.name}:browser`)!;
    expect(browser.hidden).toBeUndefined();
    expect(browser.single).toBe(true);
    expect(browser.order).toBe(45);
    expect(typeof browser.component).toBe("function");

    const structure = rec.tabs.find((tab) => tab.id === `${pkg.name}:structure`)!;
    expect(structure.hidden).toBe(true);
    expect(typeof structure.createTab).toBe("function");
    expect(typeof structure.component).toBe("function");

    // `createTab` must mint a distinct id per call, or two structures collide.
    const minted = [
      (structure.createTab as () => { tab: { id: string } })(),
      (structure.createTab as () => { tab: { id: string } })(),
    ].map((result) => result.tab.id);
    console.log(`[C4] structure createTab minted: ${minted.join(", ")}`);
    expect(minted[0]).not.toBe(minted[1]);
    expect(minted.every((id) => id.startsWith(`${pkg.name}:structure`))).toBe(true);

    expect(rec.viewers).toHaveLength(11);
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
    console.log(`[C5] after late service: ${rec.viewers.length} viewers, ${rec.tabs.length} tabs`);
    expect(rec.tabs.map((tab) => tab.id).sort()).toEqual(
      [`${pkg.name}:browser`, `${pkg.name}:structure`].sort(),
    );
    expect(rec.viewers).toHaveLength(11);
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
// ADVERSARIAL — the agent-open registration guard
//
// `registerAll` capability-checks the service before starting the poller,
// because `apply()` throwing there would take the WHOLE plugin down — including
// the viewers registered before the check. Both branches are asserted, and then
// the guard is attacked with a service whose methods misbehave.
// ---------------------------------------------------------------------------

describe("ADVERSARIAL agent-open registration guard", () => {
  const POLLER_EFFECT = "dsh-bioviewer: agent opens";

  test("(a) a service without getSnapshot/subscribeState still registers everything and does not throw", () => {
    const rec = makeCtx({ withSidebar: true, agentOpens: "absent" });
    let warnings: string[] = [];
    expect(() => {
      warnings = captureWarnings(() => (clientModule.apply as (ctx: unknown) => void)(rec.ctx));
    }).not.toThrow();

    console.log(`[C4] no-snapshot host: ${rec.tabs.length} tabs, ${rec.viewers.length} viewers, effects=${JSON.stringify(rec.effectLabels)}`);
    // The whole point of the guard: registration must survive the missing capability.
    expect(rec.tabs.map((tab) => tab.id).sort()).toEqual(
      [`${pkg.name}:browser`, `${pkg.name}:structure`].sort(),
    );
    expect(rec.viewers).toHaveLength(11);
    expect(rec.effectLabels).not.toContain(POLLER_EFFECT);
    // Degrading silently would be worse than not degrading at all.
    expect(warnings.some((line) => line.includes("agent-triggered opens are disabled"))).toBe(true);
  });

  test("(b) a capable service starts the poller as one extra effect and does not throw", () => {
    const rec = makeCtx({ withSidebar: true, agentOpens: "present" });
    expect(() => (clientModule.apply as (ctx: unknown) => void)(rec.ctx)).not.toThrow();
    console.log(`[C4] capable host effects: ${JSON.stringify(rec.effectLabels)}`);
    expect(rec.effectLabels).toContain(POLLER_EFFECT);
    expect(rec.tabs).toHaveLength(2);
    expect(rec.viewers).toHaveLength(11);
    // The poller effect must be disposable like every other effect.
    for (const dispose of rec.disposers) dispose();
    expect(rec.tabs.length + rec.viewers.length).toBe(0);
  });

  test("a getSnapshot that throws does not escape apply()", () => {
    const rec = makeCtx({ withSidebar: true, agentOpens: "getSnapshot-throws" });
    const warnings = captureWarnings(() => (clientModule.apply as (ctx: unknown) => void)(rec.ctx));
    console.log(`[adv] getSnapshot-throws: effects=${JSON.stringify(rec.effectLabels)}, warnings=${warnings.length}`);
    expect(rec.tabs).toHaveLength(2);
    expect(rec.viewers).toHaveLength(11);
    // The poller still starts (the capability exists); the throw is caught per call.
    expect(rec.effectLabels).toContain(POLLER_EFFECT);
    expect(rec.disposers.every((dispose) => typeof dispose === "function")).toBe(true);
    // This is the one mode that parks in the retry backoff rather than on the
    // transport, so its disposer is what stops the repeating timer.
    for (const dispose of rec.disposers) dispose();
  });

  test("a subscribeState that throws does not escape apply()", () => {
    const rec = makeCtx({ withSidebar: true, agentOpens: "subscribe-throws" });
    const warnings = captureWarnings(() => (clientModule.apply as (ctx: unknown) => void)(rec.ctx));
    console.log(`[adv] subscribe-throws: effects=${JSON.stringify(rec.effectLabels)}, warnings=${warnings.length}`);
    expect(rec.tabs).toHaveLength(2);
    expect(rec.viewers).toHaveLength(11);
    expect(rec.effectLabels).toContain(POLLER_EFFECT);
    // Whatever the loop did internally, `apply` returned a usable disposer set.
    for (const dispose of rec.disposers) dispose();
  });

  test("a subscribeState returning a non-function does not escape apply()", () => {
    // The declared contract is `subscribeState(listener): () => void`. A host
    // that returns something else is a contract violation — but `apply()` must
    // still survive it, and the failure must be reported rather than swallowed.
    const rec = makeCtx({ withSidebar: true, agentOpens: "subscribe-returns-nonfunction" });
    const warnings = captureWarnings(() => (clientModule.apply as (ctx: unknown) => void)(rec.ctx));
    console.log(`[adv] subscribe-nonfunction: effects=${JSON.stringify(rec.effectLabels)}, warnings=${warnings.length}`);
    expect(rec.tabs).toHaveLength(2);
    expect(rec.viewers).toHaveLength(11);

    // Disposing is where a non-function return used to bite: the loop stored
    // the return value as its unsubscribe handle and called it on teardown,
    // which threw `unsubscribe is not a function`. That was reported as F1 and
    // is fixed (the handle is held as `unknown` and guarded), so this now
    // asserts the fixed behaviour rather than recording it.
    const results = rec.disposers.map((dispose) => {
      try {
        dispose();
        return "ok";
      } catch (error) {
        return `threw: ${(error as Error).message}`;
      }
    });
    console.log(`[adv] dispose results: ${JSON.stringify(results)}`);
    expect(results.filter((result) => result !== "ok")).toEqual([]);
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
    // A base the poller can resolve its own route against. Without it every
    // loop started by `apply()` takes the transport-error backoff path and
    // leaves a repeating timer behind, which keeps the test process alive.
    baseURI: "http://127.0.0.1:9/",
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

// ---------------------------------------------------------------------------
// ADVERSARIAL — the agent-open poll floor
//
// The loop re-polls as soon as the host answers. The host normally holds a poll
// open for ~25 s, but nothing enforces that: a proxy that terminates the
// response early would turn the loop into a request storm. `minPollIntervalMs`
// is the floor that bounds the rate regardless of how fast the host answers.
// The test below asserts a CEILING on requests over a fixed window, and proves
// the floor is load-bearing with a differential against a zero floor.
// ---------------------------------------------------------------------------

/** A fetch that answers immediately with "nothing to push" — the hot-loop shape. */
function immediateEmptyAnswer(onCall: () => void): typeof fetch {
  return (async () => {
    onCall();
    // Yield a MACROtask: an answer that resolves in the microtask queue only
    // lets a zero-floor loop starve the `setTimeout` that ends the window.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return new Response(JSON.stringify({ ok: true, value: { request: null } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function runLoopFor(ms: number, options: { minPollIntervalMs: number }): Promise<number> {
  let attempts = 0;
  const stop = startAgentOpens({
    getSessionId: () => "session-1",
    subscribeSession: () => () => {},
    sink: { openFile: () => {}, openTab: () => {} },
    fetchImpl: immediateEmptyAnswer(() => {
      attempts += 1;
    }),
    routeUrl: () => "http://127.0.0.1:1/bioviewer/open",
    retryDelayMs: 5,
    minPollIntervalMs: options.minPollIntervalMs,
    onError: () => {},
  });
  return new Promise((resolve) => {
    setTimeout(() => {
      stop();
      resolve(attempts);
    }, ms);
  });
}

describe("ADVERSARIAL agent-open poll floor", () => {
  test("with a 10 ms floor, a 150 ms window stays under a request ceiling", async () => {
    const attempts = await runLoopFor(150, { minPollIntervalMs: 10 });
    // Theoretical maximum with an instant answer is ~15; assert a real ceiling
    // rather than "it did not hang".
    console.log(`[floor] 150 ms at floor=10 ms -> ${attempts} requests`);
    expect(attempts).toBeGreaterThanOrEqual(2); // non-vacuous: the loop ran
    expect(attempts).toBeLessThanOrEqual(20);
  });

  test("the floor is load-bearing: a zero floor produces far more requests in the same window", async () => {
    const [floored, unfloored] = [await runLoopFor(60, { minPollIntervalMs: 10 }), await runLoopFor(60, { minPollIntervalMs: 0 })];
    console.log(`[floor] 60 ms window -> floor=10 ms: ${floored} requests, floor=0: ${unfloored} requests`);
    expect(unfloored).toBeGreaterThan(floored * 3);
  });

  test("the loop stops making requests once disposed", async () => {
    let attempts = 0;
    const stop = startAgentOpens({
      getSessionId: () => "session-1",
      subscribeSession: () => () => {},
      sink: { openFile: () => {}, openTab: () => {} },
      fetchImpl: immediateEmptyAnswer(() => {
        attempts += 1;
      }),
      routeUrl: () => "http://127.0.0.1:1/bioviewer/open",
      minPollIntervalMs: 5,
      onError: () => {},
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    stop();
    const afterStop = attempts;
    await new Promise((resolve) => setTimeout(resolve, 60));
    console.log(`[floor] requests at dispose: ${afterStop}, 60 ms later: ${attempts}`);
    expect(attempts).toBe(afterStop);
  });

  test("the poll route is this plugin's own, written without a leading slash", () => {
    // `hostRouteUrl` only knows better-sidebar's /sidebar/* routes, so the open
    // route must not be routed through it.
    expect(OPEN_ROUTE).toBe("bioviewer/open");
    expect(OPEN_ROUTE.startsWith("/")).toBe(false);
    expect(STRUCTURE_TAB_ID.startsWith(`${pkg.name}:`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL — transport base resolution
//
// A wrong base is invisible locally and breaks exactly the deployments that are
// hardest to debug: a reverse proxy under a sub-path, or the desktop shell's
// non-http scheme. Each case below pins the resolved URL.
// ---------------------------------------------------------------------------

describe("ADVERSARIAL transport base resolution", () => {
  const fakeDoc = (baseURI: string): Document => ({ baseURI }) as unknown as Document;
  const withTransport = <T,>(value: unknown, body: () => T): T => {
    const target = globalThis as { __DSH_TRANSPORT__?: unknown };
    const saved = target.__DSH_TRANSPORT__;
    target.__DSH_TRANSPORT__ = value;
    try {
      return body();
    } finally {
      if (saved === undefined) delete target.__DSH_TRANSPORT__;
      else target.__DSH_TRANSPORT__ = saved;
    }
  };

  test("a leading-slash route is stripped and stays under a sub-path base", () => {
    const url = pluginRouteUrl("/bioviewer/open", fakeDoc("http://127.0.0.1:5000/gui/"));
    console.log(`[transport] leading slash + sub-path -> ${url}`);
    expect(url).toBe("http://127.0.0.1:5000/gui/bioviewer/open");
  });

  test("a base with a query keeps its path and drops the query", () => {
    const url = pluginRouteUrl("bioviewer/open", fakeDoc("http://127.0.0.1:5000/gui/?token=abc"));
    console.log(`[transport] base with query -> ${url}`);
    expect(url).toBe("http://127.0.0.1:5000/gui/bioviewer/open");
  });

  test("__DSH_TRANSPORT__.streamBaseUrl wins over the document base", () => {
    const url = withTransport({ streamBaseUrl: "http://127.0.0.1:6000/prefix/" }, () =>
      pluginRouteUrl("bioviewer/open", fakeDoc("http://127.0.0.1:5000/ignored/")),
    );
    console.log(`[transport] injected base -> ${url}`);
    expect(url).toBe("http://127.0.0.1:6000/prefix/bioviewer/open");
  });

  test("a non-http scheme (desktop shell) is preserved, not coerced", () => {
    const url = withTransport({ streamBaseUrl: "dsh-app://app/" }, () =>
      pluginRouteUrl("/bioviewer/open", fakeDoc("http://127.0.0.1:5000/ignored/")),
    );
    console.log(`[transport] dsh-app scheme -> ${url}`);
    expect(url).toBe("dsh-app://app/bioviewer/open");
  });

  test("an empty or non-string streamBaseUrl falls back to the document base", () => {
    for (const value of ["", 42, null, undefined, {}]) {
      const base = withTransport({ streamBaseUrl: value }, () => transportBase(fakeDoc("http://127.0.0.1:5000/gui/")));
      expect(base).toBe("http://127.0.0.1:5000/gui/");
    }
    // A transport object that is not an object at all must not throw either.
    expect(withTransport("nonsense", () => transportBase(fakeDoc("http://127.0.0.1:5000/gui/")))).toBe(
      "http://127.0.0.1:5000/gui/",
    );
  });

  test("with no base at all the failure is loud, not a relative URL", () => {
    // Remove every base source the resolver can fall back to: the injected
    // transport (unset for this test), the document, and the location.
    const target = globalThis as { location?: unknown; document?: unknown };
    const savedLocation = target.location;
    const savedDocument = target.document;
    delete target.location;
    delete target.document;
    try {
      expect(() => pluginRouteUrl("bioviewer/open", undefined)).toThrow(/no base URL available/);
    } finally {
      if (savedLocation !== undefined) target.location = savedLocation;
      target.document = savedDocument;
    }
    // Restored, so the rest of the file still resolves routes.
    expect(pluginRouteUrl("bioviewer/open")).toBe("http://127.0.0.1:9/bioviewer/open");
  });

  test("characterisation: a base whose path has no trailing slash follows standard URL resolution", () => {
    // Not a defect claim — recorded so the behaviour is visible. Relative-URL
    // resolution replaces the last segment, exactly as a browser would for a
    // relative link on that page; a shell that injects a directory base must
    // include the trailing slash.
    const url = pluginRouteUrl("bioviewer/open", fakeDoc("http://127.0.0.1:5000/gui"));
    console.log(`[transport] no-trailing-slash base -> ${url}`);
    expect(url).toBe("http://127.0.0.1:5000/bioviewer/open");
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL — the marker route (new in the 0.1.4 delta)
//
// `loadIntoStudio`'s `kind: "markers"` route draws every set a file contained.
// The trap is removal: a per-set removal deletes the set drawn a moment earlier,
// and repeated labels are realistic because Chimera's own default marker-set
// name is "markers".
// ---------------------------------------------------------------------------

interface FakeObject {
  id: string;
  label: string;
  kind: "markers" | "structure";
}

/** A studio double whose snapshot/remove actually track what is on screen. */
function makeMarkerStudio(): {
  studio: Record<string, unknown>;
  objects: FakeObject[];
  loads: string[];
  removals: string[];
} {
  let seq = 0;
  const objects: FakeObject[] = [];
  const loads: string[] = [];
  const removals: string[] = [];
  const studio: Record<string, unknown> = {
    loadStructure: async () => {},
    loadVolume: async () => {},
    getSnapshot: () => ({ objects: objects.map((o) => ({ id: o.id, label: o.label })) }),
    remove: async (id: string) => {
      removals.push(id);
      const at = objects.findIndex((o) => o.id === id);
      if (at >= 0) objects.splice(at, 1);
    },
    loadMarkers: async (set: { label: string }) => {
      loads.push(set.label);
      seq += 1;
      objects.push({ id: `m${seq}`, label: set.label, kind: "markers" });
    },
  };
  return { studio, objects, loads, removals };
}

const markerSet = (label: string, x: number): Record<string, unknown> => ({
  label,
  markers: [{ position: [x, 0, 0], radius: 0.5, color: "#ff0000" }],
  links: [],
});

const markerPayload = (sets: unknown[]): Record<string, unknown> => ({
  kind: "markers",
  path: "/tmp/model.cmm",
  title: "model.cmm",
  sets,
  gzip: false,
});

describe("ADVERSARIAL marker route", () => {
  test("three sets sharing one label are ALL drawn", async () => {
    const { studio, objects, loads } = makeMarkerStudio();
    await loadIntoStudio(studio as never, markerPayload([
      markerSet("markers", 1),
      markerSet("markers", 2),
      markerSet("markers", 3),
    ]) as never);
    console.log(`[markers] loadMarkers calls=${loads.length}, objects on screen=${objects.length}`);
    // A per-set removal would leave exactly one object here.
    expect(loads).toHaveLength(3);
    expect(objects).toHaveLength(3);
    expect(objects.map((o) => o.label)).toEqual(["markers", "markers", "markers"]);
  });

  test("re-drawing the same file leaves exactly one object per set", async () => {
    const { studio, objects } = makeMarkerStudio();
    const payload = markerPayload([markerSet("markers", 1), markerSet("markers", 2), markerSet("markers", 3)]);
    await loadIntoStudio(studio as never, payload as never);
    await loadIntoStudio(studio as never, payload as never);
    console.log(`[markers] after two loads: ${objects.length} objects, ids=${objects.map((o) => o.id).join(",")}`);
    expect(objects).toHaveLength(3);
  });

  test("a set whose label collides with a STRUCTURE in the studio", async () => {
    // Removal matches on label alone, so a structure labelled like the marker
    // set is indistinguishable from a previously drawn set. Recorded, not
    // asserted away: see docs/VERIFICATION.md (finding F3).
    const { studio, objects } = makeMarkerStudio();
    objects.push({ id: "s1", label: "markers", kind: "structure" });
    await loadIntoStudio(studio as never, markerPayload([markerSet("markers", 1)]) as never);
    const survivors = objects.map((o) => `${o.kind}:${o.label}`);
    console.log(`[markers] survivors after a colliding load: ${JSON.stringify(survivors)}`);
    console.log(`[markers] F3 the structure was removed: ${!survivors.includes("structure:markers")}`);
  });

  test("a .cmm with no marker_set is rejected, not drawn as a blank canvas", async () => {
    // Parser level.
    let parseError: string | undefined;
    try {
      parseCmmMarkerSets(`<?xml version="1.0"?><marker_sets></marker_sets>`, "empty");
    } catch (error) {
      parseError = (error as Error).message;
    }
    console.log(`[markers] empty-file parse error: ${parseError}`);
    expect(parseError).toBeDefined();

    // Loader level: an empty set list must throw before it touches the studio,
    // so the component's error path renders instead of an empty viewport.
    const { studio, removals, loads } = makeMarkerStudio();
    let loadError: string | undefined;
    try {
      await loadIntoStudio(studio as never, markerPayload([]) as never);
    } catch (error) {
      loadError = (error as Error).message;
    }
    console.log(`[markers] empty-payload load error: ${loadError}`);
    expect(loadError).toBeDefined();
    expect(loadError).toContain("no marker sets");
    // Nothing was drawn and nothing was deleted on the way to the error.
    expect(loads).toEqual([]);
    expect(removals).toEqual([]);
  });

  test("a studio without loadMarkers fails loudly instead of silently doing nothing", async () => {
    const { studio, objects } = makeMarkerStudio();
    delete studio["loadMarkers"];
    let error: string | undefined;
    try {
      await loadIntoStudio(studio as never, markerPayload([markerSet("markers", 1)]) as never);
    } catch (caught) {
      error = (caught as Error).message;
    }
    console.log(`[markers] missing-loadMarkers error: ${error}`);
    expect(error).toContain("loadMarkers");
    expect(objects).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL — the (label, kind) replacement key
//
// `loadIntoStudio` drops the objects a payload is about to replace, matched on
// label AND kind. Getting the kind wrong is silent in both directions: too
// narrow and nothing is removed (the duplicate-stacking bug contract #9 exists
// to prevent), too wide and an unrelated object vanishes.
// ---------------------------------------------------------------------------

interface KindObject {
  id: string;
  label: string;
  kind?: string;
}

/** A studio double that records which loader ran and what was removed. */
function makeKindStudio(seed: readonly KindObject[]): {
  studio: Record<string, unknown>;
  objects: KindObject[];
  events: string[];
} {
  const objects: KindObject[] = seed.map((object) => ({ ...object }));
  const events: string[] = [];
  const studio: Record<string, unknown> = {
    loadStructure: async () => {
      events.push("load:structure");
    },
    loadVolume: async () => {
      events.push("load:volume");
    },
    loadMarkers: async () => {
      events.push("load:markers");
    },
    loadPdb: async () => {
      events.push("load:pdb");
    },
    loadAlphaFoldDb: async () => {
      events.push("load:alphafold");
    },
    loadEmdb: async () => {
      events.push("load:emdb");
    },
    getSnapshot: () => ({ objects: objects.map((object) => ({ ...object })) }),
    remove: async (id: string) => {
      events.push(`remove:${id}`);
      const at = objects.findIndex((object) => object.id === id);
      if (at >= 0) objects.splice(at, 1);
    },
  };
  return { studio, objects, events };
}

const bytesPayloadFor = (format: unknown): Record<string, unknown> => ({
  kind: "bytes",
  path: "/data/sample",
  title: "sample",
  bytes: new Uint8Array([1, 2, 3]),
  format,
  gzip: false,
});

describe("ADVERSARIAL (label, kind) replacement key", () => {
  test("every BIO_FORMATS entry keys the kind MolStudio actually produces", async () => {
    // The bytes route keys `volume` for volumes and `structure` for everything
    // else, because molecules go through `loadStructure`. Seeding BOTH kinds
    // under the same label makes the assertion exact: only the object whose kind
    // matches may be replaced.
    const checked: string[] = [];
    for (const format of BIO_FORMATS) {
      if (format.kind === "markers") continue; // never reaches the bytes route
      const expected = format.kind === "volume" ? "volume" : "structure";
      const other = expected === "volume" ? "structure" : "volume";
      const { studio, objects, events } = makeKindStudio([
        { id: "right", label: "sample", kind: expected },
        { id: "wrong", label: "sample", kind: other },
      ]);
      await loadIntoStudio(studio as never, bytesPayloadFor(format) as never);
      checked.push(`${format.id}:${expected}`);
      expect(events).toContain("remove:right");
      expect(events).not.toContain("remove:wrong");
      expect(objects.map((object) => object.id)).toEqual(["wrong"]);
    }
    console.log(`[kind] bytes-route keys checked: ${checked.join(", ")}`);
    expect(checked.length).toBeGreaterThanOrEqual(9);
  });

  test("F3 inverted: a STRUCTURE labelled 'markers' survives a marker load", async () => {
    const { studio, objects, events } = makeKindStudio([{ id: "ref-structure", label: "markers", kind: "structure" }]);
    await loadIntoStudio(studio as never, markerPayload([markerSet("markers", 1)]) as never);
    console.log(`[kind] after marker load: events=${JSON.stringify(events)}, survivors=${JSON.stringify(objects.map((o) => `${o.kind}:${o.id}`))}`);
    expect(events).not.toContain("remove:ref-structure");
    expect(objects.some((object) => object.id === "ref-structure")).toBe(true);
  });

  test("F3 converse: a MARKER set labelled like a structure survives the structure load", async () => {
    const { studio, objects, events } = makeKindStudio([{ id: "ref-markers", label: "1abc", kind: "markers" }]);
    await loadIntoStudio(studio as never, {
      kind: "bytes",
      path: "/data/1abc.pdb",
      title: "1abc",
      bytes: new TextEncoder().encode("ATOM"),
      format: BIO_FORMATS.find((format) => format.id === "pdb"),
      gzip: false,
    } as never);
    console.log(`[kind] after structure load: events=${JSON.stringify(events)}`);
    expect(events).not.toContain("remove:ref-markers");
    expect(objects.some((object) => object.id === "ref-markers")).toBe(true);
  });

  test("the EMDB route keys 'volume', so a volume is replaced and a structure is not", async () => {
    const { studio, objects, events } = makeKindStudio([
      { id: "ref-volume", label: "EMD-1234", kind: "volume" },
      { id: "ref-structure", label: "EMD-1234", kind: "structure" },
    ]);
    await loadIntoStudio(studio as never, { kind: "structure", source: "emdb", id: "EMD-1234", title: "EMD-1234" } as never);
    console.log(`[kind] emdb: events=${JSON.stringify(events)}`);
    expect(events).toContain("remove:ref-volume");
    expect(events).not.toContain("remove:ref-structure");
    expect(objects.map((object) => object.id)).toEqual(["ref-structure"]);
  });

  test("a studio that reports NO kind still replaces by label (the deliberate fallback)", async () => {
    // A studio too old to report `kind` must not stop replacing: removing
    // nothing is the duplicate-stacking bug, which is worse than over-removing.
    const { studio, objects, events } = makeKindStudio([{ id: "legacy", label: "sample" }]);
    await loadIntoStudio(studio as never, bytesPayloadFor(BIO_FORMATS.find((format) => format.id === "pdb")) as never);
    console.log(`[kind] fallback: events=${JSON.stringify(events)}, remaining=${objects.length}`);
    // Reached only through the `object.kind === undefined` branch.
    expect(events).toContain("remove:legacy");
    expect(objects).toEqual([]);
  });

  test("the shared-label fix survives the new key: three sets still all get drawn", async () => {
    const { studio, events } = makeKindStudio([{ id: "old", label: "markers", kind: "markers" }]);
    await loadIntoStudio(studio as never, markerPayload([
      markerSet("markers", 1),
      markerSet("markers", 2),
      markerSet("markers", 3),
    ]) as never);
    console.log(`[kind] shared-label: ${events.filter((event) => event === "load:markers").length} marker loads, removed=${JSON.stringify(events.filter((e) => e.startsWith("remove:")))}`);
    expect(events.filter((event) => event === "load:markers")).toHaveLength(3);
    expect(events.filter((event) => event.startsWith("remove:"))).toEqual(["remove:old"]);
  });
});
