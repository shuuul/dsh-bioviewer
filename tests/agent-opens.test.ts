import { describe, expect, test } from "bun:test";
import {
  dispatchOpen,
  pollOpenRequest,
  startAgentOpens,
  STRUCTURE_TAB_ID,
  type OpenSink,
} from "../src/client/agent-opens";
import type { OpenRequest } from "../src/shared/opens";

/** A fetch double that records its calls and answers from a script. */
type Answer = (init?: RequestInit) => Promise<Response>;

function fetchScript(answers: readonly Answer[]): {
  impl: typeof fetch;
  calls: { url: string; signal: AbortSignal | undefined }[];
} {
  const calls: { url: string; signal: AbortSignal | undefined }[] = [];
  let index = 0;
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), signal: init?.signal ?? undefined });
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    if (answer === undefined) throw new Error("no scripted answer");
    // The scripted answer must see `init`: a `parked` answer only ever settles
    // through the abort signal it is handed, so dropping it here would hang the
    // loop forever instead of testing anything.
    return answer(init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200): Promise<Response> =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );

/** A response that never arrives until its signal aborts. */
const parked = (init?: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });

const routeUrl = (route: string): string => `https://host/prefix/${route}`;

const FILE_REQUEST: OpenRequest = { kind: "file", path: "/w/1abc.pdb", title: "1abc.pdb", formatId: "pdb" };
const STRUCTURE_REQUEST: OpenRequest = { kind: "structure", source: "pdb", id: "1CBS", title: "PDB 1CBS" };

/** Poll a predicate until it holds, or fail the test. */
async function until(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition was never met");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("pollOpenRequest", () => {
  test("asks our own route for the active session and returns the request", async () => {
    const { impl, calls } = fetchScript([() => json({ ok: true, value: { request: FILE_REQUEST } })]);
    const result = await pollOpenRequest({ sessionId: "s1", fetchImpl: impl, routeUrl });
    expect(result).toEqual(FILE_REQUEST);
    expect(calls[0]?.url).toBe("https://host/prefix/bioviewer/open?sessionId=s1");
  });

  test("returns null when the host's hold expired with nothing to push", async () => {
    const { impl } = fetchScript([() => json({ ok: true, value: { request: null } })]);
    expect(await pollOpenRequest({ sessionId: "s1", fetchImpl: impl, routeUrl })).toBeNull();
  });

  test("passes the abort signal through to fetch", async () => {
    const controller = new AbortController();
    const { impl, calls } = fetchScript([() => json({ ok: true, value: { request: null } })]);
    await pollOpenRequest({ sessionId: "s1", signal: controller.signal, fetchImpl: impl, routeUrl });
    expect(calls[0]?.signal).toBe(controller.signal);
  });

  test("throws on a non-ok HTTP status so the caller can back off", async () => {
    const { impl } = fetchScript([() => json({}, 503)]);
    await expect(pollOpenRequest({ sessionId: "s1", fetchImpl: impl, routeUrl })).rejects.toThrow(/HTTP 503/);
  });

  test("throws on an error envelope", async () => {
    const { impl } = fetchScript([() => json({ ok: false, error: { code: "bad-request", message: "no" } })]);
    await expect(pollOpenRequest({ sessionId: "s1", fetchImpl: impl, routeUrl })).rejects.toThrow(/error envelope/);
  });

  test("drops an unrecognised request shape instead of throwing the loop", async () => {
    const { impl } = fetchScript([() => json({ ok: true, value: { request: { kind: "wat" } } })]);
    expect(await pollOpenRequest({ sessionId: "s1", fetchImpl: impl, routeUrl })).toBeNull();
  });

  test("rejects a structure request with an unknown source", async () => {
    const { impl } = fetchScript([
      () => json({ ok: true, value: { request: { kind: "structure", source: "genbank", id: "X" } } }),
    ]);
    expect(await pollOpenRequest({ sessionId: "s1", fetchImpl: impl, routeUrl })).toBeNull();
  });
});

