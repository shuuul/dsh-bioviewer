import { describe, expect, test } from "bun:test";
import { payloadFromOpenRequest } from "../src/client/open-payload";
import type { OpenRequest } from "../src/shared/opens";

describe("payloadFromOpenRequest", () => {
  test("a structure request becomes a structure payload with no fetch", async () => {
    const request: OpenRequest = {
      kind: "structure",
      mode: "add",
      source: "pdb",
      id: "1CBS",
      title: "PDB 1CBS",
    };
    let fetched = 0;
    const payload = await payloadFromOpenRequest(request, async () => {
      fetched += 1;
      return { bytes: new Uint8Array(), gzip: false };
    });
    expect(fetched).toBe(0);
    expect(payload).toEqual({ kind: "structure", source: "pdb", id: "1CBS", title: "PDB 1CBS" });
  });

  test("a file request fetches bytes and keeps the resolved title", async () => {
    const request: OpenRequest = {
      kind: "file",
      mode: "add",
      path: "/data/map.mrc.gz",
      title: "map.mrc",
      formatId: "ccp4",
    };
    const bytes = new Uint8Array([1, 2, 3]);
    const payload = await payloadFromOpenRequest(request, async (path) => {
      expect(path).toBe("/data/map.mrc.gz");
      return { bytes, gzip: true };
    });
    expect(payload).toEqual({
      kind: "bytes",
      path: "/data/map.mrc.gz",
      title: "map.mrc",
      format: expect.objectContaining({ id: "ccp4" }),
      bytes,
      gzip: true,
    });
  });

  test("a marker file is parsed into sets", async () => {
    const xml = `<marker_set name="site"><marker id="1" x="1" y="2" z="3" radius="1.0" /></marker_set>`;
    const request: OpenRequest = {
      kind: "file",
      mode: "add",
      path: "/data/site.cmm",
      title: "site.cmm",
      formatId: "cmm",
    };
    const payload = await payloadFromOpenRequest(request, async () => ({
      bytes: new TextEncoder().encode(xml),
      gzip: false,
    }));
    expect(payload.kind).toBe("markers");
    if (payload.kind !== "markers") return;
    expect(payload.sets).toHaveLength(1);
    expect(payload.sets[0]?.markers).toHaveLength(1);
  });
});
