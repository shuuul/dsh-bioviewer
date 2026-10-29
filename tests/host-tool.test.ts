/**
 * Unit tests for the host half's tool and route.
 *
 * `defineTool` and `ctx.webServer` are framework calls, so they are not faked
 * at their own level: a hand-written `ctx` captures what the plugin registers,
 * and the tests then drive the *captured* definition and handler directly. That
 * covers everything this plugin actually owns — the target mapping, the cwd
 * rule, the canonical value, the auth fence and the wire envelope — without
 * standing up cordis or a listener.
 */

import { describe, expect, test } from "bun:test";
import type { Context } from "@deepseek-ai/cordis";
import { apply } from "../src/index";
import { OpenRegistry } from "../src/host/registry";
import { OPEN_ROUTE_PATH, registerOpenRoute } from "../src/host/route";
import { BIO_OPEN_TOOL, registerBioOpenTool } from "../src/host/tool";
import { resolveOpen } from "../src/host/target";
import type { OpenRequest } from "../src/shared/opens";

// ── the fake host ───────────────────────────────────────────────────────────

/** The subset of the tool definition the fake registry captured.
 *
 * `defineTool` compiles the author-facing parameter/output DSL into raw JSON
 * Schema before returning, so `parameters` and `output.schema` are the
 * model-visible JSON Schema (root `required` array, no per-property `required`). */
interface CapturedTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type?: string;
    readonly properties?: Record<string, { type?: string; description?: string }>;
    readonly required?: string[];
  };
  readonly output: {
    readonly schema: {
      readonly type?: string;
      readonly additionalProperties?: boolean;
      readonly properties?: Record<string, { type?: string }>;
      readonly required?: string[];
    };
    render(args: unknown, value: unknown): Array<{ type: string; text: string }>;
  };
  execute(args: { target: string; title?: string }, exec: unknown): Promise<Record<string, unknown>>;
}

/** One route the fake web server captured. */
interface CapturedRoute {
  readonly kind: string;
  readonly path: string;
  readonly handler: unknown;
}

interface FakeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
}

interface FakeResponse {
  statusCode: number;
  headersSent: boolean;
  status: number | undefined;
  headers: Record<string, string> | undefined;
  body: string | undefined;
  destroyed: boolean;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string): void;
  destroy(): void;
  once(event: string, listener: () => void): void;
  off(event: string, listener: () => void): void;
  /** Simulate the client hanging up mid-poll. */
  fireClose(): void;
}

function fakeResponse(): FakeResponse {
  let closeListener: (() => void) | undefined;
  return {
    statusCode: 200,
    headersSent: false,
    status: undefined,
    headers: undefined,
    body: undefined,
    destroyed: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(body) {
      this.body = body;
    },
    destroy() {
      this.destroyed = true;
    },
    once(event, listener) {
      if (event === "close") closeListener = listener;
    },
    off(event, listener) {
      if (event === "close" && closeListener === listener) closeListener = undefined;
    },
    fireClose() {
      closeListener?.();
    },
  };
}

interface Harness {
  readonly ctx: Context;
  readonly tools: unknown[];
  readonly routes: CapturedRoute[];
  readonly warnings: string[];
  readonly infos: string[];
  readonly unregistered: string[];
  readonly removed: string[];
  /** The disposer each `ctx.effect` body returned, in call order (root or scoped). */
  readonly effects: Array<() => void>;
  /** Every dependency list `ctx.inject` was called with, in call order. */
  readonly injectDeps: string[][];
  /**
   * Ordering log: `inject:<deps>` when `ctx.inject` is called, `register-tool`
   * and `register-route` when a registration reaches the fake service. This is
   * what pins "registration happens inside the injected callback, never at
   * apply() time" without depending on how `apply` is written.
   */
  readonly events: string[];
  /** The provider comes up: make the services visible and run the injected callback. */
  provideServices(): void;
}

interface HostOptions {
  /** `false` omits the service, i.e. a host that does not provide it. */
  readonly tools?: boolean;
  readonly webServer?: boolean;
  readonly connection?: unknown;
  readonly workingDirectory?: unknown;
  /**
   * Model the real host: `get()` sees no service until `ctx.inject` runs its
   * callback, because this plugin activates before the host provides them.
   * `false` (the default) keeps them visible from the start, which is what the
   * direct `register*` tests need.
   */
  readonly providerLate?: boolean;
  /**
   * What `ctx.inject` does: run its callback now (a host whose services are
   * already up), only when the test asks (the provider arriving late — the real
   * case), or never (a stripped-down host).
   */
  readonly inject?: "now" | "manual" | "never";
}

