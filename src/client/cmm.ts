/**
 * Chimera marker models (`.cmm`).
 *
 * Marker files are recognised and listed, but they are **not** rendered in 3D
 * yet: Mol* 5.13 exposes no public shape builder (`PluginContext.builders` has
 * only `data`, `structure` and `preset`), so drawing spheres and links would
 * mean reaching into the state tree directly. Rather than promise a view we
 * cannot draw, the viewer parses the file and reports what it contains — the
 * honest version of "we opened your marker model".
 *
 * The parser is hand-rolled rather than `DOMParser`-based on purpose: `.cmm` is
 * a flat, attribute-only XML dialect (one `<marker_set>` with direct `<marker>`
 * and `<link>` children), and a DOM-free parser keeps this module unit-testable
 * outside a browser.
 *
 * This module is deliberately React-free so it stays a plain data module; the
 * component that renders a {@link CmmSummary} lives in `./file-view.tsx`.
 *
 * @module dsh-bioviewer/client/cmm
 */

/** One `<marker>` with the attributes BioViewer treats as required. */
export interface CmmMarker {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** `<marker radius="...">`, or null when absent. */
  readonly radius: number | null;
}

/** One `<link>` whose two endpoints both exist. */
export interface CmmLink {
  readonly id1: string;
  readonly id2: string;
}

export interface CmmSummary {
  /** `<marker_set name="...">`, or null when the attribute is absent. */
  readonly setName: string | null;
  readonly markers: readonly CmmMarker[];
  readonly links: readonly CmmLink[];
  /**
   * `<marker>` elements skipped because `id`, `x`, `y` or `z` was missing or
   * non-numeric, plus `<link>` elements whose endpoints do not both exist.
   * Reported so a malformed file is visibly malformed instead of silently empty.
   */
  readonly skipped: number;
}

/** What the `.cmm` viewer hands to its component. */
export interface MarkerPayload {
  readonly path: string;
  readonly title: string;
  readonly summary: CmmSummary;
  readonly gzip: boolean;
}

/** `\b` after `marker` keeps `<marker_set>` out of the `<marker>` matches. */
const MARKER_TAG = /<marker\b([^>]*)>/gi;
const LINK_TAG = /<link\b([^>]*)>/gi;
const MARKER_SET_NAME = /<marker_set\b[^>]*\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const ATTRIBUTE = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Pull the attributes out of one tag's inner text (double or single quoted). */
function attributesOf(inner: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of inner.matchAll(ATTRIBUTE)) {
    const name = match[1];
    const value = match[2] ?? match[3];
    if (name !== undefined && value !== undefined) result[name.toLowerCase()] = value;
  }
  return result;
}

/** A finite number, or null for absent/garbage input. */
function numberOf(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse a Chimera marker model.
 *
 * Never throws: a file that is not a marker model at all yields an empty
 * summary, which the viewer reports as "no markers found".
 */
export function parseCmm(text: string): CmmSummary {
  const nameMatch = MARKER_SET_NAME.exec(text);
  const setName = nameMatch?.[1] ?? nameMatch?.[2] ?? null;

  const markers: CmmMarker[] = [];
  let skipped = 0;
  for (const match of text.matchAll(MARKER_TAG)) {
    const attributes = attributesOf(match[1] ?? "");
    const id = attributes["id"];
    const x = numberOf(attributes["x"]);
    const y = numberOf(attributes["y"]);
    const z = numberOf(attributes["z"]);
    if (id === undefined || id === "" || x === null || y === null || z === null) {
      skipped += 1;
      continue;
    }
    markers.push({ id, x, y, z, radius: numberOf(attributes["radius"]) });
  }

  const ids = new Set(markers.map((marker) => marker.id));
  const links: CmmLink[] = [];
  for (const match of text.matchAll(LINK_TAG)) {
    const attributes = attributesOf(match[1] ?? "");
    const id1 = attributes["id1"];
    const id2 = attributes["id2"];
    if (id1 === undefined || id2 === undefined || !ids.has(id1) || !ids.has(id2)) {
      skipped += 1;
      continue;
    }
    links.push({ id1, id2 });
  }

  return { setName, markers, links, skipped };
}

/** Narrow an unknown `customData` value to a marker payload. */
export function isMarkerPayload(value: unknown): value is MarkerPayload {
  if (typeof value !== "object" || value === null) return false;
  const summary = (value as { summary?: unknown }).summary;
  return typeof summary === "object" && summary !== null && Array.isArray((summary as CmmSummary).markers);
}
