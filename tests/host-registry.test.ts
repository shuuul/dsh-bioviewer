/**
 * Unit tests for the `bio_open` delivery registry.
 *
 * The registry is the one piece of the host half with real concurrency in it,
 * and every way it can go wrong is silent: a leaked waiter swallows the next
 * open, a re-delivered request mints a second tab, an unbounded queue grows for
 * the lifetime of the host process. All of it is testable without cordis, the
 * tool registry or a web server.
 */

import { describe, expect, test } from "bun:test";
import { OpenRegistry } from "../src/host/registry";
import type { OpenRequest } from "../src/shared/opens";

/** A queued open, tagged so ordering assertions stay readable. */
function open(id: string): OpenRequest {
  return { kind: "structure", source: "pdb", id, title: `PDB ${id}` };
}

/** An abort signal that never fires. */
function live(): AbortSignal {
  return new AbortController().signal;
}

/** The tag of a request built by {@link open}, for ordering assertions. */
function idOf(request: OpenRequest): string {
  if (request.kind !== "structure") throw new Error("the test only queues structure requests");
  return request.id;
}

describe("OpenRegistry.enqueue / wait", () => {
  test("hands a queued request to the next poll, exactly once", async () => {
    const registry = new OpenRegistry();
    expect(registry.enqueue("s1", open("1ABC"))).toEqual({ delivered: false });
    expect(await registry.wait("s1", { signal: live(), timeoutMs: 1_000 })).toEqual(open("1ABC"));
    // Consume-once: the same request must not reach a second poll.
    expect(await registry.wait("s1", { signal: live(), timeoutMs: 0 })).toBeNull();
  });

  test("reports delivered:true only when a poll is already parked", async () => {
    const registry = new OpenRegistry();
    expect(registry.hasWaiter("s1")).toBe(false);
    // Nothing is parked, so the open is queued rather than delivered.
    expect(registry.enqueue("s1", open("1ABC")).delivered).toBe(false);

    // The queue is consulted first, so this poll never parks.
    expect(await registry.wait("s1", { signal: live(), timeoutMs: 1_000 })).toEqual(open("1ABC"));

    const parked = registry.wait("s1", { signal: live(), timeoutMs: 1_000 });
    expect(registry.hasWaiter("s1")).toBe(true);
    expect(registry.enqueue("s1", open("2DEF")).delivered).toBe(true);
    expect(await parked).toEqual(open("2DEF"));
    expect(registry.hasWaiter("s1")).toBe(false);
  });

  test("delivers one request per parked poll, in order", async () => {
    const registry = new OpenRegistry();
    const first = registry.wait("s1", { signal: live(), timeoutMs: 1_000 });
    const second = registry.wait("s1", { signal: live(), timeoutMs: 1_000 });

    expect(registry.enqueue("s1", open("1ABC")).delivered).toBe(true);
    expect(registry.enqueue("s1", open("2DEF")).delivered).toBe(true);
    // Both polls are spent, so a third request waits for the next one.
    expect(registry.enqueue("s1", open("3GHI")).delivered).toBe(false);

    expect(await first).toEqual(open("1ABC"));
    expect(await second).toEqual(open("2DEF"));
    expect(await registry.wait("s1", { signal: live(), timeoutMs: 0 })).toEqual(open("3GHI"));
  });

  test("keeps sessions apart", async () => {
    const registry = new OpenRegistry();
    const parked = registry.wait("s1", { signal: live(), timeoutMs: 1_000 });
    expect(registry.enqueue("s2", open("2DEF")).delivered).toBe(false);
    expect(registry.hasWaiter("s2")).toBe(false);
    expect(registry.enqueue("s1", open("1ABC")).delivered).toBe(true);
    expect(await parked).toEqual(open("1ABC"));
  });

  test("resolves null on timeout and leaves no waiter behind", async () => {
    const registry = new OpenRegistry();
    expect(await registry.wait("s1", { signal: live(), timeoutMs: 5 })).toBeNull();
    expect(registry.hasWaiter("s1")).toBe(false);
    // The freed waiter must not swallow a later open: this one queues.
    expect(registry.enqueue("s1", open("1ABC")).delivered).toBe(false);
    expect(await registry.wait("s1", { signal: live(), timeoutMs: 0 })).toEqual(open("1ABC"));
  });

  test("resolves null on abort and leaves no waiter behind", async () => {
    const registry = new OpenRegistry();
    const controller = new AbortController();
    const parked = registry.wait("s1", { signal: controller.signal, timeoutMs: 1_000 });
    expect(registry.hasWaiter("s1")).toBe(true);
    controller.abort();
    expect(await parked).toBeNull();
    expect(registry.hasWaiter("s1")).toBe(false);
    expect(registry.enqueue("s1", open("1ABC")).delivered).toBe(false);
  });

  test("an already-aborted signal never parks a waiter", async () => {
    const registry = new OpenRegistry();
    const controller = new AbortController();
    controller.abort();
    expect(await registry.wait("s1", { signal: controller.signal, timeoutMs: 1_000 })).toBeNull();
    expect(registry.hasWaiter("s1")).toBe(false);
  });

  test("an aborted poll still takes a request that is already queued", async () => {
    // The queue is checked first on purpose: an open that arrived while the
    // client was switching sessions is delivered rather than dropped.
    const registry = new OpenRegistry();
    const controller = new AbortController();
    registry.enqueue("s1", open("1ABC"));
    controller.abort();
    expect(await registry.wait("s1", { signal: controller.signal, timeoutMs: 1_000 })).toEqual(open("1ABC"));
  });

  test("never hands a request to a waiter that already gave up", async () => {
    // The race: abort settles the waiter synchronously, but the waiter is only
    // unlisted by its `finally` a microtask later. An enqueue in that window
    // must not report the open as delivered — that would drop it silently.
    const registry = new OpenRegistry();
    const controller = new AbortController();
    const parked = registry.wait("s1", { signal: controller.signal, timeoutMs: 1_000 });
    controller.abort();
    expect(registry.enqueue("s1", open("1ABC"))).toEqual({ delivered: false });
    expect(await parked).toBeNull();
    expect(await registry.wait("s1", { signal: live(), timeoutMs: 0 })).toEqual(open("1ABC"));
  });
});

