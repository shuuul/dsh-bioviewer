/**
 * Pure workspace helpers for the BioViewer sidebar tab.
 *
 * Everything here is framework-free (no React, no DSH imports) so it can be
 * unit-tested directly; {@link ./browser.tsx} owns the rendering and the
 * lifecycle. The only project dependency is the shared format table, used to
 * decide which names are bio files.
 *
 * Wire contract (verified against dsh-better-sidebar 0.28.2,
 * `lib/types/client/api.d.ts` + `src/index.ts`):
 *
 * - `POST sidebar/api/fs.trees` with `{ sessionId, cwd?, paths: string[] }`
 *   (max 64 paths) answers `{ ok: true, value: { levels: FsLevel[] } }` where
 *   one level is `{ path, entries: FsEntry[], truncated, error? }`. A level
 *   that failed carries `error` IN PLACE (with `entries: []`) while the batch
 *   itself still succeeds — that is a per-level error, not a thrown one.
 * - `POST sidebar/api/session.cwd` answers
 *   `{ ok: true, value: { sessionId, cwd, root, parent } }`; `root` is a
 *   display LABEL (`rootLabel(cwd)` = basename), not a path, so only `cwd` is
 *   usable as a directory anchor.
 * - An envelope-level failure is `{ ok: false, error: { code, message } }`
 *   and becomes a thrown {@link WorkspaceApiError} carrying the wire code.
 * - Routes are resolved through `ctx.betterSidebar.hostRouteUrl(...)` with a
 *   RELATIVE path (no leading slash) so a reverse-proxy prefix survives.
 */

import { isBioFile } from "../shared/formats";

/** One row of a directory listing, reduced to what this page needs. */
export interface BioTreeEntry {
  path: string;
  name: string;
  isDir: boolean;
}

/** One directory level: its rows, whether the host capped them, and a per-level failure. */
export interface TreeLevelResult {
  entries: BioTreeEntry[];
  truncated: boolean;
  /** Present only when THIS level failed; the batch request itself succeeded. */
  error?: string;
}

/** One wire failure, mirroring the host's `{ ok: false, error: { code, message } }`. */
export class WorkspaceApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkspaceApiError";
    this.code = code;
  }
}

/** The host's JSON envelope. */
interface SidebarEnvelope<T> {
  ok?: boolean;
  value?: T;
  error?: { code?: string; message?: string };
}

/** One `FsEntry` as it arrives on the wire (verified shape, fields optional here). */
interface WireFsEntry {
  name?: unknown;
  path?: unknown;
  isDir?: unknown;
}

/** One `FsLevel` as it arrives on the wire. */
interface WireFsLevel {
  path?: unknown;
  entries?: unknown;
  truncated?: unknown;
  error?: unknown;
}

