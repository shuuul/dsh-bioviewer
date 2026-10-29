/**
 * The bio-file format table: pure data, zero imports.
 *
 * This module is the single source of truth for "which files can dsh-bioviewer
 * open, and how does Mol* read them". It must stay importable from both the
 * plugin's host half and its client half, and from tests that have neither
 * DSH nor React nor Mol* available, so it deliberately imports nothing.
 *
 * `molstarFormat` values are Mol* reader identifiers, not our invention:
 * - structures/molecules: `BuiltInTrajectoryFormat` from
 *   `molstar/lib/mol-plugin-state/formats/trajectory` (mmcif, cifCore, pdb,
 *   pdbqt, pqr, gro, xyz, lammps_data, lammps_traj_data, mol, sdf, mol2) —
 *   these are what `MolStudio.loadStructure({ format })` accepts;
 * - volumes: `VolumeFormat` from `@molstudio/core` (ccp4, dsn6, cube, dx,
 *   dscif) — what `MolStudio.loadVolume({ format })` accepts;
 * - markers: `""` on purpose, `.cmm` is rendered by our own overlay code and
 *   never reaches MolStudio.
 *
 * ── Routing model (why `exts` holds plain extensions only) ────────────────
 * better-sidebar matches a file viewer descriptor's `exts` against the LAST
 * dot segment of the path (`node_modules/dsh-better-sidebar/src/client/paths.ts:104`):
 *
 *     extOf(path) { const at = path.lastIndexOf('.'); ... path.slice(at + 1).toLowerCase() }
 *
 * measured against the installed 0.28.2 source:
 *     extOf("1abc.pdb")     -> "pdb"
 *     extOf("1abc.pdb.gz")  -> "gz"
 *     extOf("/data/map.mrc.gz") -> "gz"
 *
 * So a compound entry such as `"pdb.gz"` can NEVER match — it is inert — and
 * adding `"gz"` to a format's `exts` is wrong too: that would claim every
 * compressed file in the extension pass, including non-bio ones. Compressed bio
 * files are therefore routed by a separate sniff-only catch-all descriptor
 * (`exts: []` + `detect`) registered in `src/client/index.tsx`, which the host
 * consults only once it has head bytes for a binary file.
 *
 * Decompression is independent of routing: {@link detectBioFile} strips a
 * trailing `.gz` itself and reports `gzip: true`, which is what tells
 * `fetchBioBytes` to inflate. This table never needs gz entries.
 */

/** Which MolStudio entry point (or none) owns a format. */
export type BioKind = "structure" | "volume" | "molecule" | "markers";

export interface BioFormat {
  readonly id: string;
  readonly kind: BioKind;
  /** Mol* reader id passed to `loadStructure` / `loadVolume`; `""` for markers. */
  readonly molstarFormat: string;
  /**
   * Lowercase extensions without a leading dot and without any `.gz` variant:
   * these are handed straight to `registerFileViewer({ exts })`, which the host
   * matches against the last dot segment of a path (see the routing note at the
   * top of this file — `1abc.pdb.gz` has extension `gz`, not `pdb.gz`).
   */
  readonly exts: readonly string[];
  /** Human-readable name for UI surfaces. */
  readonly label: string;
}

