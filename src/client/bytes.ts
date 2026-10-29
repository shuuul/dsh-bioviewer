/**
 * Byte transport for dsh-bioviewer.
 *
 * better-sidebar's `/sidebar/file` route streams a file's RAW bytes (it never
 * decompresses), so gzip handling is ours: fetch the bytes, then inflate them
 * with the platform's `DecompressionStream` — no dependency, no bundling of a
 * gunzip library into the client half.
 *
 * Route contract (verified against dsh-better-sidebar 0.28.x):
 *   GET `sidebar/file?sessionId=<id>&path=<path>[&cwd=<cwd>]`
 *   - resolved through `ctx.betterSidebar.hostRouteUrl()`; the path is RELATIVE
 *     and must not start with `/` (a leading slash would drop a reverse-proxy
 *     sub-path prefix);
 *   - `cwd` is the base for a relative `path` and is only meaningful when set,
 *     so it is sent only when provided (the route treats it as the session cwd
 *     override);
 *   - the route is GET-only (anything else is a 405) and answers non-2xx with
 *     `{ ok: false, error: { code, message } }` for failures such as a missing
 *     file;
 *   - the response body IS the file content, with no encoding applied.
 */

export interface BioBytes {
  readonly bytes: Uint8Array;
  /** True when the source file was `.gz` and {@link BioBytes.bytes} is inflated. */
  readonly gzip: boolean;
}

/** better-sidebar's raw-bytes route, relative to the host route base. */
const FILE_ROUTE = "sidebar/file";

/**
 * Re-types a byte view as `ArrayBuffer`-backed, which is what the DOM types
 * (`BlobPart`, `BodyInit`) accept since TS 5.7. Zero-copy for the ordinary case
 * (a view into an `ArrayBuffer`, byteOffset and length preserved); only a
 * `SharedArrayBuffer`-backed view is copied, since it cannot be a `BlobPart`.
 */
function asArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
}

/** Inflates a gzip stream using `DecompressionStream("gzip")`. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([asArrayBufferView(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface FetchBioBytesOptions {
  /** `ctx.betterSidebar.hostRouteUrl`: resolves a relative host route. */
  routeUrl: (path: string) => string;
  sessionId: string;
  /** Session-relative or absolute path of the file to read. */
  path: string;
  /** Base directory for a relative `path`; omitted from the URL when unset. */
  cwd?: string;
  /** Aborts the request (passed straight through to `fetch`). */
  signal?: AbortSignal;
  /** Injectable `fetch`, for tests and for hosts with a custom transport. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetches one file's bytes, inflating it when its name ends in `.gz`.
 *
 * Throws on a non-2xx response (with the status and a snippet of the error
 * body) and on undecodable gzip data; the caller surfaces that as the viewer's
 * error state.
 */
export async function fetchBioBytes(opts: FetchBioBytesOptions): Promise<BioBytes> {
  const { routeUrl, sessionId, path, cwd, signal, fetchImpl } = opts;
  const doFetch = fetchImpl ?? fetch;

  // URLSearchParams, not string concatenation: spaces, `#` and non-ASCII in
  // paths must be encoded or the route would read a truncated path.
  const params = new URLSearchParams({ sessionId, path });
  if (cwd !== undefined && cwd !== "") params.set("cwd", cwd);

  // `String()` because hostRouteUrl is typed as string in the service but
  // returns a URL object in some builds.
  const url = String(routeUrl(`${FILE_ROUTE}?${params.toString()}`));
  const response = await doFetch(url, { method: "GET", signal });

  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {
      // A body that cannot be read must not hide the status.
    }
    throw new Error(
      `dsh-bioviewer: reading "${path}" failed: HTTP ${response.status} ${response.statusText}` +
        (detail === "" ? "" : ` — ${detail}`),
    );
  }

  const raw = new Uint8Array(await response.arrayBuffer());
  const gzip = path.toLowerCase().endsWith(".gz");
  return { bytes: gzip ? await gunzip(raw) : raw, gzip };
}
