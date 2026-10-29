import type { BioFormat } from "../shared/formats";

/**
 * What a bio file viewer's `load()` hands to its component.
 *
 * The descriptor uses `fetchStrategy: 'custom'`, so the host never reads the
 * file itself: it calls `load(path, scope, signal)` and passes the resolved
 * value through as `customData`. Keeping the payload as one plain object means
 * the component is a pure renderer with no fetch of its own — which is also
 * what makes the host's automatic reload (it re-runs the same `load()` after a
 * successful `write`/`edit`) and its `AbortSignal` actually work.
 */
export interface BioViewerPayload {
  /** Absolute or session-relative path exactly as the host reported it. */
  readonly path: string;
  /** Display name, usually the basename. */
  readonly title: string;
  /** Detected format; drives which Mol* reader runs. */
  readonly format: BioFormat;
  /** Raw file bytes, already gunzipped when `gzip` is true. */
  readonly bytes: Uint8Array;
  /** Whether the file arrived gzip-compressed (kept for the UI to report). */
  readonly gzip: boolean;
}