/** What {@link fetchTreeLevel} needs to issue one `fs.trees` call. */
export interface FetchTreeLevelOptions {
  /**
   * Resolve one host route to a fetchable URL — `ctx.betterSidebar.hostRouteUrl`.
   * The relative route (`sidebar/api/fs.trees`, NO leading slash) is passed in.
   */
  routeUrl: (path: string) => string;
  sessionId: string;
  /** The session's cwd from the client summary; omitted while it is unknown. */
  cwd?: string;
  /** Directory to list: absolute, or session-relative (the host resolves it). */
  path: string;
  /** Injectable fetch, for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** What {@link fetchSessionCwd} needs to issue one `session.cwd` call. */
export interface FetchSessionCwdOptions {
  routeUrl: (path: string) => string;
  sessionId: string;
  cwd?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** The authoritative session directory, as `session.cwd` answers it. */
export interface SessionCwdInfo {
  sessionId: string;
  /** Absolute session working directory. */
  cwd: string;
  /** Display label of the workspace root (basename, NOT a path). */
  root: string;
  parent: string | null;
}

/** True for the DOMException `fetch` raises when its `AbortSignal` fires. */
function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * POST one JSON request to the sidebar API and unwrap its `{ ok, value }`
 * envelope. An envelope-level failure throws {@link WorkspaceApiError} with
 * the wire code (`http` when the response was not JSON at all); an abort is
 * rethrown untouched so callers can tell a cancelled request from a failure.
 */
async function postSidebarApi<T>(options: {
  routeUrl: (path: string) => string;
  method: string;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<T> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = options.routeUrl(`sidebar/api/${options.method}`);
  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options.payload),
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new WorkspaceApiError(
      "network",
      error instanceof Error ? error.message : String(error),
    );
  }
  const parsed = (await response
    .json()
    .catch(() => null)) as SidebarEnvelope<T> | null;
  if (
    !response.ok ||
    parsed === null ||
    parsed.ok !== true ||
    parsed.value === undefined
  ) {
    throw new WorkspaceApiError(
      parsed?.error?.code ?? "http",
      parsed?.error?.message ?? `HTTP ${response.status}`,
    );
  }
  return parsed.value;
}

/** The last `/`- or `\`-separated segment of a path (the path itself if none). */
function baseNameOf(path: string): string {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at === -1 ? path : path.slice(at + 1);
}

/** Path segments, ignoring separators and empty runs (`/a//b/` -> 2). */
function segmentCount(path: string): number {
  let count = 0;
  let inSegment = false;
  for (const char of path) {
    const separator = char === "/" || char === "\\";
    if (separator) inSegment = false;
    else if (!inSegment) {
      inSegment = true;
      count += 1;
    }
  }
  return count;
}

/** One wire row, normalized; `undefined` when the row is not usable. */
function toTreeEntry(value: unknown): BioTreeEntry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const row = value as WireFsEntry;
  if (typeof row.path !== "string" || row.path === "") return undefined;
  const name =
    typeof row.name === "string" && row.name !== ""
      ? row.name
      : baseNameOf(row.path);
  return { path: row.path, name, isDir: row.isDir === true };
}

/** Deterministic code-unit path order (locale-independent, like BIO_EXTENSIONS). */
function comparePath(a: BioTreeEntry, b: BioTreeEntry): number {
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

/**
 * Filter a listing down to its bio files, in deterministic `path` ascending
 * order.
 *
 * - Directories are dropped; a file qualifies when its `name` passes
 *   `isBioFile` (case-insensitive, `.gz` variants included).
 * - `maxDepth` bounds how deep below the listing's top level a file may sit.
 *   Depth is measured from the SHALLOWEST entry in `entries` (the top row of
 *   the provided listing): rows at that level are depth 0, one directory
 *   deeper is depth 1, and so on. `maxDepth` omitted (or not finite) means
 *   "no limit", so a flat single-level listing is unaffected either way.
 * - Duplicate paths are collapsed (first occurrence wins), which makes it safe
 *   to merge overlapping levels of a tree walk.
 */
export function collectBioFiles(
  entries: readonly BioTreeEntry[],
  maxDepth?: number,
): BioTreeEntry[] {
  if (entries.length === 0) return [];
  let base = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const depth = segmentCount(entry.path);
    if (depth < base) base = depth;
  }
  const limit =
    maxDepth === undefined || !Number.isFinite(maxDepth)
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.trunc(maxDepth));
  const seen = new Set<string>();
  const files: BioTreeEntry[] = [];
  for (const entry of entries) {
    if (entry.isDir === true) continue;
    if (!isBioFile(entry.name)) continue;
    if (segmentCount(entry.path) - base > limit) continue;
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    files.push(entry);
  }
  return files.sort(comparePath);
}

/**
 * List ONE directory level through the batch route (`fs.trees`, one path).
 *
 * Returns the level's rows plus its `truncated` flag; a level the host could
 * not read comes back as `{ entries: [], truncated: false, error }` (that is
 * how the batch route reports a failure in place). An envelope-level failure,
 * a malformed payload, or a network error throws {@link WorkspaceApiError};
 * an aborted request rethrows the abort untouched.
 */