export const BIO_FORMATS: readonly BioFormat[] = Object.freeze<BioFormat[]>([
  {
    id: "pdb",
    kind: "structure",
    molstarFormat: "pdb",
    exts: ["pdb", "ent"],
    label: "PDB structure",
  },
  {
    id: "mmcif",
    kind: "structure",
    molstarFormat: "mmcif",
    exts: ["cif", "mmcif", "mcif"],
    label: "mmCIF structure",
  },
  {
    id: "ccp4",
    kind: "volume",
    molstarFormat: "ccp4",
    exts: ["mrc", "map", "ccp4"],
    label: "CCP4/MRC density map",
  },
  {
    id: "sdf",
    kind: "molecule",
    molstarFormat: "sdf",
    exts: ["sdf", "sd"],
    label: "SDF molecule",
  },
  {
    id: "mol",
    kind: "molecule",
    molstarFormat: "mol",
    exts: ["mol"],
    label: "MOL molecule",
  },
  {
    id: "mol2",
    kind: "molecule",
    molstarFormat: "mol2",
    exts: ["mol2"],
    label: "MOL2 molecule",
  },
  {
    id: "pdbqt",
    kind: "molecule",
    molstarFormat: "pdbqt",
    exts: ["pdbqt"],
    label: "PDBQT molecule",
  },
  {
    id: "gro",
    kind: "molecule",
    molstarFormat: "gro",
    exts: ["gro"],
    label: "GRO structure",
  },
  {
    id: "xyz",
    kind: "molecule",
    molstarFormat: "xyz",
    exts: ["xyz"],
    label: "XYZ coordinates",
  },
  {
    id: "cmm",
    kind: "markers",
    molstarFormat: "",
    exts: ["cmm"],
    label: "Chimera markers",
  },
]);

/**
 * Flat, sorted, de-duplicated list of the 16 plain extensions the plugin
 * renders: `["ccp4", "cif", "cmm", "ent", ...]`.
 *
 * This is the extension surface of the plugin (what the viewer descriptors
 * claim and what the tests enumerate) — it is NOT the routing table for
 * compressed files. A `.gz` file's extension is literally `gz`, so compressed
 * bio files are matched by a sniff-only catch-all descriptor instead; see the
 * routing note at the top of this file.
 *
 * Plain `.sort()` (UTF-16 code units) on purpose — locale-aware sorting is
 * environment-dependent and would make this list non-reproducible.
 */
export const BIO_EXTENSIONS: readonly string[] = Object.freeze(
  [...new Set(BIO_FORMATS.flatMap((format) => format.exts))].sort(),
);

/** Extension -> format lookup; built once from {@link BIO_FORMATS}. */
const FORMAT_BY_EXT: ReadonlyMap<string, BioFormat> = new Map(
  BIO_FORMATS.flatMap((format) => format.exts.map((ext) => [ext, format] as const)),
);

/** The last `/`- or `\`-separated segment of a path (the path itself if none). */
function baseNameOf(path: string): string {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at === -1 ? path : path.slice(at + 1);
}

export interface DetectedBioFile {
  readonly format: BioFormat;
  /** True when the file name ends in `.gz`; the caller must gunzip the bytes. */
  readonly gzip: boolean;
  /**
   * The file's base name with a trailing `.gz` removed; the format extension
   * stays on. `"/data/1abc.pdb.gz"` -> `"1abc.pdb"`, `"1abc.pdb"` -> `"1abc.pdb"`.
   */
  readonly baseName: string;
}

/**
 * Resolves `name.ext` / `name.ext.gz` (or any path ending in one) to its
 * format. Case-insensitive; only the base name is inspected. Returns
 * `undefined` for unknown extensions, names without an extension, and dotfiles
 * such as `.pdb` (the dot must not be the first character of the base name).
 *
 * The trailing `.gz` is stripped here, before the extension is looked up, so
 * every format works compressed without any gz entry in {@link BIO_FORMATS}.
 */
export function detectBioFile(pathOrName: string): DetectedBioFile | undefined {
  const base = baseNameOf(pathOrName);
  if (base === "") return undefined;
  const gzip = base.toLowerCase().endsWith(".gz");
  const name = gzip ? base.slice(0, -".gz".length) : base;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const format = FORMAT_BY_EXT.get(name.slice(dot + 1).toLowerCase());
  if (format === undefined) return undefined;
  return { format, gzip, baseName: name };
}

/** True when {@link detectBioFile} recognizes the name. */
export function isBioFile(pathOrName: string): boolean {
  return detectBioFile(pathOrName) !== undefined;
}