/**
 * A cordis context stand-in.
 *
 * `get` serves the provided services (once the provider is up), `effect` runs
 * its body immediately and keeps the disposer, `inject` records its dependency
 * list and runs its callback when the test says so, and the logger records.
 */
function fakeHost(options: HostOptions = {}): Harness {
  const tools: unknown[] = [];
  const routes: CapturedRoute[] = [];
  const warnings: string[] = [];
  const infos: string[] = [];
  const unregistered: string[] = [];
  const removed: string[] = [];
  const effects: Array<() => void> = [];
  const injectDeps: string[][] = [];
  const events: string[] = [];
  const pending: Array<() => void> = [];
  const mode = options.inject ?? "now";
  // A late provider is the real host: nothing is readable until `ctx.inject`
  // has run the callback that waited for it.
  let servicesUp = options.providerLate !== true;

  const provided: Record<string, unknown> = {};
  if (options.tools !== false) {
    provided["tools"] = {
      register(definition: unknown) {
        tools.push(definition);
        events.push("register-tool");
        const named = definition as { name?: string };
        return () => {
          unregistered.push(named.name ?? "?");
        };
      },
    };
  }
  if (options.webServer !== false) {
    provided["webServer"] = {
      register(route: CapturedRoute) {
        routes.push(route);
        events.push("register-route");
        return () => {
          removed.push(route.path);
        };
      },
    };
  }
  if (options.connection !== undefined) provided["connection"] = options.connection;
  if (options.workingDirectory !== undefined) provided["workingDirectory"] = options.workingDirectory;

  const logger = {
    info: (...args: unknown[]) => {
      infos.push(args.map(String).join(" "));
    },
    warn: (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    },
  };
  const get = (name: string): unknown => (servicesUp ? provided[name] : undefined);
  const effect = (execute: () => () => void): (() => void) => {
    effects.push(execute());
    return () => {};
  };

  // The child context `ctx.inject` hands its callback: the same services and
  // the same effect collection. What matters is WHEN it becomes usable.
  const scoped = { logger, effect, get };

  const ctx = {
    logger,
    effect,
    get,
    inject: (deps: string[], callback: (scope: unknown) => void) => {
      injectDeps.push([...deps]);
      events.push(`inject:${deps.join(",")}`);
      const run = (): void => {
        servicesUp = true;
        callback(scoped);
      };
      if (mode === "now") run();
      else if (mode === "manual") pending.push(run);
      return undefined;
    },
  };

  return {
    ctx: ctx as unknown as Context,
    tools,
    routes,
    warnings,
    infos,
    unregistered,
    removed,
    effects,
    injectDeps,
    events,
    provideServices: () => {
      for (const run of pending.splice(0)) run();
    },
  };
}

/** The captured `bio_open` definition, or a loud failure. */
function bioOpen(harness: Harness): CapturedTool {
  const [definition] = harness.tools;
  if (definition === undefined) throw new Error("no tool was registered");
  return definition as CapturedTool;
}

/** A `ToolRunContext` stand-in: only `signal` and `agent.session` are read. */
function fakeExec(options: { sessionId?: string; headerCwd?: string; agent?: boolean; signal?: AbortSignal } = {}): unknown {
  const signal = options.signal ?? new AbortController().signal;
  if (options.agent === false) return { signal, agent: undefined };
  return {
    signal,
    agent: {
      session: {
        id: options.sessionId ?? "s1",
        header: options.headerCwd === undefined ? {} : { cwd: options.headerCwd },
      },
    },
  };
}

/** A GET the route handler can read. */
function fakeRequest(url: string, method = "GET"): FakeRequest {
  return { method, url, headers: { host: "127.0.0.1:59290" } };
}

/** The captured route handler, typed for the fakes above. */
function routeHandler(harness: Harness): (req: FakeRequest, res: FakeResponse) => void | Promise<void> {
  const [route] = harness.routes;
  if (route === undefined) throw new Error("no route was registered");
  return route.handler as (req: FakeRequest, res: FakeResponse) => void | Promise<void>;
}

