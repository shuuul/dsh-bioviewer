/**
 * Client half of dsh-bioviewer.
 *
 * It is a pure **consumer** of the third-party `dsh-better-sidebar` service: it
 * registers one file viewer per biomolecular format plus a "BioViewer" tab, and
 * owns no state of its own. Everything the host needs is in the descriptors.
 *
 * Two host behaviours shape the design, both read out of the installed
 * `dsh-better-sidebar@0.28.2` rather than assumed:
 *
 * 1. `matchFileViewer` compares a descriptor's `exts` against `extOf(path)`,
 *    which is the **last** dot segment (`src/client/paths.ts`). A `.gz` file's
 *    extension is therefore literally `gz`, so a `"pdb.gz"` entry can never
 *    match. Compressed files are routed by a separate sniff-only catch-all
 *    (`exts: []` + `detect`), which the host consults only after it has head
 *    bytes for a binary file (guide §5.4).
 * 2. With `fetchStrategy: 'custom'` the host never reads the file itself: it
 *    calls our `load(path, scope, signal)` and renders the component with the
 *    resolved value. That single fetch point is what makes the host's automatic
 *    reload after a successful `write`/`edit` work, and it is where the
 *    `AbortSignal` arrives.
 *
 * @module dsh-bioviewer/client
 */
import { createElement, type ReactNode } from "react";
import type { Context } from "@deepseek-ai/cordis";
// Type-only: pulls in the `ctx.betterSidebar` module augmentation without
// creating a runtime dependency on the plugin (see the guide §2.1/§2.3).
import type {} from "dsh-better-sidebar/client/service";
import studioStyles from "@molstudio/react/styles.css";
import noticeStyles from "./notices.css";

import { BIO_FORMATS, detectBioFile, type BioFormat } from "../shared/formats";
import { startAgentOpens, STRUCTURE_TAB_ID } from "./agent-opens";
import { fetchBioBytes } from "./bytes";
import { BioBrowser } from "./browser";
import { parseCmmMarkerSets } from "./cmm";
import { formatLabel, t } from "./copy";
import { BioFileView, StructureTabView } from "./file-view";
import { BioViewerIcon } from "./icons";
import { activeLocale } from "./locale";
import type { BioViewerPayload, MarkersPayload, ViewerPayload } from "./payload";

/**
 * No hard service dependency: better-sidebar is an *optional* peer, so the
 * plugin must activate (and stay quiet) on a host that does not have it.
 * {@link apply} waits for the service with `ctx.inject` instead, which starts
 * registration the moment the service appears and never blocks this plugin.
 */
export const inject: readonly string[] = [];

/** Every viewer id is namespaced; better-sidebar throws on a duplicate id. */
const ID_PREFIX = "dsh-bioviewer";
/** Descriptor ids that must stay unique across the whole registry. */
const TAB_ID = `${ID_PREFIX}:browser`;
const GZIP_VIEWER_ID = `${ID_PREFIX}:gzip`;
/** Above the built-ins (markdown/html = 0, code = -100) so our sniff gets a turn first. */
const GZIP_VIEWER_PRIORITY = 10;

/**
 * Id of the style element this module owns.
 *
 * It must stay distinct from every other style element the plugin injects:
 * `./browser.tsx` owns its own sheet and uses the same "create it if it is not
 * there yet" pattern, so a shared id would make whichever runs second silently
 * inject nothing. `tests/style-ids.test.ts` pins the uniqueness.
 */
const STYLE_ELEMENT_ID = "dsh-bioviewer-core-styles";

/**
 * Mints the per-tab id for the structure tab. Tab ids only have to be unique
 * within one session's sidebar state, so a monotonic counter is enough; it never
 * needs to survive a reload (a reopened tab gets a fresh id).
 */
let structureTabSeq = 0;

/**
 * Inline the stylesheets this plugin needs. The bundle is one script with no
 * asset route, so CSS travels as a string and is injected from inside the module
 * body — and it is injected from `apply()` rather than at module scope so the
 * disposer below is tied to the plugin fiber (module-scope injection runs at
 * materialization, before any fiber exists, and could never be removed).
 *
 * @returns a disposer that removes the element, but only if we created it.
 */
function injectStyles(): () => void {
  if (typeof document === "undefined") return () => {};
  if (document.getElementById(STYLE_ELEMENT_ID) !== null) return () => {};
  const element = document.createElement("style");
  element.id = STYLE_ELEMENT_ID;
  element.dataset["dshBioviewer"] = "";
  element.textContent = `${studioStyles}\n${noticeStyles}`;
  document.head.append(element);
  return () => {
    element.remove();
  };
}