describe("dispatchOpen", () => {
  test("a file opens in the editor pane for the polling session", () => {
    const calls: unknown[] = [];
    const sink: OpenSink = {
      openFile: (scope, path, title) => calls.push(["openFile", scope, path, title]),
      openTab: (seed, scope) => calls.push(["openTab", seed, scope]),
    };
    dispatchOpen(sink, "s1", FILE_REQUEST);
    expect(calls).toEqual([["openFile", { sessionId: "s1" }, "/w/1abc.pdb", "1abc.pdb"]]);
  });

  test("a structure opens our own tab, seeded with the accession as its path", () => {
    const calls: unknown[] = [];
    const sink: OpenSink = {
      openFile: () => calls.push(["openFile"]),
      openTab: (seed, scope) => calls.push(["openTab", seed, scope]),
    };
    dispatchOpen(sink, "s1", STRUCTURE_REQUEST);
    expect(calls).toEqual([
      [
        "openTab",
        { type: STRUCTURE_TAB_ID, path: "pdb:1CBS", title: "PDB 1CBS" },
        { sessionId: "s1" },
      ],
    ]);
  });
});

/**
 * A loop test with a hard timeout: a regression here parks a promise forever,
 * and without a deadline that hangs the whole suite instead of failing one test.
 */
const loopTest = (name: string, fn: () => Promise<void>): void => {
  test(name, fn, 5_000);
};