// ── target → request mapping ────────────────────────────────────────────────

describe("resolveOpen: files", () => {
  test("maps an absolute path to a file request with the detected format", () => {
    expect(resolveOpen("/data/1abc.pdb", undefined, undefined)).toEqual({
      kind: "file",
      request: { kind: "file", path: "/data/1abc.pdb", title: "1abc.pdb", formatId: "pdb" },
      target: "/data/1abc.pdb",
      title: "1abc.pdb",
    });
  });

  test("resolves a relative path against the session cwd", () => {
    const resolved = resolveOpen("models/1abc.cif", undefined, "/work/session");
    expect(resolved.request).toEqual({
      kind: "file",
      path: "/work/session/models/1abc.cif",
      title: "1abc.cif",
      formatId: "mmcif",
    });
  });

  test("normalises a path before it is queued", () => {
    const resolved = resolveOpen("./models/../1abc.ent", undefined, "/work/session");
    expect(resolved.target).toBe("/work/session/1abc.ent");
    expect(resolved.request).toMatchObject({ formatId: "pdb" });
  });

  test("accepts a compressed file and titles it without the .gz suffix", () => {
    const resolved = resolveOpen("/data/map.mrc.gz", undefined, undefined);
    expect(resolved.request).toEqual({
      kind: "file",
      path: "/data/map.mrc.gz",
      title: "map.mrc",
      formatId: "ccp4",
    });
  });

  test("accepts a markers file (rendered by the viewer, not Mol*)", () => {
    expect(resolveOpen("/data/site.cmm", undefined, undefined).request).toMatchObject({ formatId: "cmm" });
  });

  test("keeps a caller-supplied title, and treats a blank one as absent", () => {
    expect(resolveOpen("/data/1abc.pdb", "My structure", undefined).title).toBe("My structure");
    expect(resolveOpen("/data/1abc.pdb", "   ", undefined).title).toBe("1abc.pdb");
  });

  test("refuses an unsupported extension with the supported list", () => {
    expect(() => resolveOpen("/data/notes.txt", undefined, undefined)).toThrow(
      /not a supported biomolecular file.*Supported extensions: .*pdb/s,
    );
  });

  test("refuses a relative path in a session without a working directory", () => {
    expect(() => resolveOpen("1abc.pdb", undefined, undefined)).toThrow(/no working directory/);
    expect(() => resolveOpen("1abc.pdb", undefined, "")).toThrow(/no working directory/);
  });

  test("does not stat the file: a supported name is enough to queue it", () => {
    // Existence is the viewer's problem (it fetches); the tool's contract is the
    // format table, so a missing-but-supported path still maps cleanly.
    expect(resolveOpen("/nowhere/at/all/1abc.pdb", undefined, undefined).kind).toBe("file");
  });
});

describe("resolveOpen: structures", () => {
  test("normalises a PDB accession", () => {
    expect(resolveOpen("pdb:1cbs", undefined, undefined)).toEqual({
      kind: "structure",
      request: { kind: "structure", source: "pdb", id: "1CBS", title: "PDB 1CBS" },
      target: "pdb:1CBS",
      title: "PDB 1CBS",
    });
  });

  test("accepts the AlphaFold alias and normalises the accession", () => {
    expect(resolveOpen("alphafold:p00533", undefined, undefined).request).toEqual({
      kind: "structure",
      source: "alphafold",
      id: "P00533",
      title: "AlphaFold P00533",
    });
    expect(resolveOpen("af:P00533", undefined, undefined).request).toMatchObject({ source: "alphafold" });
  });

  test("normalises an EMDB id with and without its EMD- prefix", () => {
    expect(resolveOpen("emdb:1234", undefined, undefined)).toMatchObject({
      target: "emdb:EMD-1234",
      request: { kind: "structure", source: "emdb", id: "EMD-1234", title: "EMDB EMD-1234" },
    });
    expect(resolveOpen("emdb:EMD-1234", undefined, undefined).target).toBe("emdb:EMD-1234");
  });

  test("a caller-supplied title wins for a structure too", () => {
    expect(resolveOpen("pdb:1cbs", "Cellular retinoic acid-binding protein", undefined).title).toBe(
      "Cellular retinoic acid-binding protein",
    );
  });

  test("a structure target needs no working directory", () => {
    expect(resolveOpen("pdb:1cbs", undefined, undefined).kind).toBe("structure");
  });
});