/** The last path segment, for a tab/object title. */
function baseName(path: string): string {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at === -1 ? path : path.slice(at + 1);
}

/**
 * Resolve a better-sidebar host route.
 *
 * A leading slash would pin the request to the origin root and break reverse
 * proxies that mount the GUI under a sub-path, so the route is always relative.
 * `hostRouteUrl` is the supported resolver (guide §6); the `document.baseURI`
 * fallback only matters on a better-sidebar too old to have it.
 */
function routeResolver(ctx: Context): (route: string) => string {
  const service = ctx.betterSidebar;
  if (typeof service?.hostRouteUrl === "function") return (route) => service.hostRouteUrl(route);
  return (route) => new URL(route.replace(/^\/+/, ""), document.baseURI).toString();
}

/** Read one file's raw bytes through the host's media route. */
function readBytes(
  ctx: Context,
  path: string,
  scope: { sessionId: string; cwd?: string },
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; gzip: boolean }> {
  return fetchBioBytes({
    routeUrl: routeResolver(ctx),
    sessionId: scope.sessionId,
    path,
    ...(scope.cwd === undefined ? {} : { cwd: scope.cwd }),
    ...(signal === undefined ? {} : { signal }),
  });
}

/** Read one bio file and hand it to the Mol* viewer. */
async function loadBioPayload(
  ctx: Context,
  fallback: BioFormat,
  path: string,
  scope: { sessionId: string; cwd?: string },
  signal?: AbortSignal,
): Promise<BioViewerPayload> {
  const format = detectBioFile(path)?.format ?? fallback;
  const { bytes, gzip } = await readBytes(ctx, path, scope, signal);
  return { kind: "bytes", path, title: baseName(path), format, bytes, gzip };
}

/**
 * Read one marker model.
 *
 * Parsing happens here rather than in the component so a malformed `.cmm` fails
 * through the host's normal error path, and so the payload stays plain data.
 * The parsed sets go to MolStudio's own `loadMarkers`, which draws them as
 * spheres and tubes beside whatever else is loaded — the point of a marker
 * model is to sit over a map, not to replace it.
 */
async function loadMarkerPayload(
  ctx: Context,
  path: string,
  scope: { sessionId: string; cwd?: string },
  signal?: AbortSignal,
): Promise<MarkersPayload> {
  const { bytes, gzip } = await readBytes(ctx, path, scope, signal);
  const title = baseName(path);
  return {
    kind: "markers",
    path,
    title,
    sets: parseCmmMarkerSets(new TextDecoder().decode(bytes), title),
    gzip,
  };
}

/**
 * True when `head` really starts a gzip stream. A `.gz` name whose bytes are
 * not gzip is left to the text viewer instead of failing inside the decoder.
 */
function looksGzipped(head: Uint8Array): boolean {
  return head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
}

