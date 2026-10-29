/**
 * Unit tests for the load adapter.
 *
 * `loadIntoStudio` is the only place that decides *how* a payload reaches Mol*,
 * so these tests pin the routing rules (which entry point per `format.kind`,
 * which database loader per `source`), the data shape (decoded text for
 * structures/molecules, untouched bytes for volumes, the raw accession for a
 * database entry) and the failure modes — all against a fake studio, with no
 * WebGL, no network and no Mol* import.
 */
import { describe, expect, test } from "bun:test";
import type { MarkerSet } from "@molstudio/core";
import { BIO_FORMATS, detectBioFile } from "../src/shared/formats";
import type { BioFormat } from "../src/shared/formats";
import { structureTitle } from "../src/shared/opens";
import type { StructureSource } from "../src/shared/opens";
import { loadIntoStudio } from "../src/client/load";
import type { StudioLike, StudioObjectSummary } from "../src/client/load";
import type { BioViewerPayload, MarkersPayload, StructurePayload } from "../src/client/payload";

interface RecordedCall {
  readonly method: "loadStructure" | "loadVolume";
  readonly data: string | Uint8Array;
  readonly label: string;
  readonly format: string;
}

/** One database loader invocation, as the fake saw it. */
interface RecordedDatabaseCall {
  readonly source: StructureSource;
  readonly id: string;
}

/** One object already in the fake's "Mol* state": only the fields we match on. */
interface FakeObject {
  readonly id: string;
  readonly label: string;
  /** `"structure" | "volume" | "markers"`, as `StudioObject` reports it. */
  readonly kind?: string;
}

/**
 * A `StudioLike` that records what it was asked to load and to remove.
 *
 * All three database loaders exist unless `sources` narrows them, and the marker
 * loader exists unless `markers: false`, so a test can build the "studio without
 * this loader" case the adapter must reject.
 */
class FakeStudio implements StudioLike {
  readonly calls: RecordedCall[] = [];
  readonly database: RecordedDatabaseCall[] = [];
  /** Every marker set handed to `loadMarkers`, in call order. */
  readonly markerSets: MarkerSet[] = [];
  /** Every mutation in order, so a test can pin "remove, then load". */
  readonly events: string[] = [];
  /**
   * The fake's live "state tree". `getSnapshot()` hands it out by reference on
   * purpose: an adapter that iterates it while removing would skip entries.
   */
  readonly library: FakeObject[];
  readonly failure: Error | undefined;
  loadPdb?: (id: string) => Promise<void>;
  loadAlphaFoldDb?: (id: string) => Promise<void>;
  loadEmdb?: (id: string) => Promise<void>;
  loadMarkers?: (set: MarkerSet) => Promise<void>;
  /** Mints ids for the objects the loaders "create", like Mol*'s state refs. */
  private created = 0;

  constructor(
    options: {
      failure?: Error;
      library?: readonly FakeObject[];
      sources?: readonly StructureSource[];
      markers?: boolean;
    } = {},
  ) {
    this.failure = options.failure;
    this.library = [...(options.library ?? [])];
    const sources = options.sources ?? ["pdb", "alphafold", "emdb"];
    const record = (source: StructureSource) => async (id: string): Promise<void> => {
      this.events.push(`${source}:${id}`);
      this.database.push({ source, id });
      // EMDB is a density map: MolStudio lands it as a volume, not a structure.
      this.create(databaseLabel(source, id), source === "emdb" ? "volume" : "structure");
      if (this.failure !== undefined) throw this.failure;
    };
    if (sources.includes("pdb")) this.loadPdb = record("pdb");
    if (sources.includes("alphafold")) this.loadAlphaFoldDb = record("alphafold");
    if (sources.includes("emdb")) this.loadEmdb = record("emdb");
    if (options.markers ?? true) {
      this.loadMarkers = async (set: MarkerSet): Promise<void> => {
        this.events.push(`markers:${set.label}`);
        this.markerSets.push(set);
        this.create(set.label, "markers");
        if (this.failure !== undefined) throw this.failure;
      };
    }
  }