describe("resolveOpen: rejections", () => {
  test("refuses an empty target", () => {
    expect(() => resolveOpen("   ", undefined, "/work")).toThrow(/empty/);
  });

  test("refuses a malformed PDB id", () => {
    expect(() => resolveOpen("pdb:zz", undefined, "/work")).toThrow(/not a 4-character PDB id/);
  });

  test("refuses a malformed UniProt accession", () => {
    expect(() => resolveOpen("alphafold:123", undefined, "/work")).toThrow(/not a UniProt accession/);
  });

  test("refuses a malformed EMDB id", () => {
    expect(() => resolveOpen("emdb:EMD-", undefined, "/work")).toThrow(/not an EMDB id/);
  });

  test("refuses an unknown source prefix instead of reading it as a path", () => {
    expect(() => resolveOpen("ncbi:1cbs", undefined, "/work")).toThrow(/unknown source "ncbi"/);
  });
});

// ── the tool ────────────────────────────────────────────────────────────────

describe("bio_open registration", () => {
  test("registers one tool under the bio-aware name", () => {
    const host = fakeHost();
    registerBioOpenTool(host.ctx, new OpenRegistry());
    expect(host.tools).toHaveLength(1);
    const definition = bioOpen(host);
    expect(definition.name).toBe(BIO_OPEN_TOOL);
    expect(definition.name).toBe("bio_open");
    // The description has to steer the model away from the generic tool.
    expect(definition.description).toContain("sidebar_open");
    expect(definition.description).toContain("pdb:1cbs");
    expect(definition.description).toContain("alphafold:P00533");
    expect(definition.description).toContain("emdb:EMD-1234");
    expect(definition.description).toContain("pdb");
    expect(typeof definition.execute).toBe("function");
    expect(typeof definition.output.render).toBe("function");
  });

  test("declares target as the only required parameter, and a closed output object", () => {
    const host = fakeHost();
    registerBioOpenTool(host.ctx, new OpenRegistry());
    const definition = bioOpen(host);

    expect(definition.parameters.type).toBe("object");
    expect(definition.parameters.properties?.["target"]?.type).toBe("string");
    expect(definition.parameters.properties?.["target"]?.description).toContain("pdb:1cbs");
    expect(definition.parameters.required).toEqual(["target"]);
    expect(definition.parameters.properties?.["title"]?.type).toBe("string");

    expect(definition.output.schema.type).toBe("object");
    expect(definition.output.schema.additionalProperties).toBe(false);
    const properties = Object.keys(definition.output.schema.properties ?? {}).sort();
    expect(properties).toEqual(["delivered", "kind", "target", "title"]);
    expect([...(definition.output.schema.required ?? [])].sort()).toEqual(properties);
  });

  test("degrades with a warning when the host has no tool registry", () => {
    const host = fakeHost({ tools: false });
    const dispose = registerBioOpenTool(host.ctx, new OpenRegistry());
    expect(typeof dispose).toBe("function");
    expect(host.tools).toHaveLength(0);
    expect(host.warnings.join("\n")).toContain("no tool registry");
    expect(host.warnings.join("\n")).toContain("bio_open");
  });
});

