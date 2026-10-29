/**
 * The single place where a viewer payload becomes a Mol* object.
 *
 * Kept free of React and of Mol*'s own types: `StudioLike` is a structural
 * slice of `@molstudio/core`'s `MolStudio`, so this module can be unit-tested
 * with a fake studio and without a WebGL context, and so the viewer component
 * never has to know which Mol* entry point a payload belongs to.
 *
 * Two payload families, two routes:
 *
 * - `kind: "bytes"` — a file we fetched ourselves. The format table in
 *   `../shared/formats` decides the entry point (`format.kind`) and the Mol*
 *   reader (`format.molstarFormat`).
 * - `kind: "structure"` — a database entry with no local bytes. MolStudio owns
 *   those loaders (`loadPdb` / `loadAlphaFoldDb` / `loadEmdb`), including the
 *   network fetch and, for EMDB, the author-recommended contour level.
 *
 * Loading is *replacing*: the host re-runs the descriptor's `load()` after
 * every successful model write, and the viewer's retry button goes through the
 * same path, so a second load of the same thing must not leave the previous
 * object in Mol*'s object list. `MolStudio` has no dedupe of its own (verified
 * in `@molstudio/core` 0.1.3), so any existing object carrying one of the
 * payload's labels is removed first when the studio exposes
 * {@link StudioLike.getSnapshot} and {@link StudioLike.remove}.
 */
import type { BioViewerPayload, StructurePayload, ViewerPayload } from "./payload";

/** The slice of one Mol* object this adapter reads: enough to find a label. */
export interface StudioObjectSummary {
  readonly id: string;
  readonly label: string;
}

/**
 * The `MolStudio` surface this adapter drives. `MolStudio` itself satisfies
 * this structurally, and so does a test double.
 *
 * Every member beyond the two byte loaders is optional so a two-method double
 * still satisfies the type; a payload whose loader is missing is rejected with
 * a clear error rather than silently doing nothing.
 */
export interface StudioLike {
  loadStructure(options: { data: string | Uint8Array; label: string; format: string }): Promise<void>;
  loadVolume(options: { data: string | Uint8Array; label: string; format: string }): Promise<void>;
  /** Present on a real `MolStudio`; optional so a two-method fake still satisfies this type. */
  getSnapshot?(): { readonly objects: readonly StudioObjectSummary[] };
  /** Present on a real `MolStudio`; optional so a two-method fake still satisfies this type. */
  remove?(id: string): Promise<void>;
  /** `MolStudio.loadPdb`: downloads a PDB entry as BinaryCIF. */
  loadPdb?(id: string): Promise<void>;
  /** `MolStudio.loadAlphaFoldDb`: looks the accession up, then downloads its model. */
  loadAlphaFoldDb?(uniprotId: string): Promise<void>;
  /** `MolStudio.loadEmdb`: downloads the map and applies the author-recommended contour. */
  loadEmdb?(id: string): Promise<void>;
}

/** One `TextDecoder` reused for every structure; `decode()` here is one-shot. */
const TEXT_DECODER = new TextDecoder();

/**
 * Loads one payload into a Mol* studio.
 *
 * The data shape for a byte payload follows `format.kind`, because Mol* reads
 * the two families differently:
 *
 * - `"volume"` — the raw bytes are handed over untouched. Our volume formats
 *   are binary density-map containers (MRC/CCP4), and Mol*'s volume readers
 *   take the container bytes; decoding them as text would corrupt the map.
 * - `"structure"` / `"molecule"` — decoded to text. Every structure/molecule
 *   format in our table is a text format, and Mol*'s trajectory parser treats
 *   a `Uint8Array` as BinaryCIF (mmcif) or as raw binary, so the bytes must be
 *   decoded here or the parse fails / silently yields nothing.
 * - `"markers"` — rejected with a clear error: `.cmm` is not a Mol* format at
 *   all (the reference host renders it as its own overlay), so loading it here
 *   would produce an empty viewer instead of a visible failure.
 *
 * The label a byte payload loads under is `payload.title` — the object name the
 * user sees in Mol*'s list — and it is also the identity a reload replaces.
 */
export async function loadIntoStudio(studio: StudioLike, payload: ViewerPayload): Promise<void> {
  if (payload.kind === "structure") {
    await loadDatabaseEntry(studio, payload);
    return;
  }
  await loadByteFile(studio, payload);
}

