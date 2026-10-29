import { describe, expect, test } from "bun:test";
import { isMarkerPayload, parseCmm } from "../src/client/cmm";

const SAMPLE = `<?xml version="1.0"?>
<marker_set name="example_prompt">
  <marker id="1" x="59.4500" y="95.1850" z="24.3564" r="1.0" g="0.0" b="0.0" radius="1.5" />
  <marker id="2" x="-1.25" y="0" z="7e2" />
  <link id1="1" id2="2" r="1" g="1" b="1" radius="0.1" />
</marker_set>`;

describe("parseCmm", () => {
  test("reads the marker set name, markers and links", () => {
    const summary = parseCmm(SAMPLE);
    expect(summary.setName).toBe("example_prompt");
    expect(summary.markers).toHaveLength(2);
    expect(summary.markers[0]).toEqual({ id: "1", x: 59.45, y: 95.185, z: 24.3564, radius: 1.5 });
    expect(summary.markers[1]).toEqual({ id: "2", x: -1.25, y: 0, z: 700, radius: null });
    expect(summary.links).toEqual([{ id1: "1", id2: "2" }]);
    expect(summary.skipped).toBe(0);
  });

  test("does not confuse <marker_set> with a <marker> element", () => {
    expect(parseCmm(SAMPLE).markers.map((marker) => marker.id)).toEqual(["1", "2"]);
  });

  test("accepts single-quoted attributes and a missing name", () => {
    const summary = parseCmm("<marker_set><marker id='a' x='1' y='2' z='3'/></marker_set>");
    expect(summary.setName).toBeNull();
    expect(summary.markers).toEqual([{ id: "a", x: 1, y: 2, z: 3, radius: null }]);
  });

  test("counts markers missing a required attribute as skipped, not as markers", () => {
    const summary = parseCmm(
      '<marker_set name="s"><marker id="1" x="1" y="2"/><marker x="1" y="2" z="3"/><marker id="3" x="q" y="2" z="3"/></marker_set>',
    );
    expect(summary.markers).toHaveLength(0);
    expect(summary.skipped).toBe(3);
  });

  test("drops links whose endpoints are not both defined and counts them as skipped", () => {
    const summary = parseCmm(
      '<marker_set name="s"><marker id="1" x="1" y="2" z="3"/><link id1="1" id2="9"/><link id1="1" id2="1"/></marker_set>',
    );
    expect(summary.links).toEqual([{ id1: "1", id2: "1" }]);
    expect(summary.skipped).toBe(1);
  });

  test("never throws on input that is not a marker model", () => {
    for (const input of ["", "not xml at all", "<html><body>hi</body></html>", "<marker_set name='x'>"]) {
      const summary = parseCmm(input);
      expect(summary.markers).toEqual([]);
      expect(summary.links).toEqual([]);
    }
  });

  test("ignores a radius that is not a number", () => {
    expect(parseCmm('<marker id="1" x="1" y="2" z="3" radius="wide"/>').markers[0]?.radius).toBeNull();
  });
});

describe("isMarkerPayload", () => {
  test("recognises a marker payload", () => {
    expect(isMarkerPayload({ path: "a.cmm", title: "a.cmm", summary: parseCmm(SAMPLE), gzip: false })).toBe(true);
  });

  test("rejects a Mol* payload and non-objects", () => {
    expect(isMarkerPayload({ path: "a.pdb", title: "a.pdb", bytes: new Uint8Array(), gzip: false })).toBe(false);
    expect(isMarkerPayload(undefined)).toBe(false);
    expect(isMarkerPayload(null)).toBe(false);
    expect(isMarkerPayload("a.cmm")).toBe(false);
    expect(isMarkerPayload({ summary: {} })).toBe(false);
  });
});
