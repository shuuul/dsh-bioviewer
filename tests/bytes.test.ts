import { describe, expect, test } from "bun:test";
import { fetchBioBytes, gunzip, type FetchBioBytesOptions } from "../src/client/bytes";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** `Blob`/`Response` only accept `ArrayBuffer`-backed views in the TS 5.7+ DOM types. */
function ab(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
}

/** Gzips with the platform compressor, so the test does not share code with the implementation. */
async function gzipBytes(input: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([ab(input)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** Captures the requests a stub `fetch` receives, and always answers `response`. */
function stubFetch(response: Response, calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response;
  }) as typeof fetch;
}

const ROUTE_BASE = "http://127.0.0.1:59290/prefix/";

/** Records the relative route handed to `routeUrl` and resolves it like the host does. */
function routeRecorder(routes: string[]): (route: string) => string {
  return (route) => {
    routes.push(route);
    return ROUTE_BASE + route;
  };
}

describe("gunzip", () => {
  test("round-trips a gzip stream produced with CompressionStream", async () => {
    const original = new Uint8Array(512);
    for (let i = 0; i < original.length; i += 1) original[i] = i % 256;
    const compressed = await gzipBytes(original);
    // Sanity: the fixture really is gzip, so the assertion below is meaningful.
    expect([compressed[0], compressed[1]]).toEqual([0x1f, 0x8b]);
    expect(compressed.length).toBeLessThan(original.length);

    const inflated = await gunzip(compressed);
    expect(inflated).toBeInstanceOf(Uint8Array);
    expect(Array.from(inflated)).toEqual(Array.from(original));
  });

  test("round-trips text without sharing the input buffer", async () => {
    const original = encoder.encode("data_1abc\nATOM      1  N   ALA A   1\n");
    const inflated = await gunzip(await gzipBytes(original));
    expect(decoder.decode(inflated)).toBe(decoder.decode(original));
    expect(inflated.buffer).not.toBe(original.buffer);
  });

  test("rejects data that is not a gzip stream", async () => {
    await expect(gunzip(encoder.encode("definitely not gzip"))).rejects.toThrow();
  });
});

describe("fetchBioBytes", () => {
  test("requests the exact raw-bytes route and returns the body", async () => {
    const payload = encoder.encode("ATOM      1  N   ALA A   1\n");
    const calls: Call[] = [];
    const routes: string[] = [];
    const result = await fetchBioBytes({
      routeUrl: routeRecorder(routes),
      sessionId: "sess-1",
      path: "/data/structures/1abc.pdb",
      fetchImpl: stubFetch(new Response(payload), calls),
    });

    expect(routes).toEqual(["sidebar/file?sessionId=sess-1&path=%2Fdata%2Fstructures%2F1abc.pdb"]);
    // No leading slash: a leading slash would drop a reverse-proxy prefix.
    expect(routes[0]?.startsWith("sidebar/file?")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `${ROUTE_BASE}sidebar/file?sessionId=sess-1&path=%2Fdata%2Fstructures%2F1abc.pdb`,
    );
    expect(calls[0]?.init?.method).toBe("GET");
    // Nothing but the method and the abort signal: the route is asked for raw bytes.
    expect(Object.keys(calls[0]?.init ?? {}).sort()).toEqual(["method", "signal"]);
    expect(Array.from(result.bytes)).toEqual(Array.from(payload));
    expect(result.gzip).toBe(false);
  });

  test("encodes spaces and # in the path", async () => {
    const calls: Call[] = [];
    const routes: string[] = [];
    await fetchBioBytes({
      routeUrl: routeRecorder(routes),
      sessionId: "s 1",
      path: "/data/my file#1.pdb",
      fetchImpl: stubFetch(new Response(new Uint8Array([1])), calls),
    });

    expect(routes[0]).toBe("sidebar/file?sessionId=s+1&path=%2Fdata%2Fmy+file%231.pdb");
    const params = new URLSearchParams(routes[0]?.split("?")[1] ?? "");
    expect(params.get("sessionId")).toBe("s 1");
    expect(params.get("path")).toBe("/data/my file#1.pdb");
    expect(params.has("cwd")).toBe(false);
  });

  test("sends cwd only when it is set", async () => {
    const routes: string[] = [];
    const base = {
      routeUrl: routeRecorder(routes),
      sessionId: "sess-1",
      path: "1abc.cif",
    };

    await fetchBioBytes({ ...base, cwd: "/work dir", fetchImpl: stubFetch(new Response(new Uint8Array([1])), []) });
    await fetchBioBytes({ ...base, cwd: "", fetchImpl: stubFetch(new Response(new Uint8Array([1])), []) });
    await fetchBioBytes({ ...base, cwd: undefined, fetchImpl: stubFetch(new Response(new Uint8Array([1])), []) });

    expect(routes[0]).toBe("sidebar/file?sessionId=sess-1&path=1abc.cif&cwd=%2Fwork+dir");
    expect(routes[1]).toBe("sidebar/file?sessionId=sess-1&path=1abc.cif");
    expect(routes[2]).toBe("sidebar/file?sessionId=sess-1&path=1abc.cif");
  });

  test("passes the AbortSignal through to fetch", async () => {
    const controller = new AbortController();
    const calls: Call[] = [];
    await fetchBioBytes({
      routeUrl: routeRecorder([]),
      sessionId: "sess-1",
      path: "/data/1abc.pdb",
      signal: controller.signal,
      fetchImpl: stubFetch(new Response(new Uint8Array([1])), calls),
    });

    expect(calls[0]?.init?.signal).toBe(controller.signal);
  });

  test("throws on a non-ok response, with the status and the body", async () => {
    const body = JSON.stringify({ ok: false, error: { code: "fs-error", message: "ENOENT: no such file" } });
    const calls: Call[] = [];
    const error = await fetchBioBytes({
      routeUrl: routeRecorder([]),
      sessionId: "sess-1",
      path: "/data/missing.pdb",
      fetchImpl: stubFetch(new Response(body, { status: 404, statusText: "Not Found" }), calls),
    }).catch((thrown: unknown) => thrown);

    expect(calls).toHaveLength(1);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("HTTP 404");
    expect(message).toContain("Not Found");
    expect(message).toContain("/data/missing.pdb");
    expect(message).toContain("ENOENT");
  });

  test("gunzips when the name ends in .gz and reports gzip:true", async () => {
    const original = encoder.encode("data_1abc\nATOM      1  N   ALA A   1\n");
    const compressed = await gzipBytes(original);
    const result = await fetchBioBytes({
      routeUrl: routeRecorder([]),
      sessionId: "sess-1",
      path: "/data/1abc.pdb.gz",
      fetchImpl: stubFetch(new Response(compressed), []),
    });

    expect(result.gzip).toBe(true);
    expect(decoder.decode(result.bytes)).toBe(decoder.decode(original));
  });

  test("gunzips a mixed-case .GZ name too", async () => {
    const original = encoder.encode("data_1abc\n");
    const result = await fetchBioBytes({
      routeUrl: routeRecorder([]),
      sessionId: "sess-1",
      path: "/data/1ABC.PDB.GZ",
      fetchImpl: stubFetch(new Response(await gzipBytes(original)), []),
    });

    expect(result.gzip).toBe(true);
    expect(decoder.decode(result.bytes)).toBe("data_1abc\n");
  });

  test("leaves non-gz bytes untouched and rejects a corrupt gz body", async () => {
    const raw = new Uint8Array([0x00, 0xff, 0x10, 0x80]);
    const plain = await fetchBioBytes({
      routeUrl: routeRecorder([]),
      sessionId: "sess-1",
      path: "/data/1abc.mrc",
      fetchImpl: stubFetch(new Response(raw), []),
    });
    expect(plain.gzip).toBe(false);
    expect(Array.from(plain.bytes)).toEqual(Array.from(raw));

    await expect(
      fetchBioBytes({
        routeUrl: routeRecorder([]),
        sessionId: "sess-1",
        path: "/data/broken.mrc.gz",
        fetchImpl: stubFetch(new Response(raw), []),
      }),
    ).rejects.toThrow();
  });

  test("falls back to the global fetch when no fetchImpl is injected", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Call[] = [];
    globalThis.fetch = stubFetch(new Response(new Uint8Array([7, 8])), calls);
    try {
      const options: Omit<FetchBioBytesOptions, "fetchImpl"> = {
        routeUrl: routeRecorder([]),
        sessionId: "sess-1",
        path: "/data/1abc.pdb",
      };
      const result = await fetchBioBytes(options);
      expect(calls).toHaveLength(1);
      expect(Array.from(result.bytes)).toEqual([7, 8]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
