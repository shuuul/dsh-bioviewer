import { describe, expect, test } from "bun:test";
import {
  BIO_EXTENSIONS,
  BIO_FORMATS,
  detectBioFile,
  isBioFile,
  isBinaryCifFile,
  type BioFormat,
  type BioKind,
} from "../src/shared/formats";
import * as shared from "../src/shared/index";

/** The mapping frozen by the task contract: extension -> expected reader. */
const EXPECTED: Readonly<Record<string, { id: string; kind: BioKind; molstarFormat: string }>> = {
  pdb: { id: "pdb", kind: "structure", molstarFormat: "pdb" },
  ent: { id: "pdb", kind: "structure", molstarFormat: "pdb" },
  cif: { id: "mmcif", kind: "structure", molstarFormat: "mmcif" },
  mmcif: { id: "mmcif", kind: "structure", molstarFormat: "mmcif" },
  mcif: { id: "mmcif", kind: "structure", molstarFormat: "mmcif" },
  bcif: { id: "mmcif", kind: "structure", molstarFormat: "mmcif" },
  mrc: { id: "ccp4", kind: "volume", molstarFormat: "ccp4" },
  map: { id: "ccp4", kind: "volume", molstarFormat: "ccp4" },
  ccp4: { id: "ccp4", kind: "volume", molstarFormat: "ccp4" },
  sdf: { id: "sdf", kind: "molecule", molstarFormat: "sdf" },
  sd: { id: "sdf", kind: "molecule", molstarFormat: "sdf" },
  mol: { id: "mol", kind: "molecule", molstarFormat: "mol" },
  mol2: { id: "mol2", kind: "molecule", molstarFormat: "mol2" },
  pdbqt: { id: "pdbqt", kind: "molecule", molstarFormat: "pdbqt" },
  gro: { id: "gro", kind: "molecule", molstarFormat: "gro" },
  xyz: { id: "xyz", kind: "molecule", molstarFormat: "xyz" },
  cmm: { id: "cmm", kind: "markers", molstarFormat: "" },
};

/** Mol* `BuiltInTrajectoryFormat` ids (molstar 5.13.1). */
const TRAJECTORY_FORMATS = new Set([
  "mmcif",
  "cifCore",
  "pdb",
  "pdbqt",
  "pqr",
  "gro",
  "xyz",
  "lammps_data",
  "lammps_traj_data",
  "mol",
  "sdf",
  "mol2",
]);

/** `@molstudio/core` `VolumeFormat` ids. */
const VOLUME_FORMATS = new Set(["ccp4", "dsn6", "cube", "dx", "dscif"]);

const UNKNOWN_NAMES = [
  "readme.md",
  "notes.txt",
  "archive.zip",
  "noextension",
  ".pdb",
  ".gz",
  "trailing.",
  "1abc.pdb.bak",
  "1abc.pdbx",
  "mol3.cif.bak",
  "cmm.txt",
  "",
  "/data/pdb/readme.txt",
];

describe("BIO_EXTENSIONS", () => {
  test("is flat, lowercase, dot-free and sorted", () => {
    expect(BIO_EXTENSIONS.length).toBeGreaterThan(0);
    expect(new Set(BIO_EXTENSIONS).size).toBe(BIO_EXTENSIONS.length);
    expect([...BIO_EXTENSIONS]).toEqual([...BIO_EXTENSIONS].sort());
    for (const ext of BIO_EXTENSIONS) {
      expect(ext).toBe(ext.toLowerCase());
      expect(ext.startsWith(".")).toBe(false);
      expect(ext.includes(".")).toBe(false);
      expect(ext.length).toBeGreaterThan(0);
    }
  });

  test("is exactly the union of the per-format extension lists", () => {
    const union = [...new Set(BIO_FORMATS.flatMap((format) => format.exts))].sort();
    expect([...BIO_EXTENSIONS]).toEqual(union);
  });

  test("covers every contracted extension and holds exactly the 17 plain ones", () => {
    for (const ext of Object.keys(EXPECTED)) {
      expect(BIO_EXTENSIONS).toContain(ext);
    }
    expect(new Set(BIO_EXTENSIONS)).toEqual(new Set(Object.keys(EXPECTED)));
    expect(BIO_EXTENSIONS.length).toBe(17);
  });

  test("has no gz entries: a `.gz` file's host-side extension is literally `gz`", () => {
    // better-sidebar matches descriptor exts against `extOf(path)`, which is the
    // LAST dot segment: extOf("1abc.pdb.gz") === "gz". Compound entries such as
    // "pdb.gz" can never match, so they must not appear here (or in `exts`);
    // compressed files are routed by the sniff-only catch-all descriptor.
    for (const ext of BIO_EXTENSIONS) {
      expect(ext.endsWith(".gz")).toBe(false);
    }
    expect(BIO_EXTENSIONS).not.toContain("gz");
  });
});

