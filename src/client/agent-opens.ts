/**
 * Client half of agent-triggered opening: the loop that receives an
 * `bio_open` request from the host and shows it.
 *
 * The transport is a **long poll** rather than a WebSocket. The host holds one
 * `GET bioviewer/open?sessionId=…` open until it has something to push (or its
 * ~25 s hold expires), so an idle sidebar costs one parked request instead of a
 * reconnect loop, and there is no upgrade handshake to get wrong behind a proxy.
 * Consume-once on the host side means a request reaches exactly one client, the
 * same guarantee better-sidebar's agent-open socket gives.
 *
 * The loop is scoped to the **active session**: an open queued for a sidebar the
 * reader has navigated away from is dropped rather than landing in the wrong
 * conversation, which is why a session change aborts the in-flight poll.
 *
 * @module dsh-bioviewer/client/agent-opens
 */
import { isOpenRequest, type OpenRequest } from "../shared/opens";
import { pluginRouteUrl } from "./transport";

/** Our host route, written without a leading slash (see `./transport.ts`). */
export const OPEN_ROUTE = "bioviewer/open";

/**
 * Descriptor id of the tab a database structure opens into. It is `hidden`
 * because it is only ever opened programmatically, never from the `+` menu.
 */
export const STRUCTURE_TAB_ID = "dsh-bioviewer:structure";

/**
 * The slice of the better-sidebar service this module drives.
 *
 * Structural on purpose: the poller is the part worth testing, and a fake sink
 * should not have to satisfy the whole service interface.
 */
export interface OpenSink {
  openFile(scope: { sessionId: string }, path: string, title?: string): void;
  openTab(seed: { type: string; path?: string; title?: string }, scope?: { sessionId: string }): void;
}

export interface PollOptions {
  readonly sessionId: string;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly routeUrl?: (route: string) => string;
}

/**
 * One long poll.
 *
 * @returns the queued request, or `null` when the host's hold expired with
 * nothing to push.
 * @throws on a transport failure or a non-`ok` envelope, so the caller can back
 * off instead of spinning.
 */
