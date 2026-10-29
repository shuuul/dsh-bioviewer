/**
 * The single place where a viewer payload becomes a Mol* object.
 *
 * Kept free of React and of Mol*'s own types: `StudioLike` is a structural
 * slice of `@molstudio/core`'s `MolStudio`, so this module can be unit-tested
 * with a fake studio and without a WebGL context, and so the viewer component
 * never has to know which Mol* entry point a payload belongs to.
 *
 * Three payload families, three routes:
 *
 * - `kind: "bytes"` — a file we fetched ourselves. The format table in
 *   `../shared/formats` decides the entry point (`format.kind`) and the Mol*
 *   reader (`format.molstarFormat`).
 * - `kind: "structure"` — a database entry with no local bytes. MolStudio owns
 *   those loaders (`loadPdb` / `loadAlphaFoldDb` / `loadEmdb`), including the
 *   network fetch and, for EMDB, the author-recommended contour level.
 * - `kind: "markers"` — a `.cmm` marker model, already parsed into MolStudio's
 *   own `MarkerSet` vocabulary by the descriptor. Each set becomes its own
 *   object, drawn *beside* whatever else is in the studio (prompt points over a
 *   density map is the point), so nothing but a same-label set is ever removed.
 *
 * Loading is *replacing*: the host re-runs the descriptor's `load()` after
 * every successful model write, and the viewer's retry button goes through the
 * same path, so a second load of the same thing must not leave the previous
 * object in Mol*'s object list. `MolStudio` has no dedupe of its own (verified
 * in `@molstudio/core` 0.1.4), so a pre-existing object is removed first when
 * the studio exposes {@link StudioLike.getSnapshot} and {@link StudioLike.remove}
 * — matched on label *and* kind, so replacing a marker set can never delete a
 * structure that merely shares its name.
 */
import type { MarkerSet } from "@molstudio/core";
import type { BioViewerPayload, MarkersPayload, StructurePayload, ViewerPayload } from "./payload";

/**
 * The slice of one Mol* object this adapter reads: enough to key a replacement.
 *
 * `kind` is `"structure" | "volume" | "markers"` on a real `MolStudio`
 * (`StudioObject` is a discriminated union, `@molstudio/core`
 * `src/types.ts:163`); it is optional here so an older shape — or a test double
 * that only tracks labels — still typechecks.
 */
export interface StudioObjectSummary {
  readonly id: string;
  readonly label: string;
  readonly kind?: string;
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
  /** `MolStudio.loadMarkers`: adds one parsed marker set as its own shape object. */
  loadMarkers?(set: MarkerSet): Promise<void>;
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
 * - `"markers"` — rejected with a clear error: a `.cmm` file reaches Mol* as a
 *   `kind: "markers"` payload (each `<marker_set>` becomes its own object), so a
 *   bytes payload claiming this kind means the descriptor routed it wrong and
 *   loading it here would produce an empty viewer instead of a visible failure.
 *
 * The label a byte payload loads under is `payload.title` — the object name the
 * user sees in Mol*'s list — and it is also the identity a reload replaces.
 */
export async function loadIntoStudio(studio: StudioLike, payload: ViewerPayload): Promise<void> {
  if (payload.kind === "structure") {
    await loadDatabaseEntry(studio, payload);
    return;
  }
  if (payload.kind === "markers") {
    await loadMarkerSets(studio, payload);
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
  // the studio. A molecule loads as a structure too (Mol* models SDF/MOL2 as
  // structures), so only a volume format is keyed as a volume.
  await removeObjectsMatching(studio, [
    { label: title, kind: format.kind === "volume" ? "volume" : "structure" },
  ]);

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
  // PDB and AlphaFold entries are structures; EMDB is a density map and lands as
  // a volume (`loadEmdb` applies `DownloadDensity` and reads the result back out
  // of `plugin.managers.volume.hierarchy`, `packages/core/src/MolStudio.ts:295-304`;
  // `describeVolume` reports `kind: "volume"`, `:915`).
  const kind = payload.source === "emdb" ? "volume" : "structure";
  await removeObjectsMatching(
    studio,
    structureLabels(payload).map((label) => ({ label, kind })),
  );
  await load(payload.id);
}

/**
 * The `kind: "markers"` route: draw every set the file contained, in file order.
 *
 * Sets are additive on purpose — a marker model is drawn *over* whatever else
 * the studio holds (prompt points on a density map), so only an object carrying
 * the same label is replaced. That label is `set.label`, not the file title:
 * `MarkerSetShape` builds its shape node with `label: params.set.label`
 * (`packages/core/src/markers.ts:48,54`) and the snapshot reports the same field
 * (`packages/core/src/MolStudio.ts:939`), so — unlike the database loaders — the
 * label is fully predictable from the payload.
 */
async function loadMarkerSets(studio: StudioLike, payload: MarkersPayload): Promise<void> {
  // Resolve the loader and check the payload before any removal, so a payload
  // this studio cannot draw never deletes the drawing that is already there.
  const load = markerLoader(studio);
  if (payload.sets.length === 0) {
    throw new Error(
      `dsh-bioviewer: "${payload.title}" contains no marker sets, so there is nothing to draw.`,
    );
  }
  // Replace what this file drew last time, then draw everything it holds now.
  // The removal happens ONCE, before the first set: a file whose sets share a
  // label must still draw all of them, and a per-set removal would delete the
  // set drawn a moment earlier. Repeated labels are realistic — Chimera's own
  // default marker-set name is "markers", and a parser falls back to a default
  // when `name` is missing.
  const labels = new Set(payload.sets.map((set) => set.label));
  await removeObjectsMatching(
    studio,
    [...labels].map((label) => ({ label, kind: "markers" })),
  );
  for (const set of payload.sets) await load(set);
}

/** The marker loader, or a clear error naming the missing method. */
function markerLoader(studio: StudioLike): (set: MarkerSet) => Promise<void> {
  if (studio.loadMarkers === undefined) {
    throw new Error(
      "dsh-bioviewer: this Mol* studio cannot draw marker sets — loadMarkers() is missing, so the markers were not loaded.",
    );
  }
  return studio.loadMarkers.bind(studio);
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

/** One object identity: the label a payload loads under, and what it will be. */
interface ObjectKey {
  readonly label: string;
  readonly kind: string;
}

/**
 * Drops every object a payload's load is about to replace.
 *
 * Matched on label AND kind, never on the label alone: labels are user-visible
 * names, so a structure a user happened to call `markers` must not vanish
 * because a marker set with that label is drawn (verifier finding F3). The
 * plugin's own labels are disjoint today — a file basename ending in `.cmm`
 * versus a structure basename — but that disjointness is invisible, so the key
 * states it instead of relying on it.
 *
 * A studio that does not report `kind` falls back to a label-only match:
 * removing nothing would silently stop replacing, which is the worse failure.
 */
async function removeObjectsMatching(studio: StudioLike, keys: readonly ObjectKey[]): Promise<void> {
  const snapshot = studio.getSnapshot?.();
  const remove = studio.remove?.bind(studio);
  if (snapshot === undefined || remove === undefined) return;
  // Copy first: `remove` mutates the very state tree the snapshot came from,
  // and iterating the live list would skip every other match.
  for (const object of [...snapshot.objects]) {
    const matches = keys.some(
      (key) => key.label === object.label && (object.kind === undefined || object.kind === key.kind),
    );
    if (matches) await remove(object.id);
  }
}