describe("BIO_FORMATS", () => {
  test("format ids are unique and extensions are claimed by exactly one format", () => {
    const ids = BIO_FORMATS.map((format) => format.id);
    expect(new Set(ids).size).toBe(ids.length);
    const claims = BIO_FORMATS.flatMap((format) => format.exts);
    expect(new Set(claims).size).toBe(claims.length);
  });

  test("every format declares lowercase, dot-free extensions only", () => {
    for (const format of BIO_FORMATS) {
      expect(format.exts.length).toBeGreaterThan(0);
      expect(format.label.length).toBeGreaterThan(0);
      for (const ext of format.exts) {
        expect(ext).toBe(ext.toLowerCase());
        expect(ext.startsWith(".")).toBe(false);
        // No compound entries: the host matches the LAST dot segment, so
        // "pdb.gz" is dead weight and plain "gz" would claim every .gz file.
        expect(ext.includes(".")).toBe(false);
        expect(ext).not.toBe("gz");
      }
    }
  });

  test("molstarFormat is a real reader id for its kind", () => {
    for (const format of BIO_FORMATS) {
      if (format.kind === "markers") {
        expect(format.molstarFormat).toBe("");
      } else if (format.kind === "volume") {
        expect(VOLUME_FORMATS.has(format.molstarFormat)).toBe(true);
      } else {
        expect(TRAJECTORY_FORMATS.has(format.molstarFormat)).toBe(true);
      }
    }
  });

  test("only cmm is a markers format", () => {
    const markers = BIO_FORMATS.filter((format) => format.kind === "markers");
    expect(markers.map((format) => format.id)).toEqual(["cmm"]);
    expect(markers[0]?.exts).toEqual(["cmm"]);
  });
});

