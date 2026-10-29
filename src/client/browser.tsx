/**
 * The BioViewer sidebar tab: a workspace browser for biological files.
 *
 * It lists one directory level at a time (starting at the session's root),
 * shows the current directory plus a "go up" control, and opens a bio file in
 * the host editor through `ctx.betterSidebar.openFile(...)` — that open is what
 * mounts the registered Mol* file viewer, so this page never renders the
 * structure itself.
 *
 * Host constraints this page respects (verified against dsh-better-sidebar
 * 0.28.2 and its external-plugin guide):
 *
 * - `TabComponentProps` hands over `{ ctx, scope, visible }`; `visible` is
 *   false while the tab is not the active one, so every request is gated on it
 *   and an in-flight one is aborted when it flips.
 * - Routes are resolved with `ctx.betterSidebar.hostRouteUrl(<relative>)` —
 *   never a leading slash, which would drop a reverse-proxy prefix.
 * - The DSH native tab body is a fixed-height BLOCK scroller, not a flex
 *   container, so the root is `height: 100%; min-height: 0; overflow: auto`
 *   (see browser.css) and owns its own scrolling.
 * - Styling consumes only DSH tokens (`--dsw-alias-*`, `--dsw-font-*`,
 *   `--ds-*`), so every DSH skin keeps working.
 */

import type { Context } from "@deepseek-ai/cordis";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import css from "./browser.css";
import { useViewerLocale } from "./use-locale";
import {
  collectBioFiles,
  fetchSessionCwd,
  fetchTreeLevel,
  parentPath,
  RequestGate,
  WorkspaceApiError,
  type BioTreeEntry,
} from "./workspace";

/** The session slice this page needs; matches the host's `SessionScope`. */
export interface BioBrowserScope {
  sessionId: string;
  cwd?: string;
}

/** Props handed over by the tab registration (`{ ctx, scope, visible }`). */
export interface BioBrowserProps {
  ctx: Context;
  scope: BioBrowserScope;
  visible: boolean;
}

/**
 * The slice of the better-sidebar service this page uses: `hostRouteUrl`
 * (feature 'hostRouteUrl', v0.25.0+) and `openFile` (feature 'openFile').
 */
interface BioSidebarService {
  hostRouteUrl(path: string): string;
  openFile(scope: BioBrowserScope, path: string, title?: string): void;
}

/** One settled listing result; the loading branch is derived, never stored. */
type SettledState =
  | { status: "ready"; entries: BioTreeEntry[]; truncated: boolean }
  | { status: "error"; message: string };

/** One page state; every branch renders something, so the pane is never blank. */
type LoadState = { status: "loading" } | SettledState;

const STYLE_ELEMENT_ID = "dsh-bioviewer-styles";