/** Register the viewers, the compressed-file sniffer and the browser tab. */
function registerAll(ctx: Context): void {
  ctx.effect(() => injectStyles(), "dsh-bioviewer: viewer styles");

  for (const format of BIO_FORMATS) {
    // Marker models (`.cmm`) take the same path as everything else now: parsed
    // into MolStudio's `MarkerSet` and drawn by `loadMarkers`. Only the loader
    // differs, because a marker model is data for a shape node rather than a
    // structure or a volume.
    const markers = format.kind === "markers";

    ctx.effect(
      () =>
        ctx.betterSidebar.registerFileViewer({
          id: `${ID_PREFIX}:${format.id}`,
          title: () => formatLabel(activeLocale(), format.id, format.label),
          icon: (size: number) => createElement(BioViewerIcon, { size }),
          exts: format.exts,
          fetchStrategy: "custom",
          load: (path, scope, signal) =>
            markers
              ? loadMarkerPayload(ctx, path, scope, signal)
              : loadBioPayload(ctx, format, path, scope, signal),
          // Every payload variant carries a `kind`, so one component serves all
          // of them and `BioViewer` narrows the union.
          component: ({ customData, path }) =>
            createElement(BioFileView, { payload: customData as ViewerPayload | undefined, path }),
        }),
      `dsh-bioviewer: ${format.id} viewer`,
    );
  }

  // Sniff-only catch-all for compressed bio files. `exts: []` makes the host
  // treat it as a pure sniffer: it yields while no head bytes exist (so it never
  // blind-claims every `.gz` in the workspace) and is only consulted on the
  // binary re-match, where `detect` sees the magic bytes.
  ctx.effect(
    () =>
      ctx.betterSidebar.registerFileViewer({
        id: GZIP_VIEWER_ID,
        title: () => t(activeLocale(), "tab.gzip"),
        icon: (size: number) => createElement(BioViewerIcon, { size }),
        exts: [],
        priority: GZIP_VIEWER_PRIORITY,
        fetchStrategy: "custom",
        detect: (path, head) => {
          const detected = detectBioFile(path);
          return detected !== undefined && detected.gzip && looksGzipped(head);
        },
        load: (path, scope, signal) => {
          const format = detectBioFile(path)?.format;
          if (format === undefined) throw new Error(`dsh-bioviewer: unsupported file "${path}"`);
          return format.kind === "markers"
            ? loadMarkerPayload(ctx, path, scope, signal)
            : loadBioPayload(ctx, format, path, scope, signal);
        },
        component: ({ customData, path }) =>
          createElement(BioFileView, { payload: customData as ViewerPayload | undefined, path }),
      }),
    "dsh-bioviewer: compressed viewer",
  );

  ctx.effect(
    () =>
      ctx.betterSidebar.registerTab({
        id: TAB_ID,
        title: () => t(activeLocale(), "tab.browser"),
        description: () => t(activeLocale(), "tab.browserDescription"),
        icon: (size: number) => createElement(BioViewerIcon, { size }),
        order: 45,
        single: true,
        component: ({ ctx: tabCtx, scope, visible }): ReactNode =>
          createElement(BioBrowser, { ctx: tabCtx, scope, visible }),
      }),
    "dsh-bioviewer: browser tab",
  );

  // Where an agent-opened database structure lands. It is `hidden` because it is
  // only ever opened programmatically, and it declares `createTab` because the
  // native surface otherwise focuses an existing tab of the same type — which
  // would make a second structure replace the first instead of opening beside it.
  ctx.effect(
    () =>
      ctx.betterSidebar.registerTab({
        id: STRUCTURE_TAB_ID,
        title: () => t(activeLocale(), "tab.structure"),
        icon: (size: number) => createElement(BioViewerIcon, { size }),
        hidden: true,
        createTab: () => {
          structureTabSeq += 1;
          return {
            tab: {
              id: `${STRUCTURE_TAB_ID}:${structureTabSeq}`,
              type: STRUCTURE_TAB_ID,
              title: t(activeLocale(), "tab.structure"),
            },
          };
        },
        component: ({ tab }): ReactNode => createElement(StructureTabView, { path: tab.path }),
      }),
    "dsh-bioviewer: structure tab",
  );

  // Receive `bio_open` requests from the host half. Long-poll, so an idle
  // sidebar parks a single request rather than reconnecting on a timer.
  //
  // Guarded on purpose: the poller reads the sidebar snapshot and subscribes to
  // its changes, and `apply()` throwing here would take the whole plugin down —
  // including the viewers registered above — on a host whose better-sidebar is
  // older than the two methods. Degrading to "no agent opens" is the honest
  // outcome; silently registering nothing is not.
  if (
    typeof ctx.betterSidebar.getSnapshot !== "function" ||
    typeof ctx.betterSidebar.subscribeState !== "function"
  ) {
    console.warn(
      "[dsh-bioviewer] this better-sidebar does not expose the sidebar snapshot; agent-triggered opens are disabled",
    );
    return;
  }

  ctx.effect(
    () =>
      startAgentOpens({
        getSessionId: () => ctx.betterSidebar.getSnapshot().sessionId,
        subscribeSession: (listener) => ctx.betterSidebar.subscribeState(listener),
        sink: ctx.betterSidebar,
        onError: (error) => {
          console.warn("[dsh-bioviewer] the agent-open poll failed", error);
        },
      }),
    "dsh-bioviewer: agent opens",
  );
}

/**
 * Entry point of the client half.
 *
 * @param ctx - the client cordis context.
 */
export function apply(ctx: Context): void {
  // `ctx.inject` waits for the service on a child fiber: registration starts as
  // soon as better-sidebar is up (order-independent), and a host without it
  // simply activates this plugin and registers nothing.
  ctx.inject(["betterSidebar"], (scoped) => {
    registerAll(scoped);
  });
}