  /**
   * Add the object a successful load creates, so "replace instead of
   * accumulate" is observable: a second load of the same label must leave one
   * object, not two.
   *
   * The byte and marker loaders take our label verbatim; the database loaders
   * record the accession they were handed, which is the shape of the real ones
   * (`loadPdb` uppercases it, `loadEmdb` normalises it — the reason
   * `structureLabels` matches several candidates).
   */
  private create(label: string, kind: string): void {
    this.created += 1;
    this.library.push({ id: `ref-created-${this.created}`, label, kind });
  }

  getSnapshot(): { readonly objects: readonly StudioObjectSummary[] } {
    return { objects: this.library };
  }

  async remove(id: string): Promise<void> {
    this.events.push(`remove:${id}`);
    const at = this.library.findIndex((object) => object.id === id);
    if (at !== -1) this.library.splice(at, 1);
  }

  async loadStructure(options: { data: string | Uint8Array; label: string; format: string }): Promise<void> {
    this.events.push(`loadStructure:${options.label}`);
    this.calls.push({ method: "loadStructure", ...options });
    this.create(options.label, "structure");
    if (this.failure !== undefined) throw this.failure;
  }

  async loadVolume(options: { data: string | Uint8Array; label: string; format: string }): Promise<void> {
    this.events.push(`loadVolume:${options.label}`);
    this.calls.push({ method: "loadVolume", ...options });
    this.create(options.label, "volume");
    if (this.failure !== undefined) throw this.failure;
  }
}

const encoder = new TextEncoder();

/** The format the table resolves for `name`; fails the test if it is unknown. */
function formatOf(name: string): BioFormat {
  const detected = detectBioFile(name);
  if (detected === undefined) throw new Error(`test fixture is not a bio file: ${name}`);
  return detected.format;
}

/** A `kind: "bytes"` payload, shaped exactly as the descriptor's `load()` builds it. */
function bytesPayload(name: string, data: string | Uint8Array, title = name): BioViewerPayload {
  return {
    kind: "bytes",
    path: `/data/${name}`,
    title,
    format: formatOf(name),
    bytes: typeof data === "string" ? encoder.encode(data) : data,
    gzip: name.toLowerCase().endsWith(".gz"),
  };
}

/** A `kind: "structure"` payload, titled the way the host titles it. */
function structurePayload(source: StructureSource, id: string, title = structureTitle(source, id)): StructurePayload {
  return { kind: "structure", source, id, title };
}

/** One marker and one link, the smallest set MolStudio will draw. */
function markerSet(label: string, markerCount = 1, linkCount = 0): MarkerSet {
  return {
    label,
    markers: Array.from({ length: markerCount }, (_unused, index) => ({
      position: [index, index + 1, index + 2] as [number, number, number],
      radius: 1,
      color: "#6aa5ff",
    })),
    links: Array.from({ length: linkCount }, (_unused, index) => ({
      from: index,
      to: index + 1,
      radius: 0.4,
      color: "#f0605d",
    })),
  };
}

/**
 * The label each real database loader gives its object, which is what the
 * adapter's removal candidates are built from: `loadPdb` uppercases the id
 * (`packages/core/src/MolStudio.ts:267-275`), `loadEmdb` ends up as the
 * normalised `EMD-<n>` via `volumeName` (`:375-380`), and `loadAlphaFoldDb`
 * falls back to `AF-<ID>` when the API omits an entry id (`:277-286`).
 */
function databaseLabel(source: StructureSource, id: string): string {
  switch (source) {
    case "pdb":
      return id.trim().toUpperCase();
    case "alphafold":
      return `AF-${id.trim().toUpperCase()}`;
    case "emdb": {
      const digits = /^(?:EMD-)?(\d+)$/i.exec(id.trim());
      return digits === null ? id.trim().toUpperCase() : `EMD-${digits[1]}`;
    }
  }
}

/** The labels currently in the fake's state tree, in order. */
function labelsOf(studio: FakeStudio): string[] {
  return studio.library.map((object) => object.label);
}

/** A `kind: "markers"` payload, shaped exactly as the `.cmm` descriptor builds it. */
function markersPayload(sets: readonly MarkerSet[], title = "markers.cmm"): MarkersPayload {
  return { kind: "markers", path: `/data/${title}`, title, sets, gzip: false };
}

