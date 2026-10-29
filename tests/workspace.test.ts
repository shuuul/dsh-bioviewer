/**
 * Unit tests for the BioViewer workspace helpers.
 *
 * These cover the three things the tab depends on and cannot get wrong: which
 * rows count as bio files (and in what order), how the `fs.trees` envelope is
 * unwrapped (success, per-level failure, wire failure), and where "go up"
 * stops. No DOM and no React — the helpers are pure.
 */

import { describe, expect, test } from "bun:test";
import {
  collectBioFiles,
  fetchSessionCwd,
  fetchTreeLevel,
  parentPath,
  RequestGate,
  WorkspaceApiError,
  type BioTreeEntry,
} from "../src/client/workspace";

/** One listing row; the name defaults to the path's basename. */
function row(path: string, isDir = false, name?: string): BioTreeEntry {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return { path, name: name ?? (at === -1 ? path : path.slice(at + 1)), isDir };
}

interface CapturedCall {
  url: string;
  init: RequestInit | undefined;
}

/** A `fetch` stand-in answering one JSON payload, recording every call. */
function jsonFetch(
  payload: unknown,
  status = 200,
): { fetchImpl: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** A route resolver that records the relative route it was asked for. */
function routeRecorder(prefix = "https://host/proxy/3080/") {
  const routes: string[] = [];
  return {
    routes,
    routeUrl: (path: string): string => {
      routes.push(path);
      return `${prefix}${path}`;
    },
  };
}

describe("collectBioFiles", () => {
  test("keeps only bio files, dropping directories and other files", () => {
    const entries = [
      row("/w/1abc.pdb"),
      row("/w/notes.md"),
      row("/w/structures", true),
      row("/w/map.mrc"),
      row("/w/archive.tar.gz"),
    ];
    expect(collectBioFiles(entries).map((entry) => entry.path)).toEqual([
      "/w/1abc.pdb",
      "/w/map.mrc",
    ]);
  });

  test("matches case-insensitively and accepts gz variants", () => {
    const entries = [
      row("/w/A.PDB.GZ"),
      row("/w/b.Cif"),
      row("/w/c.mol2.gz"),
      row("/w/d.cmm"),
    ];
    expect(collectBioFiles(entries).map((entry) => entry.path)).toEqual([
      "/w/A.PDB.GZ",
      "/w/b.Cif",
      "/w/c.mol2.gz",
      "/w/d.cmm",
    ]);
  });

  test("orders deterministically by path, not by input order", () => {
    const entries = [
      row("/w/z.pdb"),
      row("/w/a.pdb"),
      row("/w/m/m.pdb"),
      row("/w/B.pdb"),
    ];
    expect(collectBioFiles(entries).map((entry) => entry.path)).toEqual([
      "/w/B.pdb",
      "/w/a.pdb",
      "/w/m/m.pdb",
      "/w/z.pdb",
    ]);
  });

  test("does not mutate the input array", () => {
    const entries = [row("/w/z.pdb"), row("/w/a.pdb")];
    const before = entries.map((entry) => entry.path);
    collectBioFiles(entries);
    expect(entries.map((entry) => entry.path)).toEqual(before);
  });

  test("maxDepth is measured from the shallowest entry of the listing", () => {
    const entries = [
      row("/w/a.pdb"),
      row("/w/sub/b.pdb"),
      row("/w/sub/deep/c.pdb"),
    ];
    expect(collectBioFiles(entries, 0).map((entry) => entry.path)).toEqual([
      "/w/a.pdb",
    ]);
    expect(collectBioFiles(entries, 1).map((entry) => entry.path)).toEqual([
      "/w/a.pdb",
      "/w/sub/b.pdb",
    ]);
    expect(collectBioFiles(entries, 2).map((entry) => entry.path)).toEqual([
      "/w/a.pdb",
      "/w/sub/b.pdb",
      "/w/sub/deep/c.pdb",
    ]);
    expect(collectBioFiles(entries, 99).map((entry) => entry.path)).toEqual([
      "/w/a.pdb",
      "/w/sub/b.pdb",
      "/w/sub/deep/c.pdb",
    ]);
  });

  test("an omitted maxDepth means no limit", () => {
    const entries = [
      row("/w/a.pdb"),
      row("/w/1/2/3/4/5/b.pdb"),
      row("/w/1/2/3/4/5/6/7/c.pdb"),
    ];
    expect(collectBioFiles(entries).map((entry) => entry.path)).toEqual([
      "/w/1/2/3/4/5/6/7/c.pdb",
      "/w/1/2/3/4/5/b.pdb",
      "/w/a.pdb",
    ]);
  });

  test("a non-bio file at the top level still anchors the depth baseline", () => {
    const entries = [row("/w/README"), row("/w/sub/x.pdb")];
    expect(collectBioFiles(entries, 0)).toEqual([]);
    expect(collectBioFiles(entries, 1).map((entry) => entry.path)).toEqual([
      "/w/sub/x.pdb",
    ]);
  });

  test("collapses duplicate paths (first occurrence wins)", () => {
    const first = row("/w/a.pdb", false, "a.pdb");
    const duplicate = row("/w/a.pdb", false, "a.pdb");
    expect(collectBioFiles([first, duplicate, row("/w/b.pdb")])).toEqual([
      first,
      row("/w/b.pdb"),
    ]);
  });

  test("ignores dotfiles and unknown extensions", () => {
    const entries = [row("/w/.pdb"), row("/w/.hidden.pdb"), row("/w/plain")];
    expect(collectBioFiles(entries).map((entry) => entry.path)).toEqual([
      "/w/.hidden.pdb",
    ]);
  });

  test("an empty listing answers an empty array", () => {
    expect(collectBioFiles([])).toEqual([]);
    expect(collectBioFiles([], 0)).toEqual([]);
  });
});

describe("fetchTreeLevel", () => {
  const okLevel = {
    ok: true,
    value: {
      levels: [
        {
          path: "/w",
          entries: [
            {
              name: "1abc.pdb",
              path: "/w/1abc.pdb",
              isDir: false,
              hidden: false,
              isSymlink: false,
              broken: false,
            },
            {
              name: "structures",
              path: "/w/structures",
              isDir: true,
              hidden: false,
              isSymlink: false,
              broken: false,
            },
          ],
          truncated: true,
        },
      ],
    },
  };

  test("posts to the relative fs.trees route with the exact body", async () => {
    const { fetchImpl, calls } = jsonFetch(okLevel);
    const { routeUrl, routes } = routeRecorder();
    await fetchTreeLevel({
      routeUrl,
      sessionId: "s-1",
      cwd: "/w",
      path: "/w",
      fetchImpl,
    });
    expect(routes).toEqual(["sidebar/api/fs.trees"]);
    expect(calls).toHaveLength(1);
    const init = calls[0]!.init;
    expect(calls[0]!.url).toBe("https://host/proxy/3080/sidebar/api/fs.trees");
    expect(init?.method).toBe("POST");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      sessionId: "s-1",
      paths: ["/w"],
      cwd: "/w",
    });
  });

  test("omits cwd when the scope has none", async () => {
    const { fetchImpl, calls } = jsonFetch(okLevel);
    await fetchTreeLevel({
      routeUrl: routeRecorder().routeUrl,
      sessionId: "s-1",
      path: ".",
      fetchImpl,
    });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      sessionId: "s-1",
      paths: ["."],
    });
  });

  test("unwraps the envelope and keeps only path/name/isDir", async () => {
    const { fetchImpl } = jsonFetch(okLevel);
    const level = await fetchTreeLevel({
      routeUrl: routeRecorder().routeUrl,
      sessionId: "s-1",
      path: "/w",
      fetchImpl,
    });
    expect(level.truncated).toBe(true);
    expect(level.error).toBeUndefined();
    expect(level.entries).toEqual([
      { path: "/w/1abc.pdb", name: "1abc.pdb", isDir: false },
      { path: "/w/structures", name: "structures", isDir: true },
    ]);
  });

  test("surfaces a per-level error instead of throwing", async () => {
    const { fetchImpl } = jsonFetch({
      ok: true,
      value: {
        levels: [
          {
            path: "/w/locked",
            entries: [],
            truncated: false,
            error: "EACCES: permission denied",
          },
        ],
      },
    });
    const level = await fetchTreeLevel({
      routeUrl: routeRecorder().routeUrl,
      sessionId: "s-1",
      path: "/w/locked",
      fetchImpl,
    });
    expect(level).toEqual({
      entries: [],
      truncated: false,
      error: "EACCES: permission denied",
    });
  });

  test("throws the wire code from a failed envelope", async () => {
    const { fetchImpl } = jsonFetch(
      { ok: false, error: { code: "fs-error", message: "no such directory" } },
      400,
    );
    const failure = fetchTreeLevel({
      routeUrl: routeRecorder().routeUrl,
      sessionId: "s-1",
      path: "/nope",
      fetchImpl,
    });
    await expect(failure).rejects.toBeInstanceOf(WorkspaceApiError);
    await expect(failure).rejects.toMatchObject({
      code: "fs-error",
      message: "no such directory",
    });
  });

  test("throws http when the response is not an envelope at all", async () => {
    const fetchImpl = (async () =>
      new Response("<html>500</html>", { status: 500 })) as unknown as typeof fetch;
    await expect(
      fetchTreeLevel({
        routeUrl: routeRecorder().routeUrl,
        sessionId: "s-1",
        path: "/w",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "http", message: "HTTP 500" });
  });

  test("throws bad-response when the batch carries no level", async () => {
    const { fetchImpl } = jsonFetch({ ok: true, value: { levels: [] } });
    await expect(
      fetchTreeLevel({
        routeUrl: routeRecorder().routeUrl,
        sessionId: "s-1",
        path: "/w",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "bad-response" });
  });

  test("turns a network failure into a coded error", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(
      fetchTreeLevel({
        routeUrl: routeRecorder().routeUrl,
        sessionId: "s-1",
        path: "/w",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "network", message: "Failed to fetch" });
  });

  test("passes the caller's signal through and rethrows aborts untouched", async () => {
    const controller = new AbortController();
    const { fetchImpl, calls } = jsonFetch(okLevel);
    await fetchTreeLevel({
      routeUrl: routeRecorder().routeUrl,
      sessionId: "s-1",
      path: "/w",
      fetchImpl,
      signal: controller.signal,
    });
    expect(calls[0]!.init?.signal).toBe(controller.signal);

    const abortError = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    const aborting = (async () => {
      throw abortError;
    }) as unknown as typeof fetch;
    await expect(
      fetchTreeLevel({
        routeUrl: routeRecorder().routeUrl,
        sessionId: "s-1",
        path: "/w",
        fetchImpl: aborting,
      }),
    ).rejects.toBe(abortError);
  });

  test("drops malformed rows and derives a missing name from the path", async () => {
    const { fetchImpl } = jsonFetch({
      ok: true,
      value: {
        levels: [
          {
            path: "/w",
            entries: [
              { path: "/w/derived.pdb", isDir: false },
              { name: "no-path.pdb", isDir: false },
              null,
              "junk",
              { path: "/w/dir", isDir: true },
            ],
            truncated: false,
          },
        ],
      },
    });
    const level = await fetchTreeLevel({
      routeUrl: routeRecorder().routeUrl,
      sessionId: "s-1",
      path: "/w",
      fetchImpl,
    });
    expect(level.entries).toEqual([
      { path: "/w/derived.pdb", name: "derived.pdb", isDir: false },
      { path: "/w/dir", name: "dir", isDir: true },
    ]);
  });
});

