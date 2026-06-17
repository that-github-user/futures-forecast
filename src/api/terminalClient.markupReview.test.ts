/**
 * URL + auth tests for terminal.markupReview() — mirrors the straddle0dte
 * test. Pins the query-param wire contract (date + tf) and the X-Terminal-Key
 * header so a client-side regression is caught before it reaches operators.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FetchArgs = [input: string | URL, init?: RequestInit];

function stubFetch(jsonReturn: unknown = {}, ok = true) {
  const calls: FetchArgs[] = [];
  globalThis.fetch = vi.fn(async (...args: FetchArgs) => {
    calls.push(args);
    return { ok, json: async () => jsonReturn } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

async function importClient() {
  return import("./terminalClient");
}

describe("terminal.markupReview URL + auth", () => {
  let calls: FetchArgs[];

  beforeEach(() => {
    calls = stubFetch({
      session_date: "20260616",
      timeframe: "1m",
      bars: [],
      alerts: [],
      pending_count: 0,
      bars_stale: false,
      bars_age_seconds: null,
      asof: "2026-06-16T20:00:00Z",
    });
    vi.stubEnv("VITE_TERMINAL_API_URL", "https://terminal.example.com");
    vi.stubEnv("VITE_TERMINAL_API_KEY", "test-key-abc");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("hits /markup/review with date + tf query params", async () => {
    const { terminal } = await importClient();
    await terminal.markupReview("20260616", "5m");
    expect(calls.length).toBe(1);
    expect(String(calls[0][0])).toBe(
      "https://terminal.example.com/terminal/v1/markup/review?date=20260616&tf=5m",
    );
  });

  it("defaults tf to 1m", async () => {
    const { terminal } = await importClient();
    await terminal.markupReview("20260616");
    expect(String(calls[0][0])).toContain("tf=1m");
  });

  it("attaches X-Terminal-Key", async () => {
    const { terminal } = await importClient();
    await terminal.markupReview("20260616");
    const headers = calls[0][1]?.headers as Record<string, string> | undefined;
    expect(headers?.["X-Terminal-Key"]).toBe("test-key-abc");
  });

  it("returns the parsed body on 200 and null on error", async () => {
    const { terminal } = await importClient();
    const ok = await terminal.markupReview("20260616");
    expect(ok?.session_date).toBe("20260616");
    stubFetch({}, false);
    const { terminal: t2 } = await importClient();
    expect(await t2.markupReview("20260616")).toBeNull();
  });
});
