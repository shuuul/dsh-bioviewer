/**
 * Resolve one of **this plugin's own** host routes to an absolute URL.
 *
 * `ctx.betterSidebar.hostRouteUrl()` only knows better-sidebar's own `/sidebar/*`
 * routes, so it cannot help with ours (`/bioviewer/open`). The rule it
 * implements still applies, though, and this is the same rule (guide §6):
 *
 * - the route is always written **without a leading slash**, because a leading
 *   slash pins the request to the origin root and drops any sub-path the GUI is
 *   served under;
 * - the base is the desktop shell's injected transport base when present,
 *   otherwise the document base.
 *
 * Getting this wrong is invisible locally and breaks exactly the deployments
 * that are hardest to debug (a reverse proxy under `/some/prefix/`, or the
 * desktop shell's `dsh-app://app/`), which is why it lives in one place.
 */

/** The transport hint the desktop shell injects before the shell bundle runs. */
interface DshTransport {
  readonly streamBaseUrl?: unknown;
}

/**
 * The base every plugin-owned route resolves against.
 *
 * @param doc - document to read `baseURI` from; defaults to the live one.
 * @returns an absolute base URL, or `undefined` when there is nothing to use.
 */
export function transportBase(doc: Document | undefined = globalThis.document): string | undefined {
  const transport = (globalThis as { __DSH_TRANSPORT__?: DshTransport }).__DSH_TRANSPORT__;
  if (typeof transport?.streamBaseUrl === "string" && transport.streamBaseUrl !== "") {
    return transport.streamBaseUrl;
  }
  return doc?.baseURI ?? globalThis.location?.href;
}

/**
 * Absolute URL for one of this plugin's host routes.
 *
 * @param route - route without a leading slash, e.g. `bioviewer/open`.
 * @param doc - document to read the base from; defaults to the live one.
 * @throws when no base is available at all (no DOM, no location).
 */
export function pluginRouteUrl(route: string, doc?: Document): string {
  const base = transportBase(doc);
  if (base === undefined) throw new Error("dsh-bioviewer: no base URL available to resolve a host route");
  return new URL(route.replace(/^\/+/, ""), base).toString();
}