describe("loadIntoStudio routing", () => {
  test("loads a PDB structure as decoded text", async () => {
    const studio = new FakeStudio();
    const payload = bytesPayload("1abc.pdb", "HEADER    TEST\nATOM      1  N   ALA A   1\nEND\n", "1abc");

    await loadIntoStudio(studio, payload);

    expect(studio.calls).toHaveLength(1);
    const [call] = studio.calls;
    expect(call?.method).toBe("loadStructure");
    expect(call?.format).toBe("pdb");
    expect(typeof call?.data).toBe("string");
    expect(call?.data).toBe("HEADER    TEST\nATOM      1  N   ALA A   1\nEND\n");
  });

  test("loads an mmCIF structure as text through loadStructure", async () => {
    const studio = new FakeStudio();

    await loadIntoStudio(studio, bytesPayload("1abc.cif", "data_1abc\n#\n", "1abc"));

    expect(studio.calls[0]?.method).toBe("loadStructure");
    expect(studio.calls[0]?.format).toBe("mmcif");
    expect(studio.calls[0]?.data).toBe("data_1abc\n#\n");
  });

  test("loads Binary CIF as raw bytes through the mmCIF reader", async () => {
    const studio = new FakeStudio();
    const bytes = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0xff, 0xfe, 0x80, 0x7f]);

    await loadIntoStudio(studio, bytesPayload("1abc.bcif", bytes, "1abc"));

    expect(studio.calls).toHaveLength(1);
    const [call] = studio.calls;
    expect(call?.method).toBe("loadStructure");
    expect(call?.format).toBe("mmcif");
    expect(call?.data).toBe(bytes);
  });

  test("loads a gunzipped Binary CIF as raw bytes too", async () => {
    const studio = new FakeStudio();
    const bytes = new Uint8Array([0x83, 0x00, 0x01]);

    await loadIntoStudio(studio, bytesPayload("1abc.bcif.gz", bytes, "1abc.bcif"));

    expect(studio.calls[0]?.method).toBe("loadStructure");
    expect(studio.calls[0]?.format).toBe("mmcif");
    expect(studio.calls[0]?.data).toBe(bytes);
  });

  test("loads a small molecule (SDF) through loadStructure as text", async () => {
    const studio = new FakeStudio();

    await loadIntoStudio(
      studio,
      bytesPayload("ligand.sdf", "acetone\n\n  9  8  0  0  0  0  0  0  0  0999 V2000\nM  END\n$$$$\n", "ligand"),
    );

    expect(studio.calls[0]?.method).toBe("loadStructure");
    expect(studio.calls[0]?.format).toBe("sdf");
    expect(typeof studio.calls[0]?.data).toBe("string");
  });

  test("decodes multi-byte text without loss", async () => {
    const studio = new FakeStudio();
    const text = "REMARK 日本語ラベル — ünïcødé\n";

    await loadIntoStudio(studio, bytesPayload("x.pdb", text, "x"));

    expect(studio.calls[0]?.data).toBe(text);
  });

  test("loads a gunzipped file exactly like its plain twin", async () => {
    const studio = new FakeStudio();

    // The bytes are already inflated by the descriptor; only the name still says .gz.
    await loadIntoStudio(studio, bytesPayload("1abc.pdb.gz", "END\n", "1abc.pdb"));

    expect(studio.calls[0]?.method).toBe("loadStructure");
    expect(studio.calls[0]?.format).toBe("pdb");
    expect(studio.calls[0]?.label).toBe("1abc.pdb");
  });

  test("loads a CCP4/MRC map through loadVolume with the bytes untouched", async () => {
    const studio = new FakeStudio();
    // Deliberately not valid UTF-8: a text decode would mangle these bytes.
    const bytes = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0xff, 0xfe, 0x80, 0x7f]);

    await loadIntoStudio(studio, bytesPayload("emd_1234.map", bytes, "emd_1234"));

    expect(studio.calls).toHaveLength(1);
    const [call] = studio.calls;
    expect(call?.method).toBe("loadVolume");
    expect(call?.format).toBe("ccp4");
    expect(call?.data).toBeInstanceOf(Uint8Array);
    // Identity, not just equality: volumes must not be copied or re-encoded.
    expect(call?.data).toBe(bytes);
    expect(Array.from(call.data as Uint8Array)).toEqual([0x00, 0x00, 0x01, 0x00, 0xff, 0xfe, 0x80, 0x7f]);
  });

  test("passes the payload title through as the object label", async () => {
    const studio = new FakeStudio();
    const title = "1abc assembly — chain A (final).pdb";

    await loadIntoStudio(studio, bytesPayload("1abc.pdb", "END\n", title));

    expect(studio.calls[0]?.label).toBe(title);
  });

  test("uses format.molstarFormat as the Mol* reader id, not format.id", async () => {
    const studio = new FakeStudio();

    await loadIntoStudio(studio, bytesPayload("model.mmcif", "data_x\n", "model"));

    expect(studio.calls[0]?.format).toBe("mmcif");
  });
});