describe("OpenRegistry queue bound", () => {
  test("drops the oldest queued opens past the cap, keeping FIFO order", async () => {
    const registry = new OpenRegistry();
    const total = 40;
    for (let index = 0; index < total; index += 1) registry.enqueue("s1", open(String(index)));

    const drained: OpenRequest[] = [];
    for (;;) {
      const next = await registry.wait("s1", { signal: live(), timeoutMs: 0 });
      if (next === null) break;
      drained.push(next);
    }

    // Bounded: the oldest were dropped rather than kept for the host's lifetime.
    expect(drained.length).toBeGreaterThan(0);
    expect(drained.length).toBeLessThanOrEqual(16);
    expect(drained.length).toBeLessThan(total);
    // What remains is the NEWEST contiguous tail, still in FIFO order.
    expect(drained[drained.length - 1]).toEqual(open(String(total - 1)));
    const first = Number(idOf(drained[0]!));
    expect(first).toBe(total - drained.length);
    expect(drained.map(idOf).map(Number)).toEqual(drained.map((_, index) => first + index));
  });
});

describe("OpenRegistry.dispose", () => {
  test("settles parked polls with null instead of holding them open", async () => {
    const registry = new OpenRegistry();
    const parked = registry.wait("s1", { signal: live(), timeoutMs: 60_000 });
    registry.dispose();
    expect(await parked).toBeNull();
    expect(registry.hasWaiter("s1")).toBe(false);
  });

  test("drops the queue and refuses to park again", async () => {
    const registry = new OpenRegistry();
    registry.enqueue("s1", open("1ABC"));
    registry.dispose();
    expect(registry.enqueue("s1", open("2DEF"))).toEqual({ delivered: false });
    expect(await registry.wait("s1", { signal: live(), timeoutMs: 60_000 })).toBeNull();
    expect(registry.hasWaiter("s1")).toBe(false);
  });
});
