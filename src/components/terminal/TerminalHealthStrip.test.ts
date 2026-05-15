// @vitest-environment node
//
// Tests the pure `buildHealthBody` helper that formats the dashboard
// health-strip's degraded-subsystem list. Keeps environment node-only
// (no jsdom needed for a pure-string utility).

import { describe, expect, it } from "vitest";

import { buildHealthBody } from "./terminalHealthStripHelpers";

describe("buildHealthBody", () => {
  it("returns null when both lists are empty (healthy state)", () => {
    expect(buildHealthBody([], [])).toBeNull();
  });

  it("uppercases ticker-like stream names (VIX, HYG, etc.)", () => {
    expect(buildHealthBody(["vix", "hyg"], [])).toBe("Streams: VIX, HYG");
  });

  it("humanizes historical-slot snake_case to English-with-parentheses", () => {
    expect(buildHealthBody([], ["intraday_eth"])).toBe(
      "Historical: intraday (ETH)",
    );
    expect(buildHealthBody([], ["intraday_rth"])).toBe(
      "Historical: intraday (RTH)",
    );
    expect(buildHealthBody([], ["daily"])).toBe("Historical: daily");
  });

  it("joins both subsystems with a bullet separator", () => {
    expect(
      buildHealthBody(["vix"], ["intraday_eth", "daily"]),
    ).toBe("Streams: VIX · Historical: intraday (ETH), daily");
  });

  it("handles single-entry lists cleanly (no trailing punctuation)", () => {
    expect(buildHealthBody(["vix"], [])).toBe("Streams: VIX");
    expect(buildHealthBody([], ["daily"])).toBe("Historical: daily");
  });

  it("passes through unknown stream names unchanged (no allow-list match)", () => {
    expect(buildHealthBody(["somefuture"], [])).toBe("Streams: somefuture");
  });

  it("collapses underscored ticker (VIX_3M → VIX3M) when uppercasing", () => {
    expect(buildHealthBody(["vix_3m"], [])).toBe("Streams: VIX3M");
  });
});
