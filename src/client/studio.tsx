/**
 * The Mol* viewer surface of dsh-bioviewer.
 *
 * `<BioViewer>` is a *pure renderer*: the file has already been fetched by the
 * file-viewer descriptor's `load()` (better-sidebar's `fetchStrategy: 'custom'`
 * hands the resolved value to the component as `customData`), so this module
 * never fetches, never sees a session or a route, and has no opinion about
 * where the bytes came from. That split is what makes the host's `AbortSignal`
 * and its automatic reload-after-write work: both live on the descriptor side,
 * and a new payload object identity is the component's only reload signal.
 *
 * Layout contract: the DSH native tab body is a *fixed-height block scroller*,
 * not a flex container (see the better-sidebar external-plugin guide, "原生 tab
 * 体的高度契约"). A root that only relies on an outer flex parent collapses to
 * its content height, so the root below declares `height: 100%; min-height: 0`
 * and gives `<Studio>` a definite-height box to fill.
 *
 * `@molstudio/react/styles.css` is deliberately NOT imported here. The client
 * entry (`src/client/index.tsx`) injects it inside `ctx.effect`, which is the
 * only place with a lifecycle: the fiber removes the `<style>` element on
 * unload/HMR. An injection from this module would run at materialization
 * (before `apply()`), win the race, and then never be removed.
 */
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { Studio } from "@molstudio/react";
import type { MolStudio } from "@molstudio/core";
import { CloseIcon, ErrorIcon, RetryIcon, SpinnerIcon } from "./icons";
import { loadIntoStudio } from "./load";
import type { StudioLike } from "./load";
import type { BioViewerPayload } from "./payload";

export interface BioViewerProps {
  /** The file to display, already fetched and format-detected by the descriptor. */
  payload: BioViewerPayload;
  /** Resolved by the host from DSH tokens (`src/client/theme.ts`). */
  theme: "light" | "dark";
}

type LoadStatus = "loading" | "ready" | "error";

/** One settled load attempt: which studio, which payload, which retry. */
interface LoadAttempt {
  readonly studio: StudioLike;
  readonly payload: BioViewerPayload;
  readonly attempt: number;
  /** `null` when the load succeeded. */
  readonly error: string | null;
}

/**
 * Renders one bio file through Mol*.
 *
 * Mounting (and every new `payload` identity) loads the file into the studio
 * that `<Studio>` reports through `onReady`. A rejected load is shown as an
 * explicit panel with a retry button — the pane is never blank, because a
 * silently empty canvas is indistinguishable from a viewer that is still
 * working.
 */
