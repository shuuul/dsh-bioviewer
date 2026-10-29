/**
 * Unit tests for the load adapter.
 *
 * `loadIntoStudio` is the only place that decides *how* a file reaches Mol*,
 * so these tests pin the routing rule (which entry point per `format.kind`),
 * the data shape (decoded text for structures/molecules, untouched bytes for
 * volumes) and the failure modes — all against a fake studio, with no WebGL
 * and no Mol* import.
 */
import { describe, expect, test } from "bun:test";
import { BIO_FORMATS, detectBioFile } from "../src/shared/formats";
import type { BioFormat } from "../src/shared/formats";
import { loadIntoStudio } from "../src/client/load";
import type { StudioLike, StudioObjectSummary } from "../src/client/load";

interface RecordedCall {
  readonly method: "loadStructure" | "loadVolume";
  readonly data: string | Uint8Array;
  readonly label: string;
  readonly format: string;
}

/** One object already in the fake's "Mol* state": only the fields we match on. */
interface FakeObject {
  readonly id: string;
  readonly label: string;
}

/** A `StudioLike` that records what it was asked to load and to remove. */
class FakeStudio implements StudioLike {
  readonly calls: RecordedCall[] = [];
  /** Every mutation in order, so a test can pin "remove, then load". */
  readonly events: string[] = [];
  /**
   * The fake's live "state tree". `getSnapshot()` hands it out by reference on
   * purpose: an adapter that iterates it while removing would skip entries.
   */
  readonly library: FakeObject[];
  readonly failure: Error | undefined;

  constructor(options: { failure?: Error; library?: readonly FakeObject[] } = {}) {
    this.failure = options.failure;
    this.library = [...(options.library ?? [])];
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

describe("loadIntoStudio routing", () => {
  test("loads a PDB structure as decoded text", async () => {
    const studio = new FakeStudio();
    const bytes = encoder.encode("HEADER    TEST\nATOM      1  N   ALA A   1\nEND\n");

    await loadIntoStudio(studio, { bytes, format: formatOf("1abc.pdb"), label: "1abc" });

    expect(studio.calls).toHaveLength(1);
    const [call] = studio.calls;
    expect(call?.method).toBe("loadStructure");
    expect(call?.format).toBe("pdb");
    expect(typeof call?.data).toBe("string");
    expect(call?.data).toBe("HEADER    TEST\nATOM      1  N   ALA A   1\nEND\n");
  });

  test("loads an mmCIF structure as text through loadStructure", async () => {
    const studio = new FakeStudio();

    await loadIntoStudio(studio, {
      bytes: encoder.encode("data_1abc\n#\n"),
      format: formatOf("1abc.cif"),
      label: "1abc",
    });

    expect(studio.calls[0]?.method).toBe("loadStructure");
    expect(studio.calls[0]?.format).toBe("mmcif");
    expect(studio.calls[0]?.data).toBe("data_1abc\n#\n");
  });

  test("loads a small molecule (SDF) through loadStructure as text", async () => {
    const studio = new FakeStudio();

    await loadIntoStudio(studio, {
      bytes: encoder.encode("acetone\n\n  9  8  0  0  0  0  0  0  0  0999 V2000\nM  END\n$$$$\n"),
      format: formatOf("ligand.sdf"),
      label: "ligand",
    });

    expect(studio.calls[0]?.method).toBe("loadStructure");
    expect(studio.calls[0]?.format).toBe("sdf");
    expect(typeof studio.calls[0]?.data).toBe("string");
  });

  test("decodes multi-byte text without loss", async () => {
    const studio = new FakeStudio();
    const text = "REMARK 日本語ラベル — ünïcødé\n";

    await loadIntoStudio(studio, { bytes: encoder.encode(text), format: formatOf("x.pdb"), label: "x" });

    expect(studio.calls[0]?.data).toBe(text);
  });

  test("loads a CCP4/MRC map through loadVolume with the bytes untouched", async () => {
    const studio = new FakeStudio();
    // Deliberately not valid UTF-8: a text decode would mangle these bytes.
    const bytes = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0xff, 0xfe, 0x80, 0x7f]);

    await loadIntoStudio(studio, { bytes, format: formatOf("emd_1234.map"), label: "emd_1234" });

    expect(studio.calls).toHaveLength(1);
    const [call] = studio.calls;
    expect(call?.method).toBe("loadVolume");
    expect(call?.format).toBe("ccp4");
    expect(call?.data).toBeInstanceOf(Uint8Array);
    // Identity, not just equality: volumes must not be copied or re-encoded.
    expect(call?.data).toBe(bytes);
    expect(Array.from(call.data as Uint8Array)).toEqual([0x00, 0x00, 0x01, 0x00, 0xff, 0xfe, 0x80, 0x7f]);
  });

  test("passes the label through unchanged", async () => {
    const studio = new FakeStudio();
    const label = "1abc assembly — chain A (final).pdb";

    await loadIntoStudio(studio, { bytes: encoder.encode("END\n"), format: formatOf("1abc.pdb"), label });

    expect(studio.calls[0]?.label).toBe(label);
  });

  test("uses format.molstarFormat as the Mol* reader id, not format.id", async () => {
    const studio = new FakeStudio();

    await loadIntoStudio(studio, {
      bytes: encoder.encode("data_x\n"),
      format: formatOf("model.mmcif"),
      label: "model",
    });

    expect(studio.calls[0]?.format).toBe("mmcif");
  });
});