/** The `kind: "bytes"` route: format-driven, unchanged by the database work. */
async function loadByteFile(studio: StudioLike, payload: BioViewerPayload): Promise<void> {
  const { bytes, format, title } = payload;

  if (format.kind === "markers") {
    throw new Error(
      `dsh-bioviewer: "${title}" is a marker file (${format.id}); marker files are rendered by the marker overlay, not by Mol*.`,
    );
  }
  if (format.molstarFormat === "") {
    throw new Error(`dsh-bioviewer: format "${format.id}" has no Mol* reader id.`);
  }

  // Validation stays ahead of the removal so a rejected payload never mutates
  // the studio.
  await removeObjectsLabelled(studio, [title]);

  if (format.kind === "volume") {
    await studio.loadVolume({ data: bytes, label: title, format: format.molstarFormat });
    return;
  }

  await studio.loadStructure({ data: TEXT_DECODER.decode(bytes), label: title, format: format.molstarFormat });
}

/** The `kind: "structure"` route: hand the accession to MolStudio's own loader. */
async function loadDatabaseEntry(studio: StudioLike, payload: StructurePayload): Promise<void> {
  // Resolve the loader before anything else: a studio that cannot load this
  // entry must not delete the object that is already on screen.
  const load = databaseLoader(studio, payload);
  await removeObjectsLabelled(studio, structureLabels(payload));
  await load(payload.id);
}

/** The loader a structure payload needs, or a clear error naming the missing one. */
function databaseLoader(studio: StudioLike, payload: StructurePayload): (id: string) => Promise<void> {
  switch (payload.source) {
    case "pdb":
      if (studio.loadPdb !== undefined) return studio.loadPdb.bind(studio);
      break;
    case "alphafold":
      if (studio.loadAlphaFoldDb !== undefined) return studio.loadAlphaFoldDb.bind(studio);
      break;
    case "emdb":
      if (studio.loadEmdb !== undefined) return studio.loadEmdb.bind(studio);
      break;
  }
  throw new Error(
    `dsh-bioviewer: this Mol* studio cannot open ${payload.source} entries — ` +
      `${LOADER_NAME[payload.source]}() is missing, so "${payload.title}" was not loaded.`,
  );
}

/** The `MolStudio` member each source needs, for the missing-loader message. */
const LOADER_NAME = { pdb: "loadPdb", alphafold: "loadAlphaFoldDb", emdb: "loadEmdb" } as const;

/**
 * The labels a structure payload may already occupy in Mol*'s object list.
 *
 * The payload title is the primary key, but the database loaders take no label
 * — they name the object themselves, so matching the title alone would never
 * find the object a reload is replacing:
 *
 * - `loadPdb` labels the object with the uppercased id
 *   (`packages/core/src/MolStudio.ts:267-275`);
 * - `loadEmdb` produces a density-server label that MolStudio normalises to the
 *   uppercased id (`volumeName`, `packages/core/src/MolStudio.ts:375-380`);
 * - `loadAlphaFoldDb` labels the object with the entry id the API returns
 *   (`AF-P00533-F1`), which cannot be known before the fetch; the `AF-<ID>`
 *   fallback MolStudio uses when the API omits it is matched instead
 *   (`packages/core/src/MolStudio.ts:277-286`).
 *
 * Every candidate is a label MolStudio itself can produce for this payload, so
 * a match means "this object is the one being replaced", not a fuzzy guess.
 */
function structureLabels(payload: StructurePayload): readonly string[] {
  const id = payload.id.trim();
  switch (payload.source) {
    case "pdb":
      return [payload.title, id.toUpperCase()];
    case "alphafold":
      return [payload.title, `AF-${id.toUpperCase()}`];
    case "emdb":
      return [payload.title, normalizeEmdbLabel(id)];
  }
}

/** The uppercased `EMD-<n>` label `loadEmdb`/`volumeName` end up with. */
function normalizeEmdbLabel(id: string): string {
  const digits = /^(?:EMD-)?(\d+)$/i.exec(id);
  return digits === null ? id.toUpperCase() : `EMD-${digits[1]}`;
}

/** Drops every object whose label is one of `labels`, newest state included. */
async function removeObjectsLabelled(studio: StudioLike, labels: readonly string[]): Promise<void> {
  const snapshot = studio.getSnapshot?.();
  const remove = studio.remove?.bind(studio);
  if (snapshot === undefined || remove === undefined) return;
  // Copy first: `remove` mutates the very state tree the snapshot came from,
  // and iterating the live list would skip every other match.
  for (const object of [...snapshot.objects]) {
    if (labels.includes(object.label)) await remove(object.id);
  }
}