export function BioViewer({ payload, theme }: BioViewerProps): ReactElement {
  const [studio, setStudio] = useState<StudioLike | null>(null);
  const [studioError, setStudioError] = useState<string | null>(null);
  /** The newest *settled* attempt; the visible status is derived from it. */
  const [settled, setSettled] = useState<LoadAttempt | null>(null);
  /** Bumped by Retry: a new value re-runs the load effect below. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (studio === null) return;
    let cancelled = false;
    const settling = attempt;
    void loadIntoStudio(studio, { bytes: payload.bytes, format: payload.format, label: payload.title }).then(
      () => {
        if (!cancelled) setSettled({ studio, payload, attempt: settling, error: null });
      },
      (cause: unknown) => {
        if (!cancelled) setSettled({ studio, payload, attempt: settling, error: errorMessage(cause) });
      },
    );
    // Covers unmount, a payload swap, a replaced MolStudio instance and a
    // retry: a run that no longer owns the viewer never writes its result into
    // it. `<Studio>` owns the MolStudio lifecycle and disposes it itself; this
    // component must never call `dispose()` on the handle it was given.
    return () => {
      cancelled = true;
    };
  }, [studio, payload, attempt]);

  const handleReady = useCallback((instance: MolStudio): void => {
    setStudio(instance);
  }, []);
  const handleStudioError = useCallback((cause: Error): void => {
    setStudioError(cause.message);
  }, []);
  const retry = useCallback((): void => {
    setAttempt((value) => value + 1);
  }, []);

  // Status is derived rather than stored: an attempt that belongs to another
  // payload, a replaced studio, or a retry that has not settled yet simply does
  // not count, so no state is written synchronously from the effect.
  const current =
    settled !== null && settled.studio === studio && settled.payload === payload && settled.attempt === attempt
      ? settled
      : null;
  const status: LoadStatus = current === null ? "loading" : current.error === null ? "ready" : "error";
  const error = current?.error ?? null;

  let overlay: ReactElement | null = null;
  if (studio === null) {
    overlay = <StatusCard busy title="Starting the Mol* viewer…" detail="Creating the WebGL canvas." />;
  } else if (status === "error" && error !== null) {
    overlay = (
      <StatusCard tone="error" title={`Could not display ${payload.title}`} detail={error} onRetry={retry} />
    );
  } else if (status === "loading") {
    overlay = <StatusCard busy title={`Loading ${payload.title}…`} detail={payload.format.label} />;
  }

  return (
    <div
      style={ROOT_STYLE}
      data-dsh-bioviewer-root=""
      data-dsh-bioviewer-status={studio === null ? "starting" : status}
    >
      <div style={STAGE_STYLE}>
        <Studio theme={theme} onReady={handleReady} onError={handleStudioError} />
        {overlay !== null && <div style={OVERLAY_STYLE}>{overlay}</div>}
        {studioError !== null && (
          <div style={BANNER_STYLE} role="alert">
            <ErrorIcon size={14} />
            <span style={BANNER_TEXT_STYLE}>{studioError}</span>
            <button
              type="button"
              style={ICON_BUTTON_STYLE}
              aria-label="Dismiss viewer error"
              title="Dismiss viewer error"
              onClick={() => setStudioError(null)}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The loading / error panel shown over the canvas. */
function StatusCard({
  title,
  detail,
  busy = false,
  tone = "info",
  onRetry,
}: {
  readonly title: string;
  readonly detail?: string;
  readonly busy?: boolean;
  readonly tone?: "info" | "error";
  readonly onRetry?: () => void;
}): ReactElement {
  return (
    <div style={CARD_STYLE} role={tone === "error" ? "alert" : "status"}>
      <div style={tone === "error" ? CARD_HEAD_ERROR_STYLE : CARD_HEAD_STYLE}>
        {busy ? <SpinnerIcon size={14} /> : <ErrorIcon size={14} />}
        <span>{title}</span>
      </div>
      {detail !== undefined && <p style={CARD_DETAIL_STYLE}>{detail}</p>}
      {onRetry !== undefined && (
        <button type="button" style={BUTTON_STYLE} onClick={onRetry}>
          <RetryIcon size={13} />
          <span>Retry</span>
        </button>
      )}
    </div>
  );
}

/** Error text for anything a promise can reject with. */
function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return typeof cause === "string" ? cause : String(cause);
}

/*
 * Inline styles rather than a stylesheet: this component is the only consumer,
 * and every color comes from a DSH token so skins apply without an override.
 * The fallbacks exist only so an unstyled host still shows readable text.
 */
const ROOT_STYLE: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
  background: "var(--dsw-alias-bg-base, #121315)",
};

const STAGE_STYLE: CSSProperties = {
  position: "relative",
  flex: "1 1 auto",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const OVERLAY_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  pointerEvents: "none",
};

const CARD_STYLE: CSSProperties = {
  pointerEvents: "auto",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 8,
  maxWidth: 460,
  padding: "14px 16px",
  borderRadius: 10,
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "var(--dsw-alias-bg-layer-1)",
  color: "var(--dsw-alias-label-primary)",
  font: "inherit",
  lineHeight: 1.45,
};

const CARD_HEAD_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontWeight: 600,
};

const CARD_HEAD_ERROR_STYLE: CSSProperties = {
  ...CARD_HEAD_STYLE,
  color: "var(--dsw-alias-state-error-primary)",
};

const CARD_DETAIL_STYLE: CSSProperties = {
  margin: 0,
  color: "var(--dsw-alias-label-secondary)",
  overflowWrap: "anywhere",
};

const BUTTON_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 10px",
  borderRadius: 8,
  cursor: "pointer",
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "var(--dsw-alias-bg-layer-2)",
  color: "var(--dsw-alias-label-primary)",
  font: "inherit",
};

const BANNER_STYLE: CSSProperties = {
  position: "absolute",
  top: 8,
  left: 8,
  right: 8,
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-state-error-primary)",
  background: "var(--dsw-alias-bg-layer-1)",
  color: "var(--dsw-alias-state-error-primary)",
  font: "inherit",
  lineHeight: 1.4,
};

const BANNER_TEXT_STYLE: CSSProperties = {
  flex: "1 1 auto",
  overflowWrap: "anywhere",
};

const ICON_BUTTON_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: 2,
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};