describe("loadIntoStudio database structures", () => {
  const SOURCES: readonly StructureSource[] = ["pdb", "alphafold", "emdb"];

  test("replaces the actual AlphaFold entry, preserving another accession and kind", async () => {
    const studio = new FakeStudio({ library: [
      { id: "other", label: "AF-P00533-F10", kind: "markers" },
      { id: "different", label: "AF-P00534-F1", kind: "structure" },
    ] });
    let next = 0;
    studio.loadAlphaFoldDb = async () => {
      studio.library.push({ id: `af-${++next}`, label: "AF-P00533-F1", kind: "structure" });
    };
    await loadIntoStudio(studio, structurePayload("alphafold", "P00533"));
    await loadIntoStudio(studio, structurePayload("alphafold", "P00533"));
    expect(studio.library).toEqual([
      { id: "other", label: "AF-P00533-F10", kind: "markers" },
      { id: "different", label: "AF-P00534-F1", kind: "structure" },
      { id: "af-2", label: "AF-P00533-F1", kind: "structure" },
    ]);
  });

  test("overlapping reloads replace after the earlier load has finished", async () => {
    const studio = new FakeStudio();
    let published: readonly StudioObjectSummary[] = [];
    studio.getSnapshot = () => ({ objects: published });
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const beginning = new Promise<void>((resolve) => { started = resolve; });
    let next = 0;
    studio.loadPdb = async () => {
      const id = ++next;
      if (id === 1) { started(); await pending; }
      studio.library.push({ id: `pdb-${id}`, label: "1CBS", kind: "structure" });
      // Published core 0.1.4 batches its snapshot until the next timer turn.
      setTimeout(() => { published = [...studio.library]; }, 0);
    };
    const payload = structurePayload("pdb", "1CBS");
    const first = loadIntoStudio(studio, payload);
    await beginning;
    const second = loadIntoStudio(studio, payload);
    release();
    await Promise.all([first, second]);
    expect(studio.library).toEqual([{ id: "pdb-2", label: "1CBS", kind: "structure" }]);
  });

  test("superseded queued loads do not run and a failure does not poison the queue", async () => {
    const studio = new FakeStudio();
    const controller = new AbortController();
    const skipped = loadIntoStudio(studio, structurePayload("pdb", "1CBS"), controller.signal);
    controller.abort();
    await expect(skipped).rejects.toThrow();
    expect(studio.library).toEqual([]);
    studio.loadPdb = async () => { throw new Error("download failed"); };
    await expect(loadIntoStudio(studio, structurePayload("pdb", "1CBS"))).rejects.toThrow("download failed");
    studio.loadPdb = async () => {
      studio.library.push({ id: "recovered", label: "1CBS", kind: "structure" });
    };
    await loadIntoStudio(studio, structurePayload("pdb", "1CBS"));
    expect(studio.library).toEqual([{ id: "recovered", label: "1CBS", kind: "structure" }]);
  });

  test("routes each source to its own loader and nothing else", async () => {
    for (const source of SOURCES) {
      const studio = new FakeStudio();
      const id = source === "pdb" ? "1CBS" : source === "alphafold" ? "P00533" : "EMD-1234";

      await loadIntoStudio(studio, structurePayload(source, id));

      expect(studio.database).toEqual([{ source, id }]);
      // The byte loaders must not be touched by a database payload.
      expect(studio.calls).toHaveLength(0);
    }
  });

  test("passes the accession through unchanged", async () => {
    const studio = new FakeStudio();

    // The host normalises before queueing; the adapter must not re-normalise.
    await loadIntoStudio(studio, structurePayload("pdb", "1cbs", "PDB 1cbs"));

    expect(studio.database[0]?.id).toBe("1cbs");
  });

  test("throws a clear error naming the missing loader", async () => {
    const studio = new FakeStudio({ sources: [] });

    await expect(loadIntoStudio(studio, structurePayload("pdb", "1CBS"))).rejects.toThrow(/loadPdb/);
    await expect(loadIntoStudio(studio, structurePayload("alphafold", "P00533"))).rejects.toThrow(/loadAlphaFoldDb/);
    await expect(loadIntoStudio(studio, structurePayload("emdb", "EMD-1234"))).rejects.toThrow(/loadEmdb/);
    expect(studio.database).toHaveLength(0);
    expect(studio.calls).toHaveLength(0);
  });

  test("names the entry it refused to load", async () => {
    const studio = new FakeStudio({ sources: [] });

    await expect(loadIntoStudio(studio, structurePayload("emdb", "EMD-1234"))).rejects.toThrow(/EMDB EMD-1234/);
  });

  test("a missing loader never mutates the object list", async () => {
    const studio = new FakeStudio({ sources: [], library: [{ id: "ref-1", label: "PDB 1CBS" }] });

    await expect(loadIntoStudio(studio, structurePayload("pdb", "1CBS"))).rejects.toThrow(/loadPdb/);

    expect(studio.events).toEqual([]);
    expect(studio.library).toEqual([{ id: "ref-1", label: "PDB 1CBS" }]);
  });

  test("removes an object already carrying the payload title", async () => {
    const studio = new FakeStudio({ library: [{ id: "ref-1", label: "PDB 1CBS" }] });

    await loadIntoStudio(studio, structurePayload("pdb", "1CBS"));

    expect(studio.events).toEqual(["remove:ref-1", "pdb:1CBS"]);
    // The loader names the object, not the payload title (see `structureLabels`).
    expect(labelsOf(studio)).toEqual(["1CBS"]);
  });

  test("also replaces the label MolStudio assigns itself (a PDB id is uppercased)", async () => {
    // loadPdb labels the object with the uppercased id, not with our title, so
    // a title-only match would stack a duplicate on every reload.
    const studio = new FakeStudio({ library: [{ id: "ref-1", label: "1CBS" }] });

    await loadIntoStudio(studio, structurePayload("pdb", "1cbs", "PDB 1cbs"));

    expect(studio.events).toEqual(["remove:ref-1", "pdb:1cbs"]);
  });

  test("replaces the normalised EMD label an EMDB volume ends up with", async () => {
    const studio = new FakeStudio({ library: [{ id: "ref-1", label: "EMD-1234" }] });

    await loadIntoStudio(studio, structurePayload("emdb", "1234"));

    expect(studio.events).toEqual(["remove:ref-1", "emdb:1234"]);
  });

  test("leaves unrelated objects alone", async () => {
    const studio = new FakeStudio({
      library: [
        { id: "ref-1", label: "2xyz" },
        { id: "ref-2", label: "EMD-9999" },
      ],
    });

    await loadIntoStudio(studio, structurePayload("pdb", "1CBS"));

    expect(studio.events).toEqual(["pdb:1CBS"]);
    expect(labelsOf(studio)).toEqual(["2xyz", "EMD-9999", "1CBS"]);
  });

  test("propagates a database loader failure", async () => {
    const studio = new FakeStudio({ failure: new Error("AlphaFold DB has no prediction for P00533 (HTTP 404).") });

    await expect(loadIntoStudio(studio, structurePayload("alphafold", "P00533"))).rejects.toThrow(/HTTP 404/);
  });

  test("a studio without getSnapshot/remove still loads a database entry", async () => {
    const loaded: string[] = [];
    const minimal: StudioLike = {
      async loadStructure() {},
      async loadVolume() {},
      async loadPdb(id) {
        loaded.push(id);
      },
    };

    await loadIntoStudio(minimal, structurePayload("pdb", "1CBS"));

    expect(loaded).toEqual(["1CBS"]);
  });
});

