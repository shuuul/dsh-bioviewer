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
import { BIO_FORMATS, detectBioFile } from "../src/shared/formats";
import type { BioFormat } from "../src/shared/formats";
import { structureTitle } from "../src/shared/opens";
import type { StructureSource } from "../src/shared/opens";
import { loadIntoStudio } from "../src/client/load";
import type { StudioLike, StudioObjectSummary } from "../src/client/load";
import type { BioViewerPayload, StructurePayload } from "../src/client/payload";

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
}

/**
 * A `StudioLike` that records what it was asked to load and to remove.
 *
 * All three database loaders exist unless `sources` narrows them, so a test can
 * build the "studio without this loader" case the adapter must reject.
 */
class FakeStudio implements StudioLike {
  readonly calls: RecordedCall[] = [];
  readonly database: RecordedDatabaseCall[] = [];
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

  constructor(
    options: { failure?: Error; library?: readonly FakeObject[]; sources?: readonly StructureSource[] } = {},
  ) {
    this.failure = options.failure;
    this.library = [...(options.library ?? [])];
    const sources = options.sources ?? ["pdb", "alphafold", "emdb"];
    const record = (source: StructureSource) => async (id: string): Promise<void> => {
      this.events.push(`${source}:${id}`);
      this.database.push({ source, id });
      if (this.failure !== undefined) throw this.failure;
    };
    if (sources.includes("pdb")) this.loadPdb = record("pdb");
    if (sources.includes("alphafold")) this.loadAlphaFoldDb = record("alphafold");
    if (sources.includes("emdb")) this.loadEmdb = record("emdb");
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
    if (this.failure !== undefined) throw this.failure;
  }

  async loadVolume(options: { data: string | Uint8Array; label: string; format: string }): Promise<void> {
    this.events.push(`loadVolume:${options.label}`);
    this.calls.push({ method: "loadVolume", ...options });
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
    expect(studio.library).toEqual([]);
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
    expect(studio.library).toHaveLength(2);
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
    expect(studio.library).toEqual([]);
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
    expect(studio.library).toEqual([{ id: "ref-1", label: "1abc" }]);
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
    expect(studio.library).toEqual([{ id: "ref-2", label: "other" }]);
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
