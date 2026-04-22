// @vitest-environment node
//
// Covers the two helpers added for LiveCountdown — etSecondsOfDay and
// parseHHMMToSeconds. The larger lifecycle state machine is verified
// via the existing DCSignalsTab integration and by code review.

import { describe, expect, it } from "vitest";
import { etSecondsOfDay, parseHHMMToSeconds } from "./dcLifecycle";

describe("etSecondsOfDay", () => {
  it("midnight UTC in March maps to 20:00 ET (EDT UTC-4)", () => {
    // 2026-03-20 00:00:00 UTC === 2026-03-19 20:00:00 ET (DST active)
    const d = new Date("2026-03-20T00:00:00Z");
    expect(etSecondsOfDay(d)).toBe(20 * 3600);
  });

  it("midnight UTC in January maps to 19:00 ET (EST UTC-5)", () => {
    const d = new Date("2026-01-15T00:00:00Z");
    expect(etSecondsOfDay(d)).toBe(19 * 3600);
  });

  it("14:30 ET round-trips via UTC", () => {
    // 2026-04-21 18:30 UTC (DST, UTC-4) === 14:30 ET
    const d = new Date("2026-04-21T18:30:00Z");
    expect(etSecondsOfDay(d)).toBe(14 * 3600 + 30 * 60);
  });

  it("handles DST spring-forward correctly", () => {
    // 2026-03-08 07:00 UTC — the instant when DST begins in US.
    // Before: 02:00 EST; official wall-clock at that instant = 03:00 EDT.
    // Intl should report 03:00 ET (= 10800s).
    const d = new Date("2026-03-08T07:00:00Z");
    expect(etSecondsOfDay(d)).toBe(3 * 3600);
  });
});

describe("parseHHMMToSeconds", () => {
  it("parses 09:32", () => {
    expect(parseHHMMToSeconds("09:32")).toBe(9 * 3600 + 32 * 60);
  });

  it("parses 00:00 as 0", () => {
    expect(parseHHMMToSeconds("00:00")).toBe(0);
  });

  it("parses 16:00 (RTH close)", () => {
    expect(parseHHMMToSeconds("16:00")).toBe(16 * 3600);
  });

  it("zero-fills single-digit hours/minutes gracefully", () => {
    // The daemon emits zero-padded HH:MM, but make sure a stray "9:5"
    // doesn't explode — parseInt handles it.
    expect(parseHHMMToSeconds("9:5")).toBe(9 * 3600 + 5 * 60);
  });
});