describe("loadIntoStudio marker sets", () => {
  test("draws one set through loadMarkers, passing the set through unchanged", async () => {
    const studio = new FakeStudio();
    const set = markerSet("prompt points", 3, 2);

    await loadIntoStudio(studio, markersPayload([set]));

    expect(studio.markerSets).toHaveLength(1);
    // Identity: the parsed set must reach MolStudio untouched (it becomes the
    // state node's params, so a copy would still work but a rewrite would not).
    expect(studio.markerSets[0]).toBe(set);
    expect(studio.calls).toHaveLength(0);
  });

  test("draws every set, in file order", async () => {
    const studio = new FakeStudio();
    const sets = [markerSet("first", 2), markerSet("second", 1, 1), markerSet("third")];

    await loadIntoStudio(studio, markersPayload(sets));

    expect(studio.markerSets).toEqual(sets);
    expect(studio.events).toEqual(["markers:first", "markers:second", "markers:third"]);
  });

  test("throws a clear error naming the missing loader", async () => {
    const studio = new FakeStudio({ markers: false });

    await expect(loadIntoStudio(studio, markersPayload([markerSet("a")]))).rejects.toThrow(/loadMarkers/);
    expect(studio.markerSets).toHaveLength(0);
    expect(studio.calls).toHaveLength(0);
  });

  test("a missing loader never mutates the object list", async () => {
    const studio = new FakeStudio({ markers: false, library: [{ id: "ref-1", label: "a" }] });

    await expect(loadIntoStudio(studio, markersPayload([markerSet("a")]))).rejects.toThrow(/loadMarkers/);

    expect(studio.events).toEqual([]);
    expect(studio.library).toEqual([{ id: "ref-1", label: "a" }]);
  });

  test("rejects a payload with no sets instead of showing an empty canvas", async () => {
    const studio = new FakeStudio({ library: [{ id: "ref-1", label: "a" }] });

    await expect(loadIntoStudio(studio, markersPayload([]))).rejects.toThrow(/no marker sets/);

    expect(studio.events).toEqual([]);
    expect(studio.library).toEqual([{ id: "ref-1", label: "a" }]);
  });

  test("replaces a same-label set and leaves everything else drawn", async () => {
    const studio = new FakeStudio({
      library: [
        { id: "ref-map", label: "emd_1234" },
        { id: "ref-markers", label: "prompt points" },
        { id: "ref-other", label: "other" },
      ],
    });

    await loadIntoStudio(studio, markersPayload([markerSet("prompt points", 2)]));

    // A marker model is drawn BESIDE the data it annotates: only the set with
    // the same label is replaced, the density map stays on screen.
    expect(studio.events).toEqual(["remove:ref-markers", "markers:prompt points"]);
    expect(labelsOf(studio)).toEqual(["emd_1234", "other", "prompt points"]);
  });

  test("draws every set even when two sets in one file share a label", async () => {
    // Chimera's default marker-set name is "markers", so a multi-set file can
    // legitimately repeat it. Removing per set would delete the set drawn a
    // moment earlier, silently losing all but the last one.
    const studio = new FakeStudio({ library: [{ id: "ref-old", label: "markers" }] });
    const sets = [markerSet("markers", 2), markerSet("markers", 3)];

    await loadIntoStudio(studio, markersPayload(sets));

    expect(studio.events).toEqual(["remove:ref-old", "markers:markers", "markers:markers"]);
    expect(studio.markerSets).toEqual(sets);
    expect(labelsOf(studio)).toEqual(["markers", "markers"]);
  });

  test("drawing the same set twice leaves one object, not two", async () => {
    const studio = new FakeStudio();
    const set = markerSet("prompt points", 4);

    await loadIntoStudio(studio, markersPayload([set]));
    await loadIntoStudio(studio, markersPayload([set]));

    expect(labelsOf(studio)).toEqual(["prompt points"]);
    expect(studio.events).toEqual(["markers:prompt points", "remove:ref-created-1", "markers:prompt points"]);
  });

  test("propagates a rejection from MolStudio's own set validation", async () => {
    // `validateMarkerSet` rejects an empty set; the message must reach the panel.
    const studio = new FakeStudio({ failure: new Error("Marker set empty has no markers.") });

    await expect(loadIntoStudio(studio, markersPayload([markerSet("empty", 0)]))).rejects.toThrow(
      /has no markers/,
    );
  });

  test("a studio without getSnapshot/remove still draws", async () => {
    const drawn: MarkerSet[] = [];
    const minimal: StudioLike = {
      async loadStructure() {},
      async loadVolume() {},
      async loadMarkers(set) {
        drawn.push(set);
      },
    };
    const set = markerSet("only");

    await loadIntoStudio(minimal, markersPayload([set]));

    expect(drawn).toEqual([set]);
  });
});