export async function fetchTreeLevel(
  options: FetchTreeLevelOptions,
): Promise<TreeLevelResult> {
  const payload: Record<string, unknown> = {
    sessionId: options.sessionId,
    paths: [options.path],
  };
  if (options.cwd !== undefined && options.cwd !== "")
    payload.cwd = options.cwd;
  const value = await postSidebarApi<{ levels?: unknown }>({
    routeUrl: options.routeUrl,
    method: "fs.trees",
    payload,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  });
  const levels = value?.levels;
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new WorkspaceApiError(
      "bad-response",
      "fs.trees answered without a level for the requested path",
    );
  }
  const level = levels[0] as WireFsLevel | undefined;
  if (typeof level !== "object" || level === null) {
    throw new WorkspaceApiError(
      "bad-response",
      "fs.trees answered with a malformed level",
    );
  }
  const rawEntries = Array.isArray(level.entries) ? level.entries : [];
  const entries: BioTreeEntry[] = [];
  for (const raw of rawEntries) {
    const entry = toTreeEntry(raw);
    if (entry !== undefined) entries.push(entry);
  }
  const result: TreeLevelResult = {
    entries,
    truncated: level.truncated === true,
  };
  if (typeof level.error === "string" && level.error !== "")
    result.error = level.error;
  return result;
}

/**
 * Resolve the session's authoritative working directory (`session.cwd`), used
 * as the page's root when the scope carries no cwd yet. Only `cwd` is a path —
 * `root` is the host's display label for the workspace root.
 */
export async function fetchSessionCwd(
  options: FetchSessionCwdOptions,
): Promise<SessionCwdInfo> {
  const payload: Record<string, unknown> = { sessionId: options.sessionId };
  if (options.cwd !== undefined && options.cwd !== "")
    payload.cwd = options.cwd;
  const value = await postSidebarApi<Partial<SessionCwdInfo>>({
    routeUrl: options.routeUrl,
    method: "session.cwd",
    payload,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  });
  const cwd = value?.cwd;
  if (typeof cwd !== "string" || cwd === "") {
    throw new WorkspaceApiError(
      "bad-response",
      "session.cwd answered without a working directory",
    );
  }
  return {
    sessionId:
      typeof value?.sessionId === "string"
        ? value.sessionId
        : options.sessionId,
    cwd,
    root: typeof value?.root === "string" ? value.root : "",
    parent: typeof value?.parent === "string" ? value.parent : null,
  };
}

/**
 * The parent directory of `path`, for the "go up" control. Terminates at the
 * root: `""`, `"/"`, `"\\"` and single-segment relative names all answer
 * `undefined` (no parent to navigate to), while `"/a"` answers `"/"`.
 * Trailing separators are ignored (`"/a/b/"` -> `"/a"`).
 */
export function parentPath(path: string): string | undefined {
  let trimmed = path;
  while (
    trimmed.length > 1 &&
    (trimmed.endsWith("/") || trimmed.endsWith("\\"))
  ) {
    trimmed = trimmed.slice(0, -1);
  }
  if (trimmed === "" || trimmed === "/" || trimmed === "\\") return undefined;
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (at < 0) return undefined;
  return at === 0 ? trimmed.slice(0, 1) : trimmed.slice(0, at);
}

/** One request's slot in a {@link RequestGate}. */
export interface GateTicket {
  /** Fires as soon as a newer request starts, or the gate is cancelled. */
  readonly signal: AbortSignal;
  /**
   * True once this ticket is no longer the newest one (a newer request began,
   * or the gate was cancelled). A late result must be dropped, not published.
   */
  stale(): boolean;
}

/**
 * "Latest request wins" gate for the directory listing: at most one request is
 * in flight, starting a new one aborts the previous one, and every ticket can
 * tell whether its result is still wanted. Keeping this out of React makes the
 * overlap/staleness rule unit-testable without a DOM.
 */
export class RequestGate {
  private seq = 0;
  private active: { id: number; controller: AbortController } | null = null;

  /** Start a request: abort the previous one and hand back its own ticket. */
  begin(): GateTicket {
    this.active?.controller.abort();
    const id = ++this.seq;
    const controller = new AbortController();
    this.active = { id, controller };
    return {
      signal: controller.signal,
      stale: () => this.active === null || this.active.id !== id,
    };
  }

  /** Abort whatever is in flight (tab hidden, directory changed, unmount). */
  cancel(): void {
    this.active?.controller.abort();
    this.active = null;
  }
}
