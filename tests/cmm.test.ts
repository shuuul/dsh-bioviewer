import { describe, expect, test } from "bun:test";
import { parseCmmMarkerSets } from "../src/client/cmm";

/** BioViewer's own example fixture, `test-resources/examples/blob_1_NDP_1_prompt.cmm`. */
const SINGLE_SET = `<marker_set name="blob_1_NDP_1_prompt">
  <marker id="1" x="59.4500" y="95.1850" z="24.3564" r="1.0" g="0.0" b="0.0" radius="1.0" />
</marker_set>`;

/** BioViewer's own example fixture, `test-resources/examples/multi_marker_sets.cmm`. */
const MULTI_SET = `<marker_sets>
  <marker_set name="pocket A">
    <marker id="1" x="55.0" y="90.0" z="24.0" r="1.0" g="0.3" b="0.2" radius="2.0" />
    <marker id="2" x="61.0" y="93.0" z="26.0" r="1.0" g="0.3" b="0.2" radius="2.0" />
    <marker id="3" x="58.0" y="99.0" z="22.0" r="1.0" g="0.3" b="0.2" radius="2.0" />
    <link id1="1" id2="2" r="1.0" g="0.8" b="0.6" radius="0.4" />
    <link id1="2" id2="3" r="1.0" g="0.8" b="0.6" radius="0.4" />
  </marker_set>
  <marker_set name="pocket B">
    <marker id="1" x="68.0" y="88.0" z="30.0" r="0.2" g="0.5" b="1.0" radius="2.0" />
    <marker id="2" x="72.0" y="94.0" z="33.0" r="0.2" g="0.5" b="1.0" radius="2.0" />
    <link id1="1" id2="2" r="0.6" g="0.8" b="1.0" radius="0.4" />
  </marker_set>
</marker_sets>`;

/** The exact message a parse throws; a missing throw is itself a failure. */
function parseError(xmlText: string, fileLabel = "file.cmm"): string {
  try {
    parseCmmMarkerSets(xmlText, fileLabel);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`expected a parse error for: ${xmlText}`);
}

