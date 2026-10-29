import type { StructureSource } from "../shared/opens";
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
  /** Discriminant: this payload carries bytes we fetched ourselves. */
  readonly kind: "bytes";
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

/**
 * A structure that lives in a database rather than on disk.
 *
 * There are no bytes to carry: MolStudio owns these loaders (`loadPdb`,
 * `loadAlphaFoldDb`, `loadEmdb`), including the network fetch and, for EMDB,
 * the author-recommended contour level. The payload therefore carries only the
 * accession.
 */
export interface StructurePayload {
  /** Discriminant: this payload names a database entry. */
  readonly kind: "structure";
  readonly source: StructureSource;
  /** Accession exactly as the loader expects it (`1CBS`, `P00533`, `EMD-1234`). */
  readonly id: string;
  /** Display title, e.g. `PDB 1CBS`. */
  readonly title: string;
}

/** Everything a bio viewer component can be asked to render. */
export type ViewerPayload = BioViewerPayload | StructurePayload;