describe("bio_open execute", () => {
  test("queues a file resolved against the committed working directory", async () => {
    const registry = new OpenRegistry();
    const host = fakeHost({ workingDirectory: { get: () => "/committed" } });
    registerBioOpenTool(host.ctx, registry);

    const result = await bioOpen(host).execute({ target: "1abc.pdb" }, fakeExec({ headerCwd: "/original" }));
    expect(result).toEqual({
      kind: "file",
      target: "/committed/1abc.pdb",
      title: "1abc.pdb",
      delivered: false,
    });
    expect(await registry.wait("s1", { signal: new AbortController().signal, timeoutMs: 0 })).toEqual({
      kind: "file",
      path: "/committed/1abc.pdb",
      title: "1abc.pdb",
      formatId: "pdb",
    });
  });

  test("falls back to the session header cwd when the service has no value", async () => {
    const registry = new OpenRegistry();
    const host = fakeHost({ workingDirectory: { get: () => "" } });
    registerBioOpenTool(host.ctx, registry);

    const result = await bioOpen(host).execute({ target: "1abc.pdb" }, fakeExec({ headerCwd: "/original" }));
    expect(result["target"]).toBe("/original/1abc.pdb");
  });

  test("reports delivered:true when the sidebar is already polling", async () => {
    const registry = new OpenRegistry();
    const host = fakeHost();
    registerBioOpenTool(host.ctx, registry);

    const parked = registry.wait("s1", { signal: new AbortController().signal, timeoutMs: 1_000 });
    const result = await bioOpen(host).execute({ target: "pdb:1cbs" }, fakeExec());
    expect(result).toEqual({ kind: "structure", target: "pdb:1CBS", title: "PDB 1CBS", delivered: true });
    expect(await parked).toEqual({ kind: "structure", source: "pdb", id: "1CBS", title: "PDB 1CBS" });
  });

  test("queues a database structure for the calling session only", async () => {
    const registry = new OpenRegistry();
    const host = fakeHost();
    registerBioOpenTool(host.ctx, registry);

    await bioOpen(host).execute({ target: "emdb:1234" }, fakeExec({ sessionId: "s7" }));
    expect(registry.hasWaiter("s7")).toBe(false);
    expect(await registry.wait("s1", { signal: new AbortController().signal, timeoutMs: 0 })).toBeNull();
    expect(await registry.wait("s7", { signal: new AbortController().signal, timeoutMs: 0 })).toEqual({
      kind: "structure",
      source: "emdb",
      id: "EMD-1234",
      title: "EMDB EMD-1234",
    });
  });

  test("throws the canonical error without an initiating agent", async () => {
    const host = fakeHost();
    registerBioOpenTool(host.ctx, new OpenRegistry());
    await expect(bioOpen(host).execute({ target: "pdb:1cbs" }, fakeExec({ agent: false }))).rejects.toThrow(
      /bio_open requires an initiating agent/,
    );
  });

  test("propagates a rejection and queues nothing", async () => {
    const registry = new OpenRegistry();
    const host = fakeHost();
    registerBioOpenTool(host.ctx, registry);
    await expect(bioOpen(host).execute({ target: "/data/notes.txt" }, fakeExec())).rejects.toThrow(
      /not a supported biomolecular file/,
    );
    expect(await registry.wait("s1", { signal: new AbortController().signal, timeoutMs: 0 })).toBeNull();
  });

  test("an aborted call queues nothing", async () => {
    const registry = new OpenRegistry();
    const host = fakeHost();
    registerBioOpenTool(host.ctx, registry);
    const controller = new AbortController();
    controller.abort();
    await expect(
      bioOpen(host).execute({ target: "1abc.pdb" }, fakeExec({ signal: controller.signal })),
    ).rejects.toThrow();
    expect(await registry.wait("s1", { signal: new AbortController().signal, timeoutMs: 0 })).toBeNull();
  });

  test("renders a queued open differently from a delivered one", () => {
    const host = fakeHost();
    registerBioOpenTool(host.ctx, new OpenRegistry());
    const { render } = bioOpen(host).output;
    const value = { kind: "file", target: "/data/1abc.pdb", title: "1abc.pdb" };

    expect(render({}, { ...value, delivered: true })[0]?.text).toContain("Opened file");
    const queued = render({}, { ...value, delivered: false })[0]?.text ?? "";
    expect(queued).toContain("not connected");
    expect(queued).toContain("queued");
  });
});

// ── the route ───────────────────────────────────────────────────────────────

describe("open route registration", () => {
  test("registers one fenced prefix route at the client's path", () => {
    const host = fakeHost({ connection: { requestRejection: () => undefined } });
    registerOpenRoute(host.ctx, new OpenRegistry());
    expect(host.routes).toHaveLength(1);
    expect(host.routes[0]?.kind).toBe("prefix");
    expect(host.routes[0]?.path).toBe(OPEN_ROUTE_PATH);
    expect(OPEN_ROUTE_PATH).toBe("/bioviewer/open");
    expect(typeof host.routes[0]?.handler).toBe("function");
  });

  test("degrades with a warning when the host has no web server", () => {
    const host = fakeHost({ webServer: false });
    const dispose = registerOpenRoute(host.ctx, new OpenRegistry());
    expect(typeof dispose).toBe("function");
    expect(host.routes).toHaveLength(0);
    expect(host.warnings.join("\n")).toContain("no web server");
  });

  test("returns the route's own disposer", () => {
    const host = fakeHost({ connection: { requestRejection: () => undefined } });
    const dispose = registerOpenRoute(host.ctx, new OpenRegistry());
    dispose();
    expect(host.removed).toEqual([OPEN_ROUTE_PATH]);
  });
});