describe("parseCmmMarkerSets", () => {
  test("parses a single set into an exact MarkerSet, halving the marker radius", () => {
    expect(parseCmmMarkerSets(SINGLE_SET, "blob_1_NDP_1_prompt.cmm")).toEqual([
      {
        label: "blob_1_NDP_1_prompt.cmm",
        markers: [{ position: [59.45, 95.185, 24.3564], radius: 0.5, color: "#ff0000" }],
        links: [],
      },
    ]);
  });

  test("parses several sets with links, in file order and with per-set labels", () => {
    const sets = parseCmmMarkerSets(MULTI_SET, "multi_marker_sets.cmm");

    expect(sets.map((set) => set.label)).toEqual(["pocket A · multi_marker_sets.cmm", "pocket B · multi_marker_sets.cmm"]);

    // radius="2.0" → 1.0: Chimera's marker radius is drawn at half size.
    expect(sets[0]?.markers).toEqual([
      { position: [55, 90, 24], radius: 1, color: "#ff4d33" },
      { position: [61, 93, 26], radius: 1, color: "#ff4d33" },
      { position: [58, 99, 22], radius: 1, color: "#ff4d33" },
    ]);
    // Link radii are NOT scaled; link ids become indices into the set's markers.
    expect(sets[0]?.links).toEqual([
      { from: 0, to: 1, radius: 0.4, color: "#ffcc99" },
      { from: 1, to: 2, radius: 0.4, color: "#ffcc99" },
    ]);

    expect(sets[1]?.markers).toEqual([
      { position: [68, 88, 30], radius: 1, color: "#3380ff" },
      { position: [72, 94, 33], radius: 1, color: "#3380ff" },
    ]);
    expect(sets[1]?.links).toEqual([{ from: 0, to: 1, radius: 0.4, color: "#99ccff" }]);
  });

  test("labels a lone set by the file, ignoring its name, and unnamed sets by position", () => {
    expect(parseCmmMarkerSets(SINGLE_SET, "renamed.cmm")[0]?.label).toBe("renamed.cmm");

    const unnamed = parseCmmMarkerSets(
      '<marker_sets><marker_set name="first"><marker id="a" x="1" y="2" z="3"/></marker_set>' +
        '<marker_set><marker id="b" x="1" y="2" z="3"/></marker_set></marker_sets>',
      "two.cmm",
    );
    expect(unnamed.map((set) => set.label)).toEqual(["first · two.cmm", "marker set 2 · two.cmm"]);
  });

  test("uses the documented defaults: marker radius 1 → 0.5 and red, link radius 0.2 and white", () => {
    const sets = parseCmmMarkerSets(
      '<marker_set name="s"><marker id="m" x="1" y="2" z="3"/><link id1="m" id2="m"/></marker_set>',
      "defaults.cmm",
    );
    expect(sets[0]?.markers[0]).toEqual({ position: [1, 2, 3], radius: 0.5, color: "#ff0000" });
    expect(sets[0]?.links[0]).toEqual({ from: 0, to: 0, radius: 0.2, color: "#ffffff" });
  });

  test("clamps r/g/b into 0..1 and rounds to the nearest byte", () => {
    const sets = parseCmmMarkerSets(
      '<marker_set name="s">' +
        '<marker id="a" x="0" y="0" z="0" r="2" g="-1" b="0.5"/>' +
        '<marker id="b" x="0" y="0" z="0" r="0.1" g="0.2" b="0.3"/>' +
        "</marker_set>",
      "colors.cmm",
    );
    // 2 → ff, -1 → 00, 0.5 * 255 = 127.5 → 128 → 80.
    expect(sets[0]?.markers[0]?.color).toBe("#ff0080");
    // 0.1 * 255 = 25.5 → 26 → 1a; 0.2 * 255 = 51 → 33; 0.3 * 255 = 76.5 → 77 → 4d.
    expect(sets[0]?.markers[1]?.color).toBe("#1a334d");
  });

  test("treats blank attribute values as absent", () => {
    const sets = parseCmmMarkerSets(
      '<marker_set name="s"><marker id="1" x="1" y="2" z="3" radius=" "/></marker_set>',
      "blank.cmm",
    );
    expect(sets[0]?.markers[0]?.radius).toBe(0.5);
    expect(parseError('<marker_set name="s"><marker id="1" x="  " y="2" z="3"/></marker_set>')).toBe(
      "Invalid CMM marker 1: missing x.",
    );
  });

  test("scopes marker ids to their own set", () => {
    const sets = parseCmmMarkerSets(
      '<marker_sets><marker_set name="a"><marker id="1" x="1" y="0" z="0"/>' +
        '<marker id="2" x="2" y="0" z="0"/><link id1="2" id2="1"/></marker_set>' +
        '<marker_set name="b"><marker id="1" x="9" y="0" z="0"/><marker id="2" x="8" y="0" z="0"/>' +
        '<link id1="1" id2="2"/></marker_set></marker_sets>',
      "scoped.cmm",
    );
    expect(sets[0]?.links[0]).toEqual({ from: 1, to: 0, radius: 0.2, color: "#ffffff" });
    expect(sets[1]?.links[0]).toEqual({ from: 0, to: 1, radius: 0.2, color: "#ffffff" });
  });

  test("resolves a link that names a marker declared later in the set", () => {
    const sets = parseCmmMarkerSets(
      '<marker_set name="s"><link id1="b" id2="a"/>' +
        '<marker id="a" x="1" y="0" z="0"/><marker id="b" x="2" y="0" z="0"/></marker_set>',
      "forward.cmm",
    );
    expect(sets[0]?.links[0]?.from).toBe(1);
    expect(sets[0]?.links[0]?.to).toBe(0);
  });

  test("lets a later marker id win when a set repeats one", () => {
    const sets = parseCmmMarkerSets(
      '<marker_set name="s"><marker id="1" x="1" y="0" z="0"/><marker id="1" x="2" y="0" z="0"/>' +
        '<link id1="1" id2="1"/></marker_set>',
      "duplicate.cmm",
    );
    expect(sets[0]?.links[0]).toEqual({ from: 1, to: 1, radius: 0.2, color: "#ffffff" });
  });

  test("counts only direct children: a nested <marker> is ignored", () => {
    const sets = parseCmmMarkerSets(
      '<marker_set name="s"><marker id="outer" x="1" y="2" z="3"/>' +
        '<group><marker id="inner" x="9" y="9" z="9"/></group></marker_set>',
      "nested.cmm",
    );
    expect(sets[0]?.markers).toEqual([{ position: [1, 2, 3], radius: 0.5, color: "#ff0000" }]);
    expect(
      parseError(
        '<marker_set name="s"><marker id="outer" x="1" y="2" z="3"/>' +
          '<group><marker id="inner" x="9" y="9" z="9"/></group><link id1="outer" id2="inner"/></marker_set>',
      ),
    ).toBe("Invalid CMM link: unknown marker id inner.");
  });

  test("skips comments, processing instructions, declarations and CDATA", () => {
    const sets = parseCmmMarkerSets(
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE marker_set>\n<!-- a note with <marker id="x"/> -->\n' +
        '<marker_set name="s"><![CDATA[not a marker]]><marker id="1" x="1" y="2" z="3"/></marker_set>',
      "prologue.cmm",
    );
    expect(sets[0]?.markers).toHaveLength(1);
  });

  test("decodes entity references in attribute values", () => {
    const sets = parseCmmMarkerSets(
      '<marker_sets><marker_set name="a &amp; b"><marker id="1" x="1" y="2" z="3"/></marker_set>' +
        '<marker_set name="c &#183; d"><marker id="2" x="1" y="2" z="3"/></marker_set></marker_sets>',
      "entities.cmm",
    );
    expect(sets.map((set) => set.label)).toEqual(["a & b · entities.cmm", "c · d · entities.cmm"]);
    expect(parseError('<marker_set name="a &bogus;"><marker id="1" x="1" y="2" z="3"/></marker_set>')).toBe(
      "Invalid CMM XML: unknown entity &bogus;.",
    );
    expect(parseError('<marker_set name="a &b"><marker id="1" x="1" y="2" z="3"/></marker_set>')).toBe(
      "Invalid CMM XML: unterminated entity reference.",
    );
  });

  test("matches tag names case-insensitively but attribute names case-sensitively", () => {
    const sets = parseCmmMarkerSets(
      '<MARKER_SET name="s"><MARKER id="1" x="1" y="2" z="3"/><LINK id1="1" id2="1"/></MARKER_SET>',
      "case.cmm",
    );
    expect(sets[0]?.markers).toHaveLength(1);
    expect(sets[0]?.links).toHaveLength(1);
    // XML attributes are case-sensitive, exactly as `getAttribute("id")` in the reference.
    expect(parseError('<marker_set name="s"><marker ID="1" x="1" y="2" z="3"/></marker_set>')).toBe(
      "Invalid CMM marker: missing id.",
    );
  });

  test("parses without a DOM, which is why the scanner exists", () => {
    expect(typeof DOMParser).toBe("undefined");
    expect(parseCmmMarkerSets(SINGLE_SET, "blob.cmm")).toHaveLength(1);
  });

  test("only ever accepts sets MolStudio can draw", () => {
    // `MolStudio.loadMarkers` runs `validateMarkerSet` first, so anything this
    // parser accepts must satisfy those rules or the viewer fails at load time.
    // The sweep below is deterministic (fixed LCG seed) and covers both random
    // noise and splices of a real file.
    let seed = 20261029;
    const random = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % bound;
    };
    const alphabet = "<>/=\"'&;abz 019.-e";
    const drawable = (set: ReturnType<typeof parseCmmMarkerSets>[number]): boolean =>
      set.label.trim() !== "" &&
      set.markers.length > 0 &&
      set.markers.every(
        (marker) =>
          marker.position.length === 3 &&
          marker.position.every(Number.isFinite) &&
          marker.radius > 0 &&
          /^#[0-9a-f]{6}$/.test(marker.color),
      ) &&
      set.links.every(
        (link) =>
          Number.isInteger(link.from) &&
          link.from >= 0 &&
          link.from < set.markers.length &&
          Number.isInteger(link.to) &&
          link.to >= 0 &&
          link.to < set.markers.length &&
          link.radius > 0 &&
          /^#[0-9a-f]{6}$/.test(link.color),
      );

    let accepted = 0;
    const gaps: number[] = [];
    for (let index = 0; index < MULTI_SET.length; index += 1) if (MULTI_SET[index] === "\n") gaps.push(index);
    const insertions = [
      "\n  ",
      '<marker id="9" x="1" y="2" z="3" radius="2"/>',
      '<link id1="9" id2="1"/>',
      "<!-- a note -->",
    ];

    for (let iteration = 0; iteration < 2000; iteration += 1) {
      let input = "";
      if (iteration % 2 === 0) {
        for (let index = 0; index < random(120); index += 1) input += alphabet[random(alphabet.length)];
      } else {
        // Insert a whole element at a line break, which stays well-formed: this
        // half of the sweep exercises accepted input rather than only rejections.
        const at = gaps[random(gaps.length)];
        input = MULTI_SET.slice(0, at) + insertions[random(insertions.length)] + MULTI_SET.slice(at);
      }

      try {
        const sets = parseCmmMarkerSets(input, "fuzz.cmm");
        accepted += 1;
        expect(sets.every(drawable)).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    }
    expect(accepted).toBeGreaterThan(0);
  });
});