describe("loadIntoStudio replacement key (label + kind)", () => {
  test("a structure labelled like a marker set survives the marker load (F3)", async () => {
    // The verifier's repro: matching on the label alone deleted the structure.
    const studio = new FakeStudio({
      library: [{ id: "ref-structure", label: "markers", kind: "structure" }],
    });

    await loadIntoStudio(studio, markersPayload([markerSet("markers", 2)]));

    expect(studio.events).toEqual(["markers:markers"]);
    expect(studio.library).toEqual([
      { id: "ref-structure", label: "markers", kind: "structure" },
      { id: "ref-created-1", label: "markers", kind: "markers" },
    ]);
  });

  test("the converse: a marker object labelled like a structure survives the file load", async () => {
    const studio = new FakeStudio({
      library: [{ id: "ref-markers", label: "1abc", kind: "markers" }],
    });

    await loadIntoStudio(studio, bytesPayload("1abc.pdb", "END\n", "1abc"));

    expect(studio.events).toEqual(["loadStructure:1abc"]);
    expect(studio.library).toEqual([
      { id: "ref-markers", label: "1abc", kind: "markers" },
      { id: "ref-created-1", label: "1abc", kind: "structure" },
    ]);
  });

  test("three marker sets sharing a label all end up drawn", async () => {
    const studio = new FakeStudio({ library: [{ id: "ref-old", label: "markers", kind: "markers" }] });
    const sets = [markerSet("markers", 1), markerSet("markers", 2), markerSet("markers", 3)];

    await loadIntoStudio(studio, markersPayload(sets));

    expect(studio.events).toEqual([
      "remove:ref-old",
      "markers:markers",
      "markers:markers",
      "markers:markers",
    ]);
    expect(studio.markerSets).toEqual(sets);
    expect(studio.library.filter((object) => object.kind === "markers")).toHaveLength(3);
  });

  test("an EMDB volume is replaced by label and kind, not by label alone", async () => {
    const studio = new FakeStudio({
      library: [
        { id: "ref-volume", label: "EMD-1234", kind: "volume" },
        { id: "ref-structure", label: "EMD-1234", kind: "structure" },
      ],
    });

    await loadIntoStudio(studio, structurePayload("emdb", "1234"));

    // EMDB is a density map: only the volume with that label is replaced.
    expect(studio.events).toEqual(["remove:ref-volume", "emdb:1234"]);
    expect(studio.library).toEqual([
      { id: "ref-structure", label: "EMD-1234", kind: "structure" },
      { id: "ref-created-1", label: "EMD-1234", kind: "volume" },
    ]);
  });

  test("a studio that does not report object kinds still replaces by label", async () => {
    // The fallback is deliberate: removing nothing would silently stop
    // replacing, which is worse than the label-only match it degrades to.
    const studio = new FakeStudio({ library: [{ id: "ref-1", label: "1abc" }] });

    await loadIntoStudio(studio, bytesPayload("1abc.pdb", "END\n", "1abc"));

    expect(studio.events).toEqual(["remove:ref-1", "loadStructure:1abc"]);
    expect(labelsOf(studio)).toEqual(["1abc"]);
  });
});