describe("fetchSessionCwd", () => {
  test("returns the authoritative cwd", async () => {
    const { fetchImpl, calls } = jsonFetch({
      ok: true,
      value: { sessionId: "s-1", cwd: "/w", root: "w", parent: "/" },
    });
    const info = await fetchSessionCwd({
      routeUrl: routeRecorder().routeUrl,
      sessionId: "s-1",
      fetchImpl,
    });
    expect(info).toEqual({
      sessionId: "s-1",
      cwd: "/w",
      root: "w",
      parent: "/",
    });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      sessionId: "s-1",
    });
  });

  test("throws the wire code when the session is unknown", async () => {
    const { fetchImpl } = jsonFetch(
      { ok: false, error: { code: "not-found", message: "unknown session" } },
      404,
    );
    await expect(
      fetchSessionCwd({
        routeUrl: routeRecorder().routeUrl,
        sessionId: "s-9",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  test("throws bad-response when the cwd is missing", async () => {
    const { fetchImpl } = jsonFetch({
      ok: true,
      value: { sessionId: "s-1", root: "w" },
    });
    await expect(
      fetchSessionCwd({
        routeUrl: routeRecorder().routeUrl,
        sessionId: "s-1",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "bad-response" });
  });
});

describe("RequestGate", () => {
  test("a fresh ticket is live and un-aborted", () => {
    const gate = new RequestGate();
    const ticket = gate.begin();
    expect(ticket.signal.aborted).toBe(false);
    expect(ticket.stale()).toBe(false);
  });

  test("starting a newer request aborts the older one and marks it stale", () => {
    const gate = new RequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(first.signal.aborted).toBe(true);
    expect(first.stale()).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(second.stale()).toBe(false);
  });

  test("cancel aborts the in-flight request and marks its ticket stale", () => {
    const gate = new RequestGate();
    const ticket = gate.begin();
    gate.cancel();
    expect(ticket.signal.aborted).toBe(true);
    expect(ticket.stale()).toBe(true);
  });

  test("a late result of a superseded request is detectable after it settles", async () => {
    const gate = new RequestGate();
    const first = gate.begin();
    const pending = Promise.resolve("first level");
    const second = gate.begin();
    await pending;
    expect(first.stale()).toBe(true);
    expect(second.stale()).toBe(false);
  });
});

describe("parentPath", () => {
  test("terminates at the root", () => {
    expect(parentPath("")).toBeUndefined();
    expect(parentPath("/")).toBeUndefined();
    expect(parentPath("///")).toBeUndefined();
    expect(parentPath("\\")).toBeUndefined();
    expect(parentPath("a")).toBeUndefined();
    expect(parentPath(".")).toBeUndefined();
  });

  test("walks up absolute paths and stops at '/'", () => {
    expect(parentPath("/a")).toBe("/");
    expect(parentPath("/a/b")).toBe("/a");
    expect(parentPath("/a/b/c")).toBe("/a/b");
    expect(parentPath("/data/1abc.pdb")).toBe("/data");
    const up1 = parentPath("/a/b/c");
    const up2 = up1 === undefined ? undefined : parentPath(up1);
    const up3 = up2 === undefined ? undefined : parentPath(up2);
    expect([up1, up2, up3]).toEqual(["/a/b", "/a", "/"]);
  });

  test("walks up relative paths and stops at the top segment", () => {
    expect(parentPath("a/b")).toBe("a");
    expect(parentPath("a/b/c")).toBe("a/b");
    expect(parentPath("a/")).toBeUndefined();
  });

  test("ignores trailing separators", () => {
    expect(parentPath("/a/b/")).toBe("/a");
    expect(parentPath("/a/b///")).toBe("/a");
    expect(parentPath("a/b/")).toBe("a");
  });

  test("never returns the input unchanged, so a walk always terminates", () => {
    let current: string | undefined = "/one/two/three/four";
    const seen: string[] = [];
    while (current !== undefined) {
      seen.push(current);
      const next = parentPath(current);
      expect(next).not.toBe(current);
      current = next;
    }
    expect(seen).toEqual(["/one/two/three/four", "/one/two/three", "/one/two", "/one", "/"]);
  });
});
