/**
 * The host route the sidebar long-polls for `bio_open` requests.
 *
 * One fenced `GET /bioviewer/open?sessionId=…` is held open for
 * {@link OPEN_HOLD_MS} and answered with the next request queued for that
 * session, or with `null` when the hold expires. The response envelope is
 * better-sidebar's (`{ ok: true, value }` / `{ ok: false, error }`), and so is
 * the auth fence: `ctx.connection.requestRejection(req) === undefined` is the
 * only thing that admits a request, because Host/Origin and browser
 * authentication are the host's decision, never a plugin's
 * (`node_modules/dsh-better-sidebar/src/index.ts:1411`).
 *
 * The route is registered without a leading-slash URL on the client side (see
 * `src/client/transport.ts`) so it survives a reverse proxy that mounts the GUI
 * under a sub-path; the path here is the host-side half of that contract.
 *
 * @module dsh-bioviewer/host/route
 */
import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage, ServerResponse } from "node:http";
// Type-only: brings in the `ctx.webServer` augmentation (a host package, erased
// at build time — the plugin never value-imports it).
import type {} from "@deepseek-ai/dsh-host-webserver";
import type { OpenRegistry } from "./registry";

/** Absolute pathname of the poll route (no trailing slash). */
export const OPEN_ROUTE_PATH = "/bioviewer/open";

/**
 * How long one poll is held before it answers `null`.
 *
 * Short enough that a proxy's idle timeout is never the thing that ends the
 * request, long enough that an idle sidebar costs a few requests per minute
 * instead of a spin loop. The client re-polls immediately on `null`.
 */
export const OPEN_HOLD_MS = 25_000;

/**
 * The host request-admission face this route fences against.
 *
 * Structural, and declared locally on purpose: the service is provided by the
 * host's connection layer, and no installed `@deepseek-ai/*` package augments
 * `ctx` with it, so there is no type to import. This mirrors better-sidebar's
 * own structural declaration
 * (`dsh-better-sidebar/src/context-types.ts:120-123`).
 */
interface ConnectionFace {
  requestRejection(request: { headers: Record<string, string | string[] | undefined> }): 401 | 403 | undefined;
}

/** The failure envelope every rejection answers with. */
function errorBody(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}

/** Write one JSON response, or tear the socket down if it is already committed. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  // A response that already went out cannot carry an envelope: `writeHead` would
  // throw ERR_HTTP_HEADERS_SENT and turn a harmless disconnect into a route
  // crash. Same guard as better-sidebar's `writeJson` (src/wire.ts:119-132).
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

/**
 * Register the long-poll route.
 *
 * A host without a web server (a stripped-down composition) is logged and
 * skipped rather than thrown at, so the plugin's other half still mounts.
 *
 * @param ctx - host plugin context (carries `webServer` and `connection`).
 * @param registry - the open-request registry the poll waits on.
 * @returns a disposer that removes the route.
 */
export function registerOpenRoute(ctx: Context, registry: OpenRegistry): () => void {
  const webServer = ctx.get("webServer");
  if (webServer === undefined) {
    ctx.logger.warn(
      `[dsh-bioviewer] no web server on this host; the ${OPEN_ROUTE_PATH} route is not registered`,
    );
    return () => {};
  }

  return webServer.register({
    kind: "prefix",
    path: OPEN_ROUTE_PATH,
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      // Fence FIRST, before the method, the URL or anything else is read: an
      // unfenced route is reachable by any page that can reach the port. A host
      // that cannot answer the policy question cannot admit the request either.
      const connection = ctx.get("connection") as ConnectionFace | undefined;
      const rejection = connection === undefined ? 403 : connection.requestRejection(req);
      if (rejection !== undefined) {
        writeJson(res, 403, errorBody("forbidden", "forbidden"));
        return;
      }

      if (req.method !== "GET") {
        writeJson(res, 405, errorBody("method-error", "method not allowed"));
        return;
      }

      const url = new URL(req.url ?? "/", "http://dsh.internal");
      // `kind: 'prefix'` also matches `/bioviewer/open/<anything>`; only the
      // route itself is a poll, so anything deeper is not found rather than
      // silently parked on the same queue.
      if (url.pathname.replace(/\/+$/, "") !== OPEN_ROUTE_PATH) {
        writeJson(res, 404, errorBody("not-found", "unknown route"));
        return;
      }

      const sessionId = url.searchParams.get("sessionId");
      if (sessionId === null || sessionId === "") {
        writeJson(res, 400, errorBody("bad-request", "sessionId is required"));
        return;
      }

      // A reader who navigates away (or switches session) aborts the poll: the
      // `close` event must free the parked waiter immediately instead of
      // leaving it to swallow the next open for this session.
      const controller = new AbortController();
      let closed = false;
      const onClose = (): void => {
        closed = true;
        controller.abort();
      };
      res.once("close", onClose);
      try {
        const request = await registry.wait(sessionId, {
          signal: controller.signal,
          timeoutMs: OPEN_HOLD_MS,
        });
        // Nobody is listening on a closed response; answering would write into
        // a destroyed socket for no reader.
        if (closed) return;
        writeJson(res, 200, { ok: true, value: { request } });
      } finally {
        res.off("close", onClose);
      }
    },
  });
}