describe("loadIntoStudio failures", () => {
  test("rejects marker files instead of loading nothing", async () => {
    const studio = new FakeStudio();
    const payload = bytesPayload("markers.cmm", '<marker_set name="s"/>\n');

    const attempt = loadIntoStudio(studio, payload);

    await expect(attempt).rejects.toThrow(/marker file/i);
    await expect(attempt).rejects.toThrow(/markers\.cmm|cmm/i);
    expect(studio.calls).toHaveLength(0);
  });

  test("rejects a format with no Mol* reader id", async () => {
    const studio = new FakeStudio();
    const broken: BioFormat = { id: "broken", kind: "structure", molstarFormat: "", exts: ["broken"], label: "Broken" };
    const payload: BioViewerPayload = {
      kind: "bytes",
      path: "/data/x.broken",
      title: "x",
      format: broken,
      bytes: encoder.encode("x\n"),
      gzip: false,
    };

    await expect(loadIntoStudio(studio, payload)).rejects.toThrow(/no Mol\* reader id/);
    expect(studio.calls).toHaveLength(0);
  });

  test("propagates a failure from the studio", async () => {
    const studio = new FakeStudio({ failure: new Error("The pdb data contains no atoms.") });

    await expect(loadIntoStudio(studio, bytesPayload("empty.pdb", "END\n", "empty"))).rejects.toThrow(
      "The pdb data contains no atoms.",
    );
  });
});

