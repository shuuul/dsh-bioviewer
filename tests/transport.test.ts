import { afterEach, describe, expect, test } from "bun:test";
import { pluginRouteUrl, transportBase } from "../src/client/transport";

/** A stand-in document: only `baseURI` is read. */
const docWith = (baseURI: string): Document => ({ baseURI }) as Document;

const globalWithTransport = globalThis as { __DSH_TRANSPORT__?: { streamBaseUrl?: unknown } };

afterEach(() => {
  delete globalWithTransport.__DSH_TRANSPORT__;
});

describe("transportBase", () => {
  test("prefers the transport base the desktop shell injects", () => {
    globalWithTransport.__DSH_TRANSPORT__ = { streamBaseUrl: "https://shell.example/app/" };
    expect(transportBase(docWith("https://ignored.example/"))).toBe("https://shell.example/app/");
  });

  test("ignores an empty or non-string transport hint", () => {
    globalWithTransport.__DSH_TRANSPORT__ = { streamBaseUrl: "" };
    expect(transportBase(docWith("https://page.example/prefix/"))).toBe("https://page.example/prefix/");
    globalWithTransport.__DSH_TRANSPORT__ = { streamBaseUrl: 42 };
    expect(transportBase(docWith("https://page.example/prefix/"))).toBe("https://page.example/prefix/");
  });

  test("falls back to the document base", () => {
    expect(transportBase(docWith("https://page.example/prefix/"))).toBe("https://page.example/prefix/");
  });
});

describe("pluginRouteUrl", () => {
  test("resolves against the document base, keeping a sub-path prefix", () => {
    // The regression this guards: a leading slash would drop `/dataops/proxy/3080/`.
    expect(pluginRouteUrl("bioviewer/open", docWith("https://host/dataops/proxy/3080/"))).toBe(
      "https://host/dataops/proxy/3080/bioviewer/open",
    );
  });

  test("strips leading slashes instead of pinning to the origin root", () => {
    const base = docWith("https://host/dataops/proxy/3080/");
    expect(pluginRouteUrl("/bioviewer/open", base)).toBe(pluginRouteUrl("bioviewer/open", base));
    expect(pluginRouteUrl("///bioviewer/open", base)).toBe(pluginRouteUrl("bioviewer/open", base));
  });

  test("prefers the shell transport base when present", () => {
    globalWithTransport.__DSH_TRANSPORT__ = { streamBaseUrl: "dsh-app://app/" };
    expect(pluginRouteUrl("bioviewer/open", docWith("https://ignored.example/"))).toBe("dsh-app://app/bioviewer/open");
  });

  test("carries a query string through", () => {
    expect(pluginRouteUrl("bioviewer/open?sessionId=s1", docWith("https://host/"))).toBe(
      "https://host/bioviewer/open?sessionId=s1",
    );
  });

  test("throws when there is no base at all", () => {
    const empty = { baseURI: "" } as Document;
    const original = globalThis.location;
    // `location` is not configurable in every runtime; only assert when it is absent.
    if (original === undefined) {
      expect(() => pluginRouteUrl("bioviewer/open", empty)).toThrow();
    } else {
      expect(pluginRouteUrl("bioviewer/open", docWith("https://host/"))).toBe("https://host/bioviewer/open");
    }
  });
});