describe("open route handler", () => {
  function routed(options: { connection?: unknown; omitConnection?: boolean; registry?: OpenRegistry } = {}) {
    const host = fakeHost({
      connection:
        options.omitConnection === true
          ? undefined
          : (options.connection ?? { requestRejection: () => undefined }),
    });
    const registry = options.registry ?? new OpenRegistry();
    registerOpenRoute(host.ctx, registry);
    return { host, registry, handler: routeHandler(host) };
  }

  test("answers 200 with the queued request and the no-store envelope", async () => {
    const { registry, handler } = routed();
    const request: OpenRequest = { kind: "structure", source: "pdb", id: "1CBS", title: "PDB 1CBS" };
    registry.enqueue("s1", request);

    const res = fakeResponse();
    await handler(fakeRequest(`${OPEN_ROUTE_PATH}?sessionId=s1`), res);
    expect(res.status).toBe(200);
    expect(res.headers?.["content-type"]).toBe("application/json; charset=utf-8");
    expect(res.headers?.["cache-control"]).toBe("no-store");
    expect(JSON.parse(res.body ?? "")).toEqual({ ok: true, value: { request } });
  });

  test("refuses a request the host's connection policy rejects", async () => {
    const { handler } = routed({ connection: { requestRejection: () => 403 } });
    const res = fakeResponse();
    await handler(fakeRequest(`${OPEN_ROUTE_PATH}?sessionId=s1`), res);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body ?? "")).toEqual({ ok: false, error: { code: "forbidden", message: "forbidden" } });
  });

  test("refuses everything when the host cannot answer the policy question", async () => {
    // No connection service at all: an unfenced route would be reachable by any
    // page that can reach the port, so the safe answer is 403.
    const { handler } = routed({ omitConnection: true });
    const res = fakeResponse();
    await handler(fakeRequest(`${OPEN_ROUTE_PATH}?sessionId=s1`), res);
    expect(res.status).toBe(403);
  });

  test("rejects a non-GET method", async () => {
    const { handler } = routed();
    const res = fakeResponse();
    await handler(fakeRequest(`${OPEN_ROUTE_PATH}?sessionId=s1`, "POST"), res);
    expect(res.status).toBe(405);
    expect(JSON.parse(res.body ?? "").error.code).toBe("method-error");
  });

  test("requires sessionId", async () => {
    const { handler } = routed();
    const res = fakeResponse();
    await handler(fakeRequest(OPEN_ROUTE_PATH), res);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body ?? "").error.code).toBe("bad-request");
  });

  test("404s a deeper path under the prefix route", async () => {
    const { handler } = routed();
    const res = fakeResponse();
    await handler(fakeRequest(`${OPEN_ROUTE_PATH}/anything?sessionId=s1`), res);
    expect(res.status).toBe(404);
  });

  test("frees the waiter and writes nothing when the client hangs up", async () => {
    const { registry, handler } = routed();
    const res = fakeResponse();
    const pending = handler(fakeRequest(`${OPEN_ROUTE_PATH}?sessionId=s1`), res);
    // The handler has parked its waiter by now; the reader navigates away.
    expect(registry.hasWaiter("s1")).toBe(true);
    res.fireClose();
    await pending;
    expect(registry.hasWaiter("s1")).toBe(false);
    expect(res.status).toBeUndefined();
    expect(res.body).toBeUndefined();
    expect(res.destroyed).toBe(false);
  });
});

// ── the plugin entry ────────────────────────────────────────────────────────

