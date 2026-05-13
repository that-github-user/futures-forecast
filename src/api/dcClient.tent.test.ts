/**
 * Tent endpoint URL-construction tests for the dc client (PR 6).
 *
 * These hit the public `dcApi` surface but stub out `fetch` so we
 * can pin:
 *   - URL paths (including encodeURIComponent on the position UID)
 *   - Query-string serialization for iv_source + as_of
 *   - Default-omission (no params set → no `?` suffix)
 *   - The X-DC-Key header when VITE_DC_API_KEY is set
 *
 * Frontend has no integration test for the modals (DOM-heavy without
 * @testing-library/react setup), so pinning the wire protocol here
 * catches client-side regressions before they hit operators.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dcApi } from "./dcClient";

type FetchArgs = [input: string | URL, init?: RequestInit];


function stubFetch(jsonReturn: unknown = {}) {
  const calls: FetchArgs[] = [];
  globalThis.fetch = vi.fn(async (...args: FetchArgs) => {
    calls.push(args);
    return {
      ok: true,
      json: async () => jsonReturn,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}


describe("dcApi.positionTent", () => {
  let calls: FetchArgs[];
  beforeEach(() => {
    calls = stubFetch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the URL without query params when no options are passed", async () => {
    await dcApi.positionTent("TEST-DC_2026-05-12T10:00:00-04:00");
    expect(calls.length).toBe(1);
    const url = String(calls[0][0]);
    expect(url).toContain("/dc-api/v1/positions/");
    expect(url).toContain("/tent");
    expect(url.includes("?")).toBe(false);
  });

  it("URL-encodes the position UID (preserves colon-laden ISO timestamp safely)", async () => {
    const uid = "3-4-DC_2026-05-12T10:00:00-04:00";
    await dcApi.positionTent(uid);
    const url = String(calls[0][0]);
    // Colons get %3A-encoded in the path so a future server-side
    // parser can't be tricked by an embedded slash or query mark.
    expect(url).toContain(encodeURIComponent(uid));
    expect(url).not.toContain(`/${uid}/`);
  });

  it("emits iv_source query param when provided", async () => {
    await dcApi.positionTent("uid", { ivSource: "latest" });
    const url = String(calls[0][0]);
    expect(url).toContain("?iv_source=latest");
  });

  it("emits as_of query param when provided", async () => {
    await dcApi.positionTent("uid", { asOf: "2026-05-12T14:30:00-04:00" });
    const url = String(calls[0][0]);
    expect(url).toContain("as_of=");
    expect(url).toContain("2026-05-12T14%3A30%3A00-04%3A00");
  });

  it("encodes `+` in UTC-offset as_of values as %2B", async () => {
    // Pasting a UTC-suffixed log timestamp (e.g. from journalctl)
    // should round-trip the literal +00:00 offset, not be mangled
    // into a space by URLSearchParams' default form-encoding.
    await dcApi.positionTent("uid", { asOf: "2026-05-12T18:30:00+00:00" });
    const url = String(calls[0][0]);
    expect(url).toContain("as_of=2026-05-12T18%3A30%3A00%2B00%3A00");
    // Negative-form sanity: NOT a literal `+` in the URL.
    expect(url).not.toContain("+00:00");
  });

  it("emits both params when both are provided", async () => {
    await dcApi.positionTent("uid", {
      ivSource: "entry",
      asOf: "2026-05-12T14:30:00-04:00",
    });
    const url = String(calls[0][0]);
    expect(url).toContain("iv_source=entry");
    expect(url).toContain("as_of=");
  });
});


describe("dcApi.phantomTent", () => {
  let calls: FetchArgs[];
  beforeEach(() => {
    calls = stubFetch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("targets the /phantoms/ path with the encoded uid", async () => {
    const uid = "phantom_TEST-DC_2026-05-12T10:00:00-04:00";
    await dcApi.phantomTent(uid);
    const url = String(calls[0][0]);
    expect(url).toContain("/dc-api/v1/phantoms/");
    expect(url).toContain(encodeURIComponent(uid));
    expect(url).toContain("/tent");
  });
});


describe("dcApi.tradeTent", () => {
  let calls: FetchArgs[];
  beforeEach(() => {
    calls = stubFetch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses numeric trade id (no URL-encoding needed)", async () => {
    await dcApi.tradeTent(42);
    const url = String(calls[0][0]);
    expect(url).toContain("/dc-api/v1/trades/42/tent");
  });

  it("forwards as_of param for through-expiry rendering", async () => {
    await dcApi.tradeTent(42, { asOf: "2026-06-12T10:00:00-04:00" });
    const url = String(calls[0][0]);
    expect(url).toContain("as_of=");
  });
});


describe("dcApi.positionGreeks", () => {
  let calls: FetchArgs[];
  beforeEach(() => {
    calls = stubFetch({ position_uid: "uid", snapshots: [] });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the response body intact when 200 OK", async () => {
    const result = await dcApi.positionGreeks("uid");
    expect(result).toEqual({ position_uid: "uid", snapshots: [] });
    expect(String(calls[0][0])).toContain("/dc-api/v1/positions/uid/greeks");
  });
});


describe("error handling", () => {
  it("returns null on non-OK response", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as unknown as Response)) as unknown as typeof fetch;

    const result = await dcApi.positionTent("nonexistent");
    expect(result).toBeNull();
    vi.restoreAllMocks();
  });

  it("returns null on fetch rejection (network error)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const result = await dcApi.positionTent("uid");
    expect(result).toBeNull();
    vi.restoreAllMocks();
  });
});