describe("detectBioFile", () => {
  test("every extension in BIO_EXTENSIONS round-trips, plain and .gz", () => {
    for (const ext of BIO_EXTENSIONS) {
      const detected = detectBioFile(`sample.${ext}`);
      expect(detected).toBeDefined();
      const { format, gzip, baseName } = detected as NonNullable<typeof detected>;
      expect(format.exts).toContain(ext);
      expect(gzip).toBe(false);
      expect(baseName).toBe(`sample.${ext}`);
      expect(isBioFile(`sample.${ext}`)).toBe(true);

      // The same file compressed: routing is the catch-all descriptor's job,
      // detection is ours, and it must strip only the .gz.
      const compressed = detectBioFile(`sample.${ext}.gz`);
      expect(compressed).toBeDefined();
      const gz = compressed as NonNullable<typeof compressed>;
      expect(gz.format).toBe(format);
      expect(gz.gzip).toBe(true);
      expect(gz.baseName).toBe(`sample.${ext}`);
      expect(isBioFile(`sample.${ext}.gz`)).toBe(true);
    }
  });

  test("maps every contracted extension to the contracted reader", () => {
    for (const [ext, expected] of Object.entries(EXPECTED)) {
      for (const name of [`sample.${ext}`, `sample.${ext}.gz`]) {
        const detected = detectBioFile(name);
        expect(detected).toBeDefined();
        const format = (detected as NonNullable<typeof detected>).format;
        expect(format.id).toBe(expected.id);
        expect(format.kind).toBe(expected.kind);
        expect(format.molstarFormat).toBe(expected.molstarFormat);
      }
    }
  });

  test("is case-insensitive for the name and the extension", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["SAMPLE.PDB", "pdb"],
      ["Sample.Pdb", "pdb"],
      ["SAMPLE.ENT", "pdb"],
      ["Sample.MmCif", "mmcif"],
      ["1ABC.MMCIF", "mmcif"],
    ];
    for (const [name, id] of cases) {
      expect(detectBioFile(name)?.format.id).toBe(id);
      expect(detectBioFile(name)?.baseName).toBe(name);
    }
    expect(detectBioFile("1ABC.MAP")?.format.id).toBe("ccp4");
    expect(detectBioFile("LIGAND.SDF")?.format.id).toBe("sdf");
    expect(detectBioFile("1ABC.PDB.GZ")).toEqual({
      format: expect.objectContaining({ id: "pdb" }),
      gzip: true,
      baseName: "1ABC.PDB",
    });
    expect(detectBioFile("map.MRC.Gz")?.gzip).toBe(true);
    expect(detectBioFile("map.MRC.Gz")?.format.id).toBe("ccp4");
  });

  test("gz variants set gzip:true and strip only the .gz from baseName", () => {
    expect(detectBioFile("1abc.pdb.gz")).toEqual({
      format: expect.objectContaining({ id: "pdb", molstarFormat: "pdb" }),
      gzip: true,
      baseName: "1abc.pdb",
    });
    expect(detectBioFile("1abc.pdb")).toEqual({
      format: expect.objectContaining({ id: "pdb" }),
      gzip: false,
      baseName: "1abc.pdb",
    });
    expect(detectBioFile("emd-1234.map.gz")?.baseName).toBe("emd-1234.map");
    expect(detectBioFile("ligand.sd.gz")?.baseName).toBe("ligand.sd");
    expect(detectBioFile("markers.cmm.gz")?.baseName).toBe("markers.cmm");
  });

  test("resolves by base name when the path has directories", () => {
    expect(detectBioFile("/data/structures/1abc.pdb")).toEqual({
      format: expect.objectContaining({ id: "pdb" }),
      gzip: false,
      baseName: "1abc.pdb",
    });
    expect(detectBioFile("./runs/7/emd.map.gz")?.format.id).toBe("ccp4");
    expect(detectBioFile("./runs/7/emd.map.gz")?.baseName).toBe("emd.map");
    expect(detectBioFile("C:\\data\\1abc.cif")?.format.id).toBe("mmcif");
    expect(detectBioFile("C:\\data\\1abc.cif")?.baseName).toBe("1abc.cif");
    // A directory whose name looks like a bio extension must not leak in.
    expect(detectBioFile("/data/pdb/readme.txt")).toBeUndefined();
  });

  test("unknown names return undefined", () => {
    for (const name of UNKNOWN_NAMES) {
      expect(detectBioFile(name)).toBeUndefined();
      expect(isBioFile(name)).toBe(false);
    }
  });

  test("isBioFile mirrors detectBioFile", () => {
    for (const name of ["1abc.pdb", "1abc.pdb.gz", "LIG.SDF", "x.cmm.gz"]) {
      expect(isBioFile(name)).toBe(true);
    }
  });

  test("isBinaryCifFile is true only for .bcif names, including gzip", () => {
    expect(isBinaryCifFile("1abc.bcif")).toBe(true);
    expect(isBinaryCifFile("/data/1ABC.BCIF")).toBe(true);
    expect(isBinaryCifFile("1abc.bcif.gz")).toBe(true);
    expect(isBinaryCifFile("1abc.cif")).toBe(false);
    expect(isBinaryCifFile("1abc.pdb")).toBe(false);
    expect(isBinaryCifFile("notes.txt")).toBe(false);
  });
});

describe("src/shared/index", () => {
  test("re-exports the format table", () => {
    expect(shared.BIO_FORMATS).toBe(BIO_FORMATS);
    expect(shared.BIO_EXTENSIONS).toBe(BIO_EXTENSIONS);
    expect(shared.detectBioFile("1abc.pdb")?.format.id).toBe("pdb");
    expect(shared.isBioFile("1abc.pdb.gz")).toBe(true);
    const format: BioFormat | undefined = shared.detectBioFile("x.mol2")?.format;
    expect(format?.kind).toBe("molecule");
  });
});