describe("apply", () => {
  test("waits for the host services instead of racing their provider", () => {
    // The real host ordering, and the defect this pins: our plugin activates
    // BEFORE `webServer`/`tools` are provided, so a `ctx.get` at apply() time
    // returns undefined. Reading them then made both registrations take their
    // degrade-to-a-no-op path while the plugin still looked mounted — the route
    // answered the server's generic 404 and nothing failed loudly.
    const host = fakeHost({
      providerLate: true,
      inject: "manual",
      connection: { requestRejection: () => undefined },
    });
    apply(host.ctx);

    // Nothing may happen at apply() time except asking for the services.
    expect(host.events).toEqual(["inject:webServer,tools"]);
    expect(host.tools).toHaveLength(0);
    expect(host.routes).toHaveLength(0);
    expect(host.effects).toHaveLength(0);
    expect(host.warnings).toEqual([]);
    // A future edit that drops a dependency must be caught right here.
    expect(host.injectDeps).toEqual([["webServer", "tools"]]);

    // The provider comes up: both register, through the injected callback.
    host.provideServices();
    expect(host.tools).toHaveLength(1);
    expect(bioOpen(host).name).toBe(BIO_OPEN_TOOL);
    expect(host.routes).toHaveLength(1);
    expect(host.routes[0]?.path).toBe(OPEN_ROUTE_PATH);
    expect(typeof host.routes[0]?.handler).toBe("function");
    expect(host.effects).toHaveLength(1);
    // No degradation warning: the services were there when it mattered.
    expect(host.warnings).toEqual([]);
  });

  test("registers immediately when the services are already up", () => {
    const host = fakeHost({ providerLate: true, connection: { requestRejection: () => undefined } });
    apply(host.ctx);

    expect(host.tools).toHaveLength(1);
    expect(host.routes).toHaveLength(1);
    expect(host.effects).toHaveLength(1);
    expect(host.injectDeps).toEqual([["webServer", "tools"]]);
  });

  test("mounts without registering when the host never provides the services", () => {
    // A stripped-down host: the injected callback never runs, so the tool and
    // the route simply never exist — no throw, no half-registered state.
    const host = fakeHost({ providerLate: true, inject: "never" });
    expect(() => {
      apply(host.ctx);
    }).not.toThrow();

    expect(host.tools).toHaveLength(0);
    expect(host.routes).toHaveLength(0);
    expect(host.effects).toHaveLength(0);
    expect(host.warnings).toEqual([]);
    expect(host.injectDeps).toEqual([["webServer", "tools"]]);
    expect(host.infos.join("\n")).toContain("dsh-bioviewer");
  });

  test("registers the tool and the route inside one effect and disposes both", () => {
    const host = fakeHost({ providerLate: true, connection: { requestRejection: () => undefined } });
    apply(host.ctx);

    expect(host.effects).toHaveLength(1);
    expect(host.tools).toHaveLength(1);
    expect(host.routes).toHaveLength(1);
    expect(host.infos.join("\n")).toContain("dsh-bioviewer");

    host.effects[0]?.();
    expect(host.unregistered).toEqual(["bio_open"]);
    expect(host.removed).toEqual([OPEN_ROUTE_PATH]);
    // Unload must be idempotent: a second teardown must not double-dispose.
    host.effects[0]?.();
    expect(host.unregistered).toEqual(["bio_open"]);
  });

  test("degrades per registration if a service is unreadable when it runs", () => {
    // Defensive, not the normal path: `ctx.inject` guarantees both services by
    // the time the callback runs, so this only covers the case where one is
    // unreadable anyway. The point is that it degrades (one warning, a no-op
    // disposer) instead of throwing out of apply() and taking the other half
    // down with it. Each `register*` is also covered directly above.
    const host = fakeHost({ providerLate: true, tools: false, webServer: false });
    expect(() => {
      apply(host.ctx);
    }).not.toThrow();
    expect(host.tools).toHaveLength(0);
    expect(host.routes).toHaveLength(0);
    expect(host.effects).toHaveLength(1);
    expect(host.warnings).toHaveLength(2);
  });

  test("releases every parked poll on unload", async () => {
    const host = fakeHost({ providerLate: true, connection: { requestRejection: () => undefined } });
    apply(host.ctx);
    const handler = routeHandler(host);
    const res = fakeResponse();
    const pending = handler(fakeRequest(`${OPEN_ROUTE_PATH}?sessionId=s1`), res);

    host.effects[0]?.();
    await pending;
    // The poll answers null instead of holding the response past the unload.
    expect(JSON.parse(res.body ?? "")).toEqual({ ok: true, value: { request: null } });
  });
});
