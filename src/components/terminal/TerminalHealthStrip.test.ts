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

  it("formats streams-only degradation", () => {
    expect(buildHealthBody(["vix", "hyg"], [])).toBe("Streams: vix, hyg");
  });

  it("formats historical-only degradation", () => {
    expect(buildHealthBody([], ["intraday_eth"])).toBe(
      "Historical: intraday_eth",
    );
  });

  it("joins both subsystems with a bullet separator", () => {
    expect(
      buildHealthBody(["vix"], ["intraday_eth", "daily"]),
    ).toBe("Streams: vix · Historical: intraday_eth, daily");
  });

  it("handles single-entry lists cleanly (no trailing punctuation)", () => {
    expect(buildHealthBody(["vix"], [])).toBe("Streams: vix");
    expect(buildHealthBody([], ["daily"])).toBe("Historical: daily");
  });
});