export async function pollOpenRequest(options: PollOptions): Promise<OpenRequest | null> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const routeUrl = options.routeUrl ?? pluginRouteUrl;

  const url = new URL(routeUrl(OPEN_ROUTE));
  url.searchParams.set("sessionId", options.sessionId);

  const response = await doFetch(url.toString(), {
    method: "GET",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!response.ok) {
    throw new Error(`dsh-bioviewer: the open poll failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as { ok?: unknown; value?: { request?: unknown } };
  if (body?.ok !== true) throw new Error("dsh-bioviewer: the open poll returned an error envelope");

  const request = body.value?.request;
  if (request === null || request === undefined) return null;
  if (!isOpenRequest(request)) {
    // The wire is ours, so this means a version skew between the two halves.
    // Dropping it beats throwing the poll loop into a retry storm.
    console.warn("[dsh-bioviewer] ignoring an open request with an unrecognised shape", request);
    return null;
  }
  return request;
}

/**
 * Show one request.
 *
 * A file opens in the editor pane, where our registered viewer takes over. A
 * database structure has no address to claim, so it opens our own tab with the
 * accession as its path seed — the component parses it back with the same
 * `parseOpenTarget` the tool used.
 */
export function dispatchOpen(sink: OpenSink, sessionId: string, request: OpenRequest): void {
  if (request.kind === "file") {
    sink.openFile({ sessionId }, request.path, request.title);
    return;
  }
  sink.openTab(
    { type: STRUCTURE_TAB_ID, path: `${request.source}:${request.id}`, title: request.title },
    { sessionId },
  );
}

/** An abortable delay. Resolves early — never rejects — when the signal fires. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface AgentOpenLoopOptions {
  /** The active session, or undefined while none is mounted. */
  readonly getSessionId: () => string | undefined;
  /** Subscribe to sidebar state changes (used to notice a session switch). */
  readonly subscribeSession: (listener: () => void) => () => void;
  readonly sink: OpenSink;
  readonly fetchImpl?: typeof fetch;
  readonly routeUrl?: (route: string) => string;
  /** Reports transport failures; the loop keeps running. */
  readonly onError?: (error: unknown) => void;
  readonly retryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  /**
   * Floor on the interval between polls.
   *
   * The host holds a poll open for ~25 s, so a normal idle loop makes roughly
   * two requests a minute. But nothing enforces that: a proxy that buffers or
   * terminates the response early, or any future change to the host's hold,
   * would turn this loop into a hot request storm. This floor bounds the request
   * rate regardless of how fast the host answers.
   */
  readonly minPollIntervalMs?: number;
}

/**
 * Start receiving agent opens.
 *
 * @returns a disposer that stops the loop and releases the in-flight poll.
 */
export function startAgentOpens(options: AgentOpenLoopOptions): () => void {
  const retryDelay = options.retryDelayMs ?? 1_000;
  const maxRetryDelay = options.maxRetryDelayMs ?? 15_000;
  const minPollInterval = options.minPollIntervalMs ?? 250;
  const stopped = new AbortController();

  // Reading the session id must never throw out of the loop: the accessor walks
  // a service the host owns, and one bad call would otherwise kill the poller
  // for the rest of the page's life.
  const readSessionId = (): string | undefined => {
    try {
      return options.getSessionId();
    } catch (error) {
      options.onError?.(error);
      return undefined;
    }
  };

  let sessionId = readSessionId();
  let inFlight: AbortController | undefined;

  // Held as `unknown`: `subscribeSession` comes from the host, and a value that
  // is not a disposer must not turn teardown into a throw — by then `apply()`
  // and every other registration have already succeeded.
  let unsubscribe: unknown = () => {};
  try {
    unsubscribe = options.subscribeSession(() => {
      const next = readSessionId();
      if (next === sessionId) return;
      sessionId = next;
      // Drop the poll for the session we just left: its answer would open a file
      // in a conversation the reader is no longer looking at.
      inFlight?.abort();
    });
  } catch (error) {
    options.onError?.(error);
  }

  void (async () => {
    let backoff = 0;
    while (!stopped.signal.aborted) {
      const current = sessionId;
      if (current === undefined) {
        await sleep(retryDelay, stopped.signal);
        continue;
      }

      const controller = new AbortController();
      inFlight = controller;
      const stopInFlight = (): void => {
        controller.abort();
      };
      stopped.signal.addEventListener("abort", stopInFlight, { once: true });

      try {
        const startedAt = Date.now();
        const request = await pollOpenRequest({
          sessionId: current,
          signal: controller.signal,
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
          ...(options.routeUrl === undefined ? {} : { routeUrl: options.routeUrl }),
        });
        backoff = 0;
        if (request !== null) {
          try {
            dispatchOpen(options.sink, current, request);
          } catch (error) {
            // A disabled tab type or a removed file must not kill the loop.
            options.onError?.(error);
          }
        } else {
          // Hold the floor only when the host answered without holding, so a
          // normal long poll is not delayed.
          const elapsed = Date.now() - startedAt;
          if (elapsed < minPollInterval) await sleep(minPollInterval - elapsed, stopped.signal);
        }
      } catch (error) {
        if (stopped.signal.aborted) return;
        // A session switch aborted this poll on purpose; re-poll immediately.
        if (controller.signal.aborted) continue;
        backoff = backoff === 0 ? retryDelay : Math.min(backoff * 2, maxRetryDelay);
        options.onError?.(error);
        await sleep(backoff, stopped.signal);
      } finally {
        stopped.signal.removeEventListener("abort", stopInFlight);
        if (inFlight === controller) inFlight = undefined;
      }
    }
  })();

  return () => {
    if (typeof unsubscribe === "function") (unsubscribe as () => void)();
    stopped.abort();
  };
}
