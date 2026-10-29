/**
 * The format table's `molstarFormat` values are **facts about Mol\***, not
 * choices: each one is looked up in Mol\*'s reader registry at runtime, and an
 * unknown id fails there with `Mol* has no volume reader for format "x"` (or an
 * empty structure for a trajectory). Neither failure is visible until a user
 * opens a file, and neither is caught by `tsc` — the ids are plain strings on
 * the `@molstudio/core` boundary.
 *
 * So this test asks Mol\* itself. It reads the real built-in reader registries
 * and asserts every id we declare is a member, which is what makes adding a
 * format a two-line change with a guaranteed failure if the id is wrong.
 */
import { describe, expect, test } from "bun:test";
import { BIO_FORMATS } from "../src/shared/formats";

/** `[id, provider]` pairs from Mol*'s built-in registries. */
type Registry = readonly (readonly [string, unknown])[];

const trajectory = (await import("molstar/lib/mol-plugin-state/formats/trajectory"))
  .BuiltInTrajectoryFormats as Registry;
const volume = (await import("molstar/lib/mol-plugin-state/formats/volume"))
  .BuiltInVolumeFormats as Registry;

const trajectoryIds = new Set(trajectory.map((entry) => entry[0]));
const volumeIds = new Set(volume.map((entry) => entry[0]));

describe("molstarFormat values against Mol*'s real reader registry", () => {
  test("the registries were actually read (not vacuous)", () => {
    expect(trajectoryIds.size).toBeGreaterThan(5);
    expect(volumeIds.size).toBeGreaterThan(2);
    // Spot-check ids that must exist in any Mol* 5.x build, so a silently
    // renamed export cannot make this whole file pass by matching nothing.
    expect(trajectoryIds.has("pdb")).toBe(true);
    expect(trajectoryIds.has("mmcif")).toBe(true);
    expect(volumeIds.has("ccp4")).toBe(true);
  });

  test("every structure/molecule format names a real trajectory reader", () => {
    const wrong = BIO_FORMATS.filter(
      (format) => (format.kind === "structure" || format.kind === "molecule") && !trajectoryIds.has(format.molstarFormat),
    ).map((format) => `${format.id} -> "${format.molstarFormat}"`);
    expect(wrong).toEqual([]);
  });

  test("every volume format names a real volume reader", () => {
    const wrong = BIO_FORMATS.filter(
      (format) => format.kind === "volume" && !volumeIds.has(format.molstarFormat),
    ).map((format) => `${format.id} -> "${format.molstarFormat}"`);
    expect(wrong).toEqual([]);
  });

  test("marker models declare no reader, because Mol* has none to declare", () => {
    const markers = BIO_FORMATS.filter((format) => format.kind === "markers");
    expect(markers.length).toBeGreaterThan(0);
    for (const format of markers) {
      expect(format.molstarFormat).toBe("");
      expect(trajectoryIds.has("cmm")).toBe(false);
      expect(volumeIds.has("cmm")).toBe(false);
    }
  });
});
