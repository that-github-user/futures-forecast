/**
 * URL + auth-header tests for terminal.straddle0dte().
 *
 * Mirrors `dcClient.tent.test.ts`: stubs global fetch, asserts the
 * URL path and that the X-Terminal-Key auth header is attached. The
 * frontend has no integration test for the page (DOM-heavy without
 * @testing-library/react setup), so pinning the wire contract here
 * catches client-side regressions before they hit operators.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


type FetchArgs = [input: string | URL, init?: RequestInit];

function stubFetch(jsonReturn: unknown = {}, ok = true) {
  const calls: FetchArgs[] = [];
  globalThis.fetch = vi.fn(async (...args: FetchArgs) => {
    calls.push(args);
    return {
      ok,
      json: async () => jsonReturn,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}


/** Per-test import to pick up the env-var overrides we set via
 *  vi.stubEnv. Without re-importing, Vite-cached modules close over
 *  the first-seen env snapshot and the auth-header assertions can't
 *  exercise the "key present" path. */
async function importClient() {
  return import("./terminalClient");
}


describe("terminal.straddle0dte URL + auth", () => {
  let calls: FetchArgs[];

  beforeEach(() => {
    calls = stubFetch({
      snapshot_time: null,
      expiry: null,
      spot: null,
      atm_strike: null,
      atm_straddle_mid: null,
      em_upper: null,
      em_lower: null,
      session_open_spot: null,
      session_open_straddle: null,
      realized_range_pts: null,
      realized_vs_implied_pct: null,
      strikes: [],
      pin_candidates: [],
      program_flow: {
        active_windowed: [],
        active_continuous: [],
        upcoming: [],
      },
      stale: true,
      data_age_seconds: null,
    });
    // Set env vars BEFORE the module is imported so the
    // module-scoped TERMINAL_API_URL/KEY constants pick them up.
    vi.stubEnv("VITE_TERMINAL_API_URL", "https://terminal.example.com");
    vi.stubEnv("VITE_TERMINAL_API_KEY", "test-key-abc");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("hits /terminal/v1/straddle/0dte under the configured base URL", async () => {
    const { terminal } = await importClient();
    await terminal.straddle0dte();
    expect(calls.length).toBe(1);
    const url = String(calls[0][0]);
    expect(url).toBe("https://terminal.example.com/terminal/v1/straddle/0dte");
  });

  it("attaches X-Terminal-Key header when the key is configured", async () => {
    const { terminal } = await importClient();
    await terminal.straddle0dte();
    const init = calls[0][1];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers).toBeDefined();
    expect(headers!["X-Terminal-Key"]).toBe("test-key-abc");
  });

  it("returns the parsed body verbatim on 200", async () => {
    const { terminal } = await importClient();
    const result = await terminal.straddle0dte();
    expect(result).not.toBeNull();
    expect(result!.stale).toBe(true);
    expect(result!.strikes).toEqual([]);
    expect(result!.program_flow.active_windowed).toEqual([]);
  });

  it("returns null on non-OK responses (graceful degradation)", async () => {
    // Re-stub for this case — beforeEach gave us a 200 stub.
    stubFetch({}, false);
    const { terminal } = await importClient();
    const result = await terminal.straddle0dte();
    expect(result).toBeNull();
  });

  it("returns null on fetch rejection (network error)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const { terminal } = await importClient();
    const result = await terminal.straddle0dte();
    expect(result).toBeNull();
  });
});


describe("terminal.straddle0dte (no base URL configured)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_TERMINAL_API_URL", "");
    vi.stubEnv("VITE_TERMINAL_API_KEY", "");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("short-circuits to null when VITE_TERMINAL_API_URL is unset", async () => {
    // Without a base URL the client can't construct a request — it
    // must return null instead of hitting an undefined origin. This
    // mirrors the GitHub-Pages-only demo-mode deploy where the
    // operator never configures a terminal-API URL.
    const fetchStub = vi.fn();
    globalThis.fetch = fetchStub as unknown as typeof fetch;
    const { terminal } = await importClient();
    const result = await terminal.straddle0dte();
    expect(result).toBeNull();
    expect(fetchStub).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