describe("parseCmmMarkerSets errors", () => {
  test("rejects malformed markers with the reference's messages", () => {
    expect(parseError('<marker_set name="s"><marker id="1" x="1" y="2"/></marker_set>')).toBe(
      "Invalid CMM marker 1: missing z.",
    );
    expect(parseError('<marker_set name="s"><marker id="1" x="q" y="2" z="3"/></marker_set>')).toBe(
      "Invalid CMM marker 1: invalid x.",
    );
    expect(parseError('<marker_set name="s"><marker id="1" x="1" y="2" z="3" radius="wide"/></marker_set>')).toBe(
      "Invalid CMM marker 1: invalid radius.",
    );
    expect(parseError('<marker_set name="s"><marker id="1" x="1" y="2" z="3" radius="0"/></marker_set>')).toBe(
      "Invalid CMM marker 1: radius must be greater than 0.",
    );
    expect(parseError('<marker_set name="s"><marker id="1" x="1" y="2" z="3" radius="-2"/></marker_set>')).toBe(
      "Invalid CMM marker 1: radius must be greater than 0.",
    );
    expect(parseError('<marker_set name="s"><marker x="1" y="2" z="3"/></marker_set>')).toBe(
      "Invalid CMM marker: missing id.",
    );
    expect(parseError('<marker_set name="s"><marker id="1" x="1" y="2" z="3" r="x"/></marker_set>')).toBe(
      "Invalid CMM marker 1: invalid r.",
    );
  });

  test("rejects links with missing or unknown endpoints", () => {
    expect(
      parseError('<marker_set name="s"><marker id="1" x="1" y="2" z="3"/><link id2="1"/></marker_set>'),
    ).toBe("Invalid CMM link: missing id1.");
    expect(
      parseError('<marker_set name="s"><marker id="1" x="1" y="2" z="3"/><link id1="1" id2="9"/></marker_set>'),
    ).toBe("Invalid CMM link: unknown marker id 9.");
    expect(
      parseError('<marker_set name="s"><marker id="1" x="1" y="2" z="3"/><link id1="1" id2="1" radius="0"/></marker_set>'),
    ).toBe("radius must be greater than 0");
  });

  test("rejects a set with no markers, using the label it was given", () => {
    expect(parseError('<marker_set name="empty"/>', "empty.cmm")).toBe("CMM marker_set empty.cmm contains no markers.");
    expect(
      parseError(
        '<marker_sets><marker_set name="a"><marker id="1" x="1" y="2" z="3"/></marker_set><marker_set name="b"/></marker_sets>',
        "two.cmm",
      ),
    ).toBe("CMM marker_set b · two.cmm contains no markers.");
  });

  test("rejects a file without a marker_set", () => {
    expect(parseError("<html><body>hi</body></html>")).toBe("CMM file does not contain a marker_set element.");
  });

  test("rejects input that is not well-formed XML", () => {
    expect(parseError("")).toBe("Invalid CMM XML: no root element.");
    expect(parseError("not xml at all")).toBe("Invalid CMM XML: text outside the root element.");
    expect(parseError("<marker_set/>trailing")).toBe("Invalid CMM XML: text outside the root element.");
    expect(parseError("<marker_set/>\n<marker_set/>")).toBe("Invalid CMM XML: more than one root element.");
    expect(parseError('<marker_set name="x">')).toBe("Invalid CMM XML: unclosed <marker_set> element.");
    expect(parseError("<marker_set></marker>")).toBe(
      "Invalid CMM XML: closing tag </marker> does not match <marker_set>.",
    );
    expect(parseError("</marker_set>")).toBe("Invalid CMM XML: unexpected closing tag </marker_set>.");
    expect(parseError('<marker_set name=x></marker_set>')).toBe(
      "Invalid CMM XML: attribute name in <marker_set> is not quoted.",
    );
    expect(parseError('<marker_set name="x></marker_set>')).toBe(
      "Invalid CMM XML: unterminated value for attribute name in <marker_set>.",
    );
    expect(parseError('<marker_set name="x" name="y"/>')).toBe(
      "Invalid CMM XML: duplicate attribute name in <marker_set>.",
    );
    expect(parseError("<!-- oops")).toBe("Invalid CMM XML: unterminated comment.");
    expect(parseError("<marker_set><![CDATA[x]]>")).toBe("Invalid CMM XML: unclosed <marker_set> element.");
    expect(parseError("<")).toBe("Invalid CMM XML: unterminated tag.");
  });
});
