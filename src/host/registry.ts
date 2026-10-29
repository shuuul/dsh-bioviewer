/**
 * The host-side delivery registry behind `bio_open`.
 *
 * The tool runs on the host, the sidebar lives in the browser, and the two
 * halves are joined by a **long poll** (`GET /bioviewer/open?sessionId=…`)
 * rather than a WebSocket: an idle sidebar parks exactly one request instead
 * of holding a socket, and there is no upgrade handshake to get wrong behind a
 * reverse proxy. This class owns the host end of that wire.
 *
 * Two rules decide everything here:
 *
 * - **Consume once.** A request is handed to exactly one parked poll (or
 *   queued for the next one). Re-delivering would mint a second tab for one
 *   intent, and the sidebar's editor tab type has no per-path dedupe of its own.
 * - **Never park forever.** A poll that times out, is aborted by a
 *   disconnecting client, or is torn down with the plugin must leave no
 *   resolver behind — a leaked waiter would swallow the *next* open silently.
 *
 * @module dsh-bioviewer/host/registry
 */
import type { OpenRequest } from "../shared/opens";

/**
 * Cap on one session's queue of un-delivered opens.
 *
 * A session whose sidebar is never shown (an unattended run that keeps opening
 * files) would otherwise grow this array for the lifetime of the host process.
 * Past the cap the OLDEST queued opens are dropped, so the newest intent
 * survives and the order of what remains is still FIFO. 16 is deliberately
 * small: the queue exists for "the reader switched tabs for a minute", not as
 * a backlog.
 */
const QUEUE_MAX = 16;

/** One long poll parked on a session, plus its idempotent release. */
interface Waiter {
  /**
   * Deliver `request`, or end the wait with `null` (timeout / abort / dispose).
   *
   * @returns `true` when this call was the one that decided the outcome, and
   * `false` when the waiter had already been settled — the caller then knows
   * the value went nowhere.
   */
  settle(request: OpenRequest | null): boolean;
  /** Fulfilled by the first {@link Waiter.settle} call. */
  readonly promise: Promise<OpenRequest | null>;
}

/** Build one waiter: a promise whose resolver is reachable exactly once. */
function createWaiter(): Waiter {
  let resolve: (request: OpenRequest | null) => void = () => {};
  const promise = new Promise<OpenRequest | null>((settle) => {
    resolve = settle;
  });
  let settled = false;
  return {
    promise,
    settle(request: OpenRequest | null): boolean {
      // Both the timeout and an abort can fire before the other: the first
      // outcome wins and the promise must not be resolved twice.
      if (settled) return false;
      settled = true;
      resolve(request);
      return true;
    },
  };
}

/**
 * Per-session queue of pending opens plus the polls waiting for one.
 *
 * The two structures are one mechanism: `enqueue` hands the request straight
 * to the oldest parked poll when there is one (the sidebar is connected) and
 * only otherwise appends to the queue.
 */
export class OpenRegistry {
  private readonly queues = new Map<string, OpenRequest[]>();
  private readonly waiters = new Map<string, Waiter[]>();
  /** Set by {@link dispose}: every later call is a no-op instead of a leak. */
  private disposed = false;

  /**
   * Queue one open for a session, delivering it immediately when a poll is
   * already parked.
   *
   * @returns `delivered: true` when a parked poll took the request now (the
   * sidebar was connected); `false` when it was queued for the next poll.
   */
  enqueue(sessionId: string, request: OpenRequest): { delivered: boolean } {
    if (this.disposed) return { delivered: false };
    const parked = this.waiters.get(sessionId);
    if (parked !== undefined) {
      // A poll whose timeout or abort already fired is still listed until its
      // `finally` runs a microtask later. Handing it the request would report
      // `delivered: true` for an open nobody ever receives, so a waiter that
      // refuses the value is skipped and the request goes to the next one (or
      // to the queue).
      while (parked.length > 0) {
        const waiter = parked.shift();
        if (waiter === undefined) break;
        if (waiter.settle(request)) {
          if (parked.length === 0) this.waiters.delete(sessionId);
          return { delivered: true };
        }
      }
      this.waiters.delete(sessionId);
    }
    const queue = this.queues.get(sessionId) ?? [];
    queue.push(request);
    // Bounded per-session queue: drop the OLDEST pending opens past the cap.
    if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX);
    this.queues.set(sessionId, queue);
    return { delivered: false };
  }

  /**
   * Wait for the next open queued for a session.
   *
   * A request already queued resolves on the first microtask; otherwise the
   * call parks until `enqueue` hands one over, the timeout expires, or the
   * signal aborts (a disconnecting client). The waiter is released in a
   * `finally`, so no outcome can leave it parked.
   *
   * @param sessionId - the session whose sidebar is polling.
   * @param options - caller cancellation and the hold duration.
   * @returns the request, or `null` on timeout/abort/disposal.
   */
  async wait(
    sessionId: string,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<OpenRequest | null> {
    const queued = this.dequeue(sessionId);
    if (queued !== undefined) return queued;
    if (this.disposed || options.signal.aborted) return null;

    const waiter = createWaiter();
    const parked = this.waiters.get(sessionId) ?? [];
    parked.push(waiter);
    this.waiters.set(sessionId, parked);

    // `setTimeout` clamps a negative delay to 0, which is the right reading of
    // a caller asking for "no hold at all": answer from the queue or not at all.
    const timer = setTimeout(() => {
      waiter.settle(null);
    }, Math.max(0, options.timeoutMs));
    const onAbort = (): void => {
      waiter.settle(null);
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await waiter.promise;
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      this.forget(sessionId, waiter);
    }
  }

  /** Whether a poll is parked for this session right now. */
  hasWaiter(sessionId: string): boolean {
    const parked = this.waiters.get(sessionId);
    return parked !== undefined && parked.length > 0;
  }

  /**
   * Release every parked poll and drop every queue (plugin teardown).
   *
   * Parked polls resolve `null` so their route handlers answer and finish
   * instead of holding a response open past the plugin's lifetime.
   */
  dispose(): void {
    this.disposed = true;
    this.queues.clear();
    for (const parked of this.waiters.values()) {
      for (const waiter of parked) waiter.settle(null);
    }
    this.waiters.clear();
  }

  /** Take the oldest queued request for a session, if any. */
  private dequeue(sessionId: string): OpenRequest | undefined {
    const queue = this.queues.get(sessionId);
    if (queue === undefined) return undefined;
    const next = queue.shift();
    if (queue.length === 0) this.queues.delete(sessionId);
    return next;
  }

  /** Drop one waiter, wherever it currently sits in the session's list. */
  private forget(sessionId: string, waiter: Waiter): void {
    const parked = this.waiters.get(sessionId);
    if (parked === undefined) return;
    const at = parked.indexOf(waiter);
    if (at !== -1) parked.splice(at, 1);
    if (parked.length === 0) this.waiters.delete(sessionId);
  }
}