describe("loadIntoStudio replaces instead of accumulating", () => {
  test("removes an existing object with the same label before loading", async () => {
    const studio = new FakeStudio({ library: [{ id: "ref-1", label: "1abc" }] });

    await loadIntoStudio(studio, bytesPayload("1abc.pdb", "END\n", "1abc"));

    // Order matters: the stale object must be gone before the new one lands.
    expect(studio.events).toEqual(["remove:ref-1", "loadStructure:1abc"]);
    expect(labelsOf(studio)).toEqual(["1abc"]);
  });

  test("removes a same-label volume before loading the new map", async () => {
    const studio = new FakeStudio({ library: [{ id: "ref-map", label: "emd_1234" }] });

    await loadIntoStudio(studio, bytesPayload("emd_1234.map", new Uint8Array([0x00, 0x01]), "emd_1234"));

    expect(studio.events).toEqual(["remove:ref-map", "loadVolume:emd_1234"]);
  });

  test("leaves objects with other labels alone", async () => {
    const studio = new FakeStudio({
      library: [
        { id: "ref-1", label: "1abc" },
        { id: "ref-2", label: "2xyz" },
      ],
    });

    await loadIntoStudio(studio, bytesPayload("2xyz.pdb", "END\n", "2xyz"));

    expect(studio.events).toEqual(["remove:ref-2", "loadStructure:2xyz"]);
    expect(labelsOf(studio)).toEqual(["1abc", "2xyz"]);
  });

  test("removes every duplicate, not every other one (the snapshot is copied first)", async () => {
    const studio = new FakeStudio({
      library: [
        { id: "ref-1", label: "dup" },
        { id: "ref-2", label: "other" },
        { id: "ref-3", label: "dup" },
        { id: "ref-4", label: "dup" },
      ],
    });

    await loadIntoStudio(studio, bytesPayload("dup.pdb", "END\n", "dup"));

    expect(studio.events.filter((event) => event.startsWith("remove:"))).toEqual([
      "remove:ref-1",
      "remove:ref-3",
      "remove:ref-4",
    ]);
    expect(labelsOf(studio)).toEqual(["other", "dup"]);
  });

  test("a studio without getSnapshot/remove still loads (two-method double)", async () => {
    const calls: RecordedCall[] = [];
    const minimal: StudioLike = {
      async loadStructure(options) {
        calls.push({ method: "loadStructure", ...options });
      },
      async loadVolume(options) {
        calls.push({ method: "loadVolume", ...options });
      },
    };

    await loadIntoStudio(minimal, bytesPayload("1abc.pdb", "END\n", "1abc"));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("loadStructure");
  });

  test("a rejected input never touches the object list", async () => {
    const studio = new FakeStudio({ library: [{ id: "ref-1", label: "markers.cmm" }] });

    await expect(loadIntoStudio(studio, bytesPayload("markers.cmm", '<marker_set name="s"/>\n'))).rejects.toThrow(
      /marker/i,
    );

    expect(studio.events).toEqual([]);
    expect(studio.library).toEqual([{ id: "ref-1", label: "markers.cmm" }]);
  });
});

describe("format table coverage", () => {
  test("every table entry routes by kind", async () => {
    for (const format of BIO_FORMATS) {
      const studio = new FakeStudio();
      const payload: BioViewerPayload = {
        kind: "bytes",
        path: `/data/x.${format.exts[0]}`,
        title: format.id,
        format,
        bytes: encoder.encode("x\n"),
        gzip: false,
      };

      if (format.kind === "markers") {
        await expect(loadIntoStudio(studio, payload)).rejects.toThrow(/marker/i);
        expect(studio.calls).toHaveLength(0);
        continue;
      }

      await loadIntoStudio(studio, payload);
      expect(studio.calls).toHaveLength(1);
      const [call] = studio.calls;
      expect(call?.format).toBe(format.molstarFormat);
      expect(call?.label).toBe(format.id);
      if (format.kind === "volume") {
        expect(call?.method).toBe("loadVolume");
        expect(call?.data).toBeInstanceOf(Uint8Array);
      } else {
        expect(call?.method).toBe("loadStructure");
        expect(typeof call?.data).toBe("string");
      }
    }
  });
});