/** Inject the stylesheet once per document (idempotent across mounts/HMR). */
let stylesInjected = false;
function ensureStyles(): void {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  if (document.getElementById(STYLE_ELEMENT_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.setAttribute("data-dsh-bioviewer-styles", "");
  style.textContent = css;
  document.head.append(style);
}

/**
 * Read the better-sidebar service without depending on module augmentation:
 * the page degrades to an explicit error instead of throwing when the host
 * never provides it.
 */
function readSidebar(ctx: Context): BioSidebarService | undefined {
  const service = (
    ctx as unknown as { betterSidebar?: Partial<BioSidebarService> | undefined }
  ).betterSidebar;
  if (service === undefined || service === null) return undefined;
  if (
    typeof service.hostRouteUrl !== "function" ||
    typeof service.openFile !== "function"
  ) {
    return undefined;
  }
  return service as BioSidebarService;
}

/** True for the DOMException `fetch` raises when its signal fires. */
function isAbort(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/** A message a reader can act on; wire codes are kept for support reports. */
function describeError(error: unknown): string {
  if (error instanceof WorkspaceApiError) {
    return error.code === "http" ? error.message : `${error.message} (${error.code})`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Trim a scope cwd into a usable directory, or `undefined` when absent. */
function normalizeDir(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Deterministic code-unit path order, matching `collectBioFiles`. */
function byPath(a: BioTreeEntry, b: BioTreeEntry): number {
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

/** Short extension badge: `1abc.pdb` -> `PDB`, `map.mrc.gz` -> `MRC·GZ`. */
function badgeOf(name: string): string {
  const gzip = name.toLowerCase().endsWith(".gz");
  const stem = gzip ? name.slice(0, -3) : name;
  const dot = stem.lastIndexOf(".");
  const ext = dot > 0 ? stem.slice(dot + 1).toUpperCase() : "";
  if (ext === "") return gzip ? "GZ" : "";
  return gzip ? `${ext}·GZ` : ext;
}

function FolderGlyph(): ReactNode {
  return (
    <svg
      className="dsh-bioviewer__glyph"
      width="13"
      height="13"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1.75 3.75A1.25 1.25 0 0 1 3 2.5h3.1c.33 0 .65.13.88.37l.9.9H13a1.25 1.25 0 0 1 1.25 1.25v7A1.25 1.25 0 0 1 13 13.25H3A1.25 1.25 0 0 1 1.75 12z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileGlyph(): ReactNode {
  return (
    <svg
      className="dsh-bioviewer__glyph"
      width="13"
      height="13"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3.75 1.75h5l3.5 3.5v9H3.75z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 1.9V5.5h3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UpGlyph(): ReactNode {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M8 12.5V3.9M4.2 7.4 8 3.6l3.8 3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RefreshGlyph(): ReactNode {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M13 8a5 5 0 1 1-1.6-3.7M13 2.6V5.4h-2.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The BioViewer tab page. Mounted by the plugin's tab registration as
 * `BioBrowser({ ctx, scope, visible })`.
 */
export function BioBrowser(props: BioBrowserProps): ReactNode {
  const { ctx, scope, visible } = props;
  const { t } = useViewerLocale();
  const sessionId = scope.sessionId;
  const cwd = normalizeDir(scope.cwd);

  const sidebar = readSidebar(ctx);
  const available = sidebar !== undefined;
  // Kept in a ref so the request effects never depend on the service's object
  // identity (a re-created proxy would otherwise re-issue every listing).
  const sidebarRef = useRef<BioSidebarService | undefined>(sidebar);
  useEffect(() => {
    sidebarRef.current = sidebar;
  }, [sidebar]);

  /** Stable route resolver: relative route in, prefix-safe URL out. */
  const routeUrl = useCallback((path: string): string => {
    const service = sidebarRef.current;
    return service === undefined ? path : service.hostRouteUrl(path);
  }, []);

  /** The result of the last settled listing, tagged with the directory it belongs to. */
  const [loaded, setLoaded] = useState<{
    dir: string;
    result: SettledState;
  } | null>(null);
  /** Failure of the one-time session-root resolution (no directory to tag it with). */
  const [rootError, setRootError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  /** Latest-request-wins gate: overlapping loads abort, stale results are dropped. */
  const [gate] = useState(() => new RequestGate());

  useEffect(() => {
    ensureStyles();
  }, []);

  /**
   * The directory on screen. User navigation is state; a scope change (session
   * switch, or a cwd that arrived after the first paint) re-roots the page
   * DURING render — deriving it here means the first paint after a switch is
   * already the new root, and navigating inside a session is untouched.
   */
  const scopeKey = `${sessionId}\u0000${cwd ?? ""}`;
  const [navigation, setNavigation] = useState<{
    key: string;
    dir: string | undefined;
  }>(() => ({ key: scopeKey, dir: cwd }));
  const dir = navigation.key === scopeKey ? navigation.dir : cwd;
  const setDir = useCallback(
    (next: string | undefined): void => {
      setNavigation({ key: scopeKey, dir: next });
    },
    [scopeKey],
  );

  // Resolve the session root once, when the scope carries no cwd yet.
  useEffect(() => {
    if (!visible || dir !== undefined || !available) return;
    const controller = new AbortController();
    void fetchSessionCwd({
      routeUrl,
      sessionId,
      ...(cwd === undefined ? {} : { cwd }),
      signal: controller.signal,
    })
      .then((info) => {
        if (!controller.signal.aborted) setDir(info.cwd);
      })
      .catch((error: unknown) => {
        if (!isAbort(error) && !controller.signal.aborted) {
          setRootError(describeError(error));
        }
      });
    return () => {
      controller.abort();
    };
  }, [visible, dir, available, reloadToken, routeUrl, sessionId, cwd, setDir]);

  // List the current directory. Paused while the tab is not visible; a newer
  // request (or a directory change) aborts the older one, and a stale response
  // is dropped by the ticket check even if it wins the race. The loading state
  // itself is DERIVED from `loaded` below, so this effect never has to publish
  // one (no cascading render).
  useEffect(() => {
    if (!visible) {
      gate.cancel();
      return;
    }
    if (dir === undefined || !available) return;
    const target = dir;
    const ticket = gate.begin();
    void (async () => {
      try {
        const level = await fetchTreeLevel({
          routeUrl,
          sessionId,
          ...(cwd === undefined ? {} : { cwd }),
          path: target,
          signal: ticket.signal,
        });
        if (ticket.stale()) return;
        if (level.error !== undefined) {
          setLoaded({
            dir: target,
            result: { status: "error", message: level.error },
          });
          return;
        }
        setLoaded({
          dir: target,
          result: {
            status: "ready",
            entries: level.entries,
            truncated: level.truncated,
          },
        });
      } catch (error) {
        if (isAbort(error) || ticket.stale()) return;
        setLoaded({
          dir: target,
          result: { status: "error", message: describeError(error) },
        });
      }
    })();
    return () => {
      gate.cancel();
    };
  }, [visible, dir, reloadToken, available, routeUrl, sessionId, cwd, gate]);

  // Abort whatever is in flight when the page unmounts.
  useEffect(() => () => gate.cancel(), [gate]);

  // Derived view state: never blank, never stale for the wrong directory.
  const state: LoadState = !available
    ? { status: "error", message: t("browser.unavailable") }
    : rootError !== null
      ? { status: "error", message: rootError }
      : loaded !== null && dir !== undefined && loaded.dir === dir
        ? loaded.result
        : { status: "loading" };

  const parent = dir === undefined ? undefined : parentPath(dir);

  const goUp = useCallback((): void => {
    if (parent !== undefined) setDir(parent);
  }, [parent, setDir]);

  const refresh = useCallback((): void => {
    setLoaded(null);
    setRootError(null);
    setReloadToken((token) => token + 1);
  }, []);

  const openEntry = useCallback(
    (entry: BioTreeEntry): void => {
      const service = sidebarRef.current;
      // Without the service the pane already shows the unavailable error and
      // renders no rows, so there is nothing to open.
      if (service === undefined) return;
      service.openFile(
        cwd === undefined ? { sessionId } : { sessionId, cwd },
        entry.path,
        entry.name,
      );
    },
    [cwd, sessionId],
  );

  const dirs =
    state.status === "ready"
      ? state.entries.filter((entry) => entry.isDir === true).sort(byPath)
      : [];
  const files = state.status === "ready" ? collectBioFiles(state.entries) : [];

  let body: ReactNode;
  if (state.status === "loading") {
    body = (
      <p className="dsh-bioviewer__status" role="status">
        {t("browser.loading")}
      </p>
    );
  } else if (state.status === "error") {
    body = (
      <div className="dsh-bioviewer__status dsh-bioviewer__status--error" role="alert">
        <p className="dsh-bioviewer__message">{state.message}</p>
        <button
          type="button"
          className="dsh-bioviewer__action"
          onClick={refresh}
        >
          {t("browser.retry")}
        </button>
      </div>
    );
  } else {
    body = (
      <>
        {dirs.length > 0 && (
          <ul className="dsh-bioviewer__list" aria-label={t("browser.folders")}>
            {dirs.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="dsh-bioviewer__row"
                  title={entry.path}
                  onClick={() => setDir(entry.path)}
                >
                  <FolderGlyph />
                  <span className="dsh-bioviewer__name">{entry.name}</span>
                  <span className="dsh-bioviewer__chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {files.length === 0 ? (
          <div className="dsh-bioviewer__status" role="status">
            <p className="dsh-bioviewer__message">{t("browser.empty")}</p>
            {dirs.length > 0 && (
              <p className="dsh-bioviewer__hint">
                {t("browser.emptyHint")}
              </p>
            )}
          </div>
        ) : (
          <ul className="dsh-bioviewer__list" aria-label={t("browser.files")}>
            {files.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="dsh-bioviewer__row"
                  title={t("browser.openFile", { path: entry.path })}
                  onClick={() => openEntry(entry)}
                >
                  <FileGlyph />
                  <span className="dsh-bioviewer__name">{entry.name}</span>
                  <span className="dsh-bioviewer__badge">
                    {badgeOf(entry.name)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {state.truncated && (
          <p className="dsh-bioviewer__notice" role="status">
            {t("browser.capped")}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="dsh-bioviewer" data-dsh-bioviewer="">
      <div className="dsh-bioviewer__bar">
        <button
          type="button"
          className="dsh-bioviewer__icon-button"
          onClick={goUp}
          disabled={parent === undefined}
          title={t("browser.parent")}
          aria-label={t("browser.parent")}
        >
          <UpGlyph />
        </button>
        <span className="dsh-bioviewer__cwd" title={dir ?? t("browser.sessionRoot")}>
          {dir ?? t("browser.sessionRoot")}
        </span>
        <button
          type="button"
          className="dsh-bioviewer__icon-button"
          onClick={refresh}
          title={t("browser.refresh")}
          aria-label={t("browser.refresh")}
        >
          <RefreshGlyph />
        </button>
      </div>
      {body}
    </div>
  );
}
