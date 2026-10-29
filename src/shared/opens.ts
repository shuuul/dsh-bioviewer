/**
 * The contract for **agent-triggered opens**.
 *
 * The model calls a host-side tool; the sidebar lives in the browser. This
 * module is the wire between them, so it is deliberately dependency-free (it
 * imports only the pure format table) and shared verbatim by both halves.
 *
 * Two things can be opened, and each can land two ways:
 *
 * - a **file** — any path the format table recognises, including `.gz`;
 * - a **structure** — a database entry, addressed as `pdb:1cbs`,
 *   `alphafold:P00533` or `emdb:EMD-1234`. The sidebar has no local bytes for
 *   these, so the client hands the id to MolStudio's own database loaders
 *   (`loadPdb` / `loadAlphaFoldDb` / `loadEmdb`) instead of the byte path.
 *
 * `mode: "open"` always makes a new tab. `mode: "add"` stacks into the live
 * BioViewer for that session (overlay a map on a structure, draw markers over
 * a density, load a second PDB). If no viewer is open yet, add falls back to
 * open so the first object still appears.
 *
 * @module dsh-bioviewer/shared/opens
 */
import { BIO_EXTENSIONS, detectBioFile } from "./formats";

/** Which database a structure id refers to. */
export type StructureSource = "pdb" | "alphafold" | "emdb";

/** Open a new tab, or stack into the live BioViewer. */
export type OpenMode = "open" | "add";

/** A local file to show in the sidebar viewer. */
export interface OpenFileRequest {
  readonly kind: "file";
  readonly mode: OpenMode;
  /** Absolute path — the host resolves it before queueing, so the client never guesses a base. */
  readonly path: string;
  /** Display title, normally the basename. */
  readonly title: string;
  /** Detected format id, for diagnostics and for the tool's reply. */
  readonly formatId: string;
}

/** A database entry to show in the sidebar viewer. */
export interface OpenStructureRequest {
  readonly kind: "structure";
  readonly mode: OpenMode;
  readonly source: StructureSource;
  /** Accession exactly as the loader expects it (`1CBS`, `P00533`, `EMD-1234`). */
  readonly id: string;
  readonly title: string;
}

export type OpenRequest = OpenFileRequest | OpenStructureRequest;

/** Outcome of reading the tool's `target` argument. */
export type ParsedTarget =
  | { readonly kind: "structure"; readonly source: StructureSource; readonly id: string }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "invalid"; readonly reason: string };

/** The prefix → source table, matched case-insensitively. */
const SOURCE_PREFIXES: readonly (readonly [string, StructureSource])[] = [
  ["pdb", "pdb"],
  ["alphafold", "alphafold"],
  ["af", "alphafold"],
  ["emdb", "emdb"],
];

const PDB_ID = /^[0-9][A-Za-z0-9]{3}$/;
const UNIPROT_ID = /^[A-Z][A-Z0-9]{5,9}$/;
const EMDB_ID = /^(?:EMD-)?(\d{1,7})$/i;

/** How many extensions the table carries, for error text. */
export function supportedExtensionsText(): string {
  return [...BIO_EXTENSIONS].sort().join(", ");
}

/**
 * Normalise a database id to the exact form its loader expects, or explain why
 * it cannot be one.
 */
function normalizeStructureId(source: StructureSource, raw: string): { id: string } | { reason: string } {
  const value = raw.trim();
  if (value === "") return { reason: `the ${source} id is empty` };
  switch (source) {
    case "pdb": {
      const id = value.toUpperCase();
      if (!PDB_ID.test(id)) return { reason: `"${value}" is not a 4-character PDB id (for example 1cbs)` };
      return { id };
    }
    case "alphafold": {
      const id = value.toUpperCase();
      if (!UNIPROT_ID.test(id)) {
        return { reason: `"${value}" is not a UniProt accession (for example P00533)` };
      }
      return { id };
    }
    case "emdb": {
      const match = EMDB_ID.exec(value);
      if (match === null) return { reason: `"${value}" is not an EMDB id (for example EMD-1234)` };
      return { id: `EMD-${match[1]}` };
    }
  }
}

/**
 * Read the tool's `target` argument.
 *
 * A `source:id` prefix means a database entry; anything else is treated as a
 * path. The prefix is required rather than inferred so a bare `1cbs` is never
 * silently read as a filename (or the reverse).
 */
export function parseOpenTarget(raw: string): ParsedTarget {
  const value = raw.trim();
  if (value === "") return { kind: "invalid", reason: "the target is empty" };

  const separator = value.indexOf(":");
  // A Windows drive letter (`C:\...`) is a path, not a source prefix.
  if (separator > 0 && !/^[A-Za-z]$/.test(value.slice(0, separator))) {
    const prefix = value.slice(0, separator).toLowerCase();
    const match = SOURCE_PREFIXES.find(([name]) => name === prefix);
    if (match !== undefined) {
      const normalized = normalizeStructureId(match[1], value.slice(separator + 1));
      if ("reason" in normalized) return { kind: "invalid", reason: normalized.reason };
      return { kind: "structure", source: match[1], id: normalized.id };
    }
    // An unknown prefix that looks like a scheme (`foo:bar`) is a typo, not a
    // path — reporting it beats a confusing "file not found" later.
    if (/^[a-z][a-z0-9+.-]*$/i.test(prefix) && !value.startsWith("./") && !value.startsWith("../")) {
      const known = SOURCE_PREFIXES.map(([name]) => name).join(", ");
      return { kind: "invalid", reason: `unknown source "${prefix}" — use one of ${known}, or a file path` };
    }
  }
  return { kind: "path", path: value };
}

/** The display title for a database entry. */
export function structureTitle(source: StructureSource, id: string): string {
  switch (source) {
    case "pdb":
      return `PDB ${id}`;
    case "alphafold":
      return `AlphaFold ${id}`;
    case "emdb":
      return `EMDB ${id}`;
  }
}

/** Why a path cannot be shown, or undefined when it can. */
export function unsupportedPathReason(path: string): string | undefined {
  if (detectBioFile(path) !== undefined) return undefined;
  return `"${path}" is not a supported biomolecular file. Supported extensions: ${supportedExtensionsText()} (each also with a .gz suffix).`;
}

function isOpenMode(value: unknown): value is OpenMode {
  return value === "open" || value === "add";
}

/** Narrow a value off the wire before trusting it. */
export function isOpenRequest(value: unknown): value is OpenRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isOpenMode(candidate["mode"])) return false;
  if (candidate["kind"] === "file") {
    return typeof candidate["path"] === "string" && typeof candidate["title"] === "string";
  }
  if (candidate["kind"] === "structure") {
    return (
      typeof candidate["id"] === "string" &&
      (candidate["source"] === "pdb" || candidate["source"] === "alphafold" || candidate["source"] === "emdb")
    );
  }
  return false;
}
