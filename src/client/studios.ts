/**
 * Live MolStudio instances the agent can add objects into.
 *
 * Each BioViewer registers its studio on `onReady` and unregisters on unmount.
 * `bio_add` lands on the most recently registered studio for that session; if
 * none is up yet (the first object is still opening a tab), further adds wait
 * in a per-session queue and flush when the studio appears.
 *
 * @module dsh-bioviewer/client/studios
 */
import type { OpenRequest } from "../shared/opens";
import type { StudioLike } from "./load";

export interface StudioHandle {
  readonly studio: StudioLike;
  readonly sessionId: string;
  readonly reportError: (error: unknown) => void;
}

const bySession = new Map<string, StudioHandle[]>();
const opening = new Set<string>();
const pending = new Map<string, OpenRequest[]>();
let onReady: ((sessionId: string, handle: StudioHandle) => void) | undefined;

/** Called when a BioViewer studio becomes ready (used to flush queued adds). */
export function setStudioReadyHandler(
  handler: ((sessionId: string, handle: StudioHandle) => void) | undefined,
): void {
  onReady = handler;
}

/**
 * Track one live studio. The last registered studio for a session is the add
 * target. Returns a disposer that drops this handle only.
 */
export function registerStudio(
  sessionId: string,
  studio: StudioLike,
  reportError: (error: unknown) => void,
): () => void {
  const handle: StudioHandle = { studio, sessionId, reportError };
  const list = bySession.get(sessionId) ?? [];
  list.push(handle);
  bySession.set(sessionId, list);
  opening.delete(sessionId);
  onReady?.(sessionId, handle);
  return () => {
    const current = bySession.get(sessionId);
    if (current === undefined) return;
    const next = current.filter((entry) => entry !== handle);
    if (next.length === 0) bySession.delete(sessionId);
    else bySession.set(sessionId, next);
  };
}

/** The most recently registered studio for this session, if any. */
export function latestStudio(sessionId: string): StudioHandle | undefined {
  const list = bySession.get(sessionId);
  return list === undefined || list.length === 0 ? undefined : list[list.length - 1];
}

/** A tab that will host the first object is currently mounting. */
export function markOpening(sessionId: string): void {
  opening.add(sessionId);
}

export function isOpening(sessionId: string): boolean {
  return opening.has(sessionId);
}

/** Queue an add until the in-flight tab's studio registers. */
export function enqueuePending(sessionId: string, request: OpenRequest): void {
  const queue = pending.get(sessionId) ?? [];
  queue.push(request);
  pending.set(sessionId, queue);
}

/** Drain queued adds for a session. */
export function takePending(sessionId: string): OpenRequest[] {
  const queue = pending.get(sessionId) ?? [];
  pending.delete(sessionId);
  return queue;
}

/** Drop all session state. Tests call this between cases. */
export function resetStudios(): void {
  bySession.clear();
  opening.clear();
  pending.clear();
  onReady = undefined;
}