describe("loadIntoStudio failures", () => {
  test("rejects marker files instead of loading nothing", async () => {
    const studio = new FakeStudio();

    const attempt = loadIntoStudio(studio, {
      bytes: encoder.encode("<marker_set name=\"s\"/>\n"),
      format: formatOf("markers.cmm"),
      label: "markers",
    });

    await expect(attempt).rejects.toThrow(/marker file/i);
    await expect(attempt).rejects.toThrow(/markers\.cmm|cmm/i);
    expect(studio.calls).toHaveLength(0);
  });

  test("rejects a format with no Mol* reader id", async () => {
    const studio = new FakeStudio();
    const broken: BioFormat = { id: "broken", kind: "structure", molstarFormat: "", exts: ["broken"], label: "Broken" };

    await expect(
      loadIntoStudio(studio, { bytes: encoder.encode("x\n"), format: broken, label: "x" }),
    ).rejects.toThrow(/no Mol\* reader id/);
    expect(studio.calls).toHaveLength(0);
  });

  test("propagates a failure from the studio", async () => {
    const studio = new FakeStudio({ failure: new Error("The pdb data contains no atoms.") });

    await expect(
      loadIntoStudio(studio, { bytes: encoder.encode("END\n"), format: formatOf("empty.pdb"), label: "empty" }),
    ).rejects.toThrow("The pdb data contains no atoms.");
  });
});

describe("loadIntoStudio replaces instead of accumulating", () => {
  test("removes an existing object with the same label before loading", async () => {
    const studio = new FakeStudio({ library: [{ id: "ref-1", label: "1abc" }] });

    await loadIntoStudio(studio, { bytes: encoder.encode("END\n"), format: formatOf("1abc.pdb"), label: "1abc" });

    // Order matters: the stale object must be gone before the new one lands.
    expect(studio.events).toEqual(["remove:ref-1", "loadStructure:1abc"]);
    expect(studio.library).toEqual([]);
  });

  test("removes a same-label volume before loading the new map", async () => {
    const studio = new FakeStudio({ library: [{ id: "ref-map", label: "emd_1234" }] });

    await loadIntoStudio(studio, {
      bytes: new Uint8Array([0x00, 0x01]),
      format: formatOf("emd_1234.map"),
      label: "emd_1234",
    });

    expect(studio.events).toEqual(["remove:ref-map", "loadVolume:emd_1234"]);
  });

  test("leaves objects with other labels alone", async () => {
    const studio = new FakeStudio({
      library: [
        { id: "ref-1", label: "1abc" },
        { id: "ref-2", label: "2xyz" },
      ],
    });

    await loadIntoStudio(studio, { bytes: encoder.encode("END\n"), format: formatOf("2xyz.pdb"), label: "2xyz" });

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

    await loadIntoStudio(studio, { bytes: encoder.encode("END\n"), format: formatOf("dup.pdb"), label: "dup" });

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

    await loadIntoStudio(minimal, { bytes: encoder.encode("END\n"), format: formatOf("1abc.pdb"), label: "1abc" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("loadStructure");
  });

  test("a rejected input never touches the object list", async () => {
    const studio = new FakeStudio({ library: [{ id: "ref-1", label: "markers" }] });

    await expect(
      loadIntoStudio(studio, {
        bytes: encoder.encode("<marker_set name=\"s\"/>\n"),
        format: formatOf("markers.cmm"),
        label: "markers",
      }),
    ).rejects.toThrow(/marker/i);

    expect(studio.events).toEqual([]);
    expect(studio.library).toEqual([{ id: "ref-1", label: "markers" }]);
  });
});

describe("format table coverage", () => {
  test("every table entry routes by kind", async () => {
    for (const format of BIO_FORMATS) {
      const studio = new FakeStudio();
      const input = { bytes: encoder.encode("x\n"), format, label: format.id };

      if (format.kind === "markers") {
        await expect(loadIntoStudio(studio, input)).rejects.toThrow(/marker/i);
        expect(studio.calls).toHaveLength(0);
        continue;
      }

      await loadIntoStudio(studio, input);
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