describe("startAgentOpens", () => {
  loopTest("dispatches a queued open and keeps polling", async () => {
    const seen: string[] = [];
    const sink: OpenSink = {
      openFile: (_scope, path) => seen.push(`file:${path}`),
      openTab: (seed) => seen.push(`tab:${seed.path}`),
    };
    const { impl, calls } = fetchScript([
      () => json({ ok: true, value: { request: FILE_REQUEST } }),
      (init?: RequestInit) => parked(init),
    ]);
    const stop = startAgentOpens({
      getSessionId: () => "s1",
      subscribeSession: () => () => {},
      sink,
      fetchImpl: impl,
      routeUrl,
      retryDelayMs: 5,
      minPollIntervalMs: 10,
    });
    await until(() => seen.length > 0);
    expect(seen).toEqual(["file:/w/1abc.pdb"]);
    // The loop parks a second request rather than exiting.
    await until(() => calls.length >= 2);
    stop();
  });

  loopTest("dispatches a structure open", async () => {
    const seen: string[] = [];
    const sink: OpenSink = {
      openFile: () => seen.push("file"),
      openTab: (seed) => seen.push(`tab:${seed.path}`),
    };
    const { impl } = fetchScript([
      () => json({ ok: true, value: { request: STRUCTURE_REQUEST } }),
      (init?: RequestInit) => parked(init),
    ]);
    const stop = startAgentOpens({
      getSessionId: () => "s1",
      subscribeSession: () => () => {},
      sink,
      fetchImpl: impl,
      routeUrl,
      retryDelayMs: 5,
      minPollIntervalMs: 10,
    });
    await until(() => seen.length > 0);
    expect(seen).toEqual(["tab:pdb:1CBS"]);
    stop();
  });

  loopTest("waits without polling while no session is mounted", async () => {
    const { impl, calls } = fetchScript([(init?: RequestInit) => parked(init)]);
    const stop = startAgentOpens({
      getSessionId: () => undefined,
      subscribeSession: () => () => {},
      sink: { openFile: () => {}, openTab: () => {} },
      fetchImpl: impl,
      routeUrl,
      retryDelayMs: 5,
      minPollIntervalMs: 10,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toEqual([]);
    stop();
  });

  loopTest("a session switch aborts the in-flight poll and re-polls for the new one", async () => {
    const requested: string[] = [];
    let session = "s1";
    let notify: (() => void) | undefined;
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      requested.push(url.searchParams.get("sessionId") ?? "");
      if (requested.length === 1) return parked(init);
      return json({ ok: true, value: { request: null } });
    }) as unknown as typeof fetch;

    const stop = startAgentOpens({
      getSessionId: () => session,
      subscribeSession: (listener) => {
        notify = listener;
        return () => {};
      },
      sink: { openFile: () => {}, openTab: () => {} },
      fetchImpl: impl,
      routeUrl,
      retryDelayMs: 5,
      minPollIntervalMs: 10,
    });

    await until(() => requested.length === 1);
    session = "s2";
    notify?.();
    await until(() => requested.length >= 2);
    expect(requested[0]).toBe("s1");
    expect(requested[1]).toBe("s2");
    stop();
  });

  loopTest("backs off on a transport failure instead of spinning", async () => {
    let attempts = 0;
    const impl = (async () => {
      attempts += 1;
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const errors: unknown[] = [];
    const stop = startAgentOpens({
      getSessionId: () => "s1",
      subscribeSession: () => () => {},
      sink: { openFile: () => {}, openTab: () => {} },
      fetchImpl: impl,
      routeUrl,
      retryDelayMs: 10,
      minPollIntervalMs: 10,
      onError: (error) => errors.push(error),
    });
    await until(() => errors.length >= 1);
    // With a 10ms first delay and doubling, two attempts inside ~120ms means it
    // is backing off rather than hot-looping.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(attempts).toBeLessThanOrEqual(6);
    stop();
  });

  loopTest("a throwing sink does not kill the loop", async () => {
    const errors: unknown[] = [];
    let opened = 0;
    const sink: OpenSink = {
      openFile: () => {
        opened += 1;
        throw new Error("tab type disabled");
      },
      openTab: () => {},
    };
    const { impl, calls } = fetchScript([
      () => json({ ok: true, value: { request: FILE_REQUEST } }),
      (init?: RequestInit) => parked(init),
    ]);
    const stop = startAgentOpens({
      getSessionId: () => "s1",
      subscribeSession: () => () => {},
      sink,
      fetchImpl: impl,
      routeUrl,
      retryDelayMs: 5,
      minPollIntervalMs: 10,
      onError: (error) => errors.push(error),
    });
    await until(() => opened > 0);
    expect(errors.map((error) => String(error))).toContain("Error: tab type disabled");
    await until(() => calls.length >= 2);
    stop();
  });

  loopTest("a throwing session accessor is reported, not fatal", async () => {
    // The accessor walks a service the host owns. One bad call must not kill the
    // poller for the rest of the page's life — and must not escape `apply()`.
    const errors: unknown[] = [];
    let notify: (() => void) | undefined;
    let session = "s1";
    const { impl, calls } = fetchScript([(init?: RequestInit) => parked(init)]);
    const stop = startAgentOpens({
      getSessionId: () => {
        if (session === "boom") throw new Error("no snapshot");
        return session;
      },
      subscribeSession: (listener) => {
        notify = listener;
        return () => {};
      },
      sink: { openFile: () => {}, openTab: () => {} },
      fetchImpl: impl,
      routeUrl,
      retryDelayMs: 5,
      minPollIntervalMs: 10,
      onError: (error) => errors.push(error),
    });

    await until(() => calls.length >= 1);
    session = "boom";
    notify?.();
    await until(() => errors.some((error) => String(error).includes("no snapshot")));
    expect(errors.map(String)).toContain("Error: no snapshot");
    stop();
  });

  loopTest("a throwing subscribeSession is reported, not fatal", async () => {
    const errors: unknown[] = [];
    const { impl, calls } = fetchScript([(init?: RequestInit) => parked(init)]);
    const stop = startAgentOpens({
      getSessionId: () => "s1",
      subscribeSession: () => {
        throw new Error("no subscribeState");
      },
      sink: { openFile: () => {}, openTab: () => {} },
      fetchImpl: impl,
      routeUrl,
      retryDelayMs: 5,
      minPollIntervalMs: 10,
      onError: (error) => errors.push(error),
    });
    await until(() => calls.length >= 1);
    expect(errors.map(String)).toContain("Error: no subscribeState");
    stop();
  });

  loopTest("dispose stops the loop and releases the parked poll", async () => {
    let settled = false;
    const impl = (async (_input: string | URL | Request, init?: RequestInit) => {
      try {
        return await parked(init);
      } finally {
        settled = true;
      }
    }) as unknown as typeof fetch;
    const stop = startAgentOpens({
      getSessionId: () => "s1",
      subscribeSession: () => () => {},
      sink: { openFile: () => {}, openTab: () => {} },
      fetchImpl: impl,
      routeUrl,
      retryDelayMs: 5,
      minPollIntervalMs: 10,
    });
    await until(() => !settled);
    stop();
    await until(() => settled);
    expect(settled).toBe(true);
  });
});
