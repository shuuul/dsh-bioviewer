/**
 * The single place where a bio file's bytes become a Mol* object.
 *
 * Kept free of React and of Mol*'s own types: `StudioLike` is a structural
 * slice of `@molstudio/core`'s `MolStudio`, so this module can be unit-tested
 * with a fake studio and without a WebGL context, and so the viewer component
 * never has to know which Mol* entry point a format belongs to.
 *
 * Format routing comes from the frozen table in `../shared/formats`:
 * `format.kind` decides the entry point, `format.molstarFormat` is the Mol*
 * reader id.
 *
 * Loading is *replacing*: the host re-runs the descriptor's `load()` after
 * every successful model write, and the viewer's retry button goes through the
 * same path, so a second load of the same file must not leave the previous
 * object in Mol*'s object list. `MolStudio.loadStructure` / `loadVolume` have
 * no dedupe of their own (verified in `@molstudio/core` 0.1.3), so any existing
 * object with the same label is removed first when the studio exposes
 * {@link StudioLike.getSnapshot} and {@link StudioLike.remove}.
 */
import type { BioFormat } from "../shared/formats";

/** The slice of one Mol* object this adapter reads: enough to find a label. */
export interface StudioObjectSummary {
  readonly id: string;
  readonly label: string;
}

/**
 * The `MolStudio` surface this adapter drives. `MolStudio` itself satisfies
 * this structurally, and so does a test double.
 */
export interface StudioLike {
  loadStructure(options: { data: string | Uint8Array; label: string; format: string }): Promise<void>;
  loadVolume(options: { data: string | Uint8Array; label: string; format: string }): Promise<void>;
  /** Present on a real `MolStudio`; optional so a two-method fake still satisfies this type. */
  getSnapshot?(): { readonly objects: readonly StudioObjectSummary[] };
  /** Present on a real `MolStudio`; optional so a two-method fake still satisfies this type. */
  remove?(id: string): Promise<void>;
}

/** One `TextDecoder` reused for every structure; `decode()` here is one-shot. */
const TEXT_DECODER = new TextDecoder();

/**
 * Loads one file into a Mol* studio.
 *
 * The data shape follows `format.kind`, because Mol* reads the two families
 * differently:
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
 * `label` is passed through verbatim: it is the object name the user sees in
 * Mol*'s object list, so the caller decides between a file name and a title.
 * It is also the identity a reload replaces — see the module header.
 */
export async function loadIntoStudio(
  studio: StudioLike,
  input: { bytes: Uint8Array; format: BioFormat; label: string },
): Promise<void> {
  const { bytes, format, label } = input;

  if (format.kind === "markers") {
    throw new Error(
      `dsh-bioviewer: "${label}" is a marker file (${format.id}); marker files are rendered by the marker overlay, not by Mol*.`,
    );
  }
  if (format.molstarFormat === "") {
    throw new Error(`dsh-bioviewer: format "${format.id}" has no Mol* reader id.`);
  }

  // Replace, do not accumulate: drop every object already carrying this label
  // before the new one is created. Validation stays first so a rejected input
  // never mutates the studio.
  const snapshot = studio.getSnapshot?.();
  const remove = studio.remove?.bind(studio);
  if (snapshot !== undefined && remove !== undefined) {
    // Copy first: `remove` mutates the very state tree the snapshot came from,
    // and iterating the live list would skip every other match.
    for (const object of [...snapshot.objects]) {
      if (object.label === label) await remove(object.id);
    }
  }

  if (format.kind === "volume") {
    await studio.loadVolume({ data: bytes, label, format: format.molstarFormat });
    return;
  }

  await studio.loadStructure({ data: TEXT_DECODER.decode(bytes), label, format: format.molstarFormat });
}
