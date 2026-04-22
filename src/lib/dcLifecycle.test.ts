// @vitest-environment node
//
// Covers the two helpers added for LiveCountdown — etSecondsOfDay and
// parseHHMMToSeconds. The larger lifecycle state machine is verified
// via the existing DCSignalsTab integration and by code review.

import { describe, expect, it } from "vitest";
import { deriveLifecycle, etSecondsOfDay, parseHHMMToSeconds } from "./dcLifecycle";
import type { DCStrategySpec } from "../api/dcTypes";

// Minimal spec builder — only the fields deriveLifecycle actually reads.
function spec(entryTimesET: string[], entryDays: number[] = [0, 1, 2, 3, 4]): DCStrategySpec {
  return {
    name: "t",
    entry_days: entryDays,
    entry_times: entryTimesET,
    entry_window_end: null,
    profit_target_pct: 10,
    sl_ratio_min: null,
    sl_ratio_exit: null,
  } as unknown as DCStrategySpec;
}

// Build a Date at a specific ET wall-clock time on 2026-04-22 (Wed, EDT).
// April is always EDT, so the offset is fixed at -04:00.
function atET(hhmm: string, offsetSec = 0): Date {
  const base = new Date(`2026-04-22T${hhmm}:00-04:00`).valueOf();
  return new Date(base + offsetSec * 1000);
}

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

describe("deriveLifecycle: firing state is post-entry only", () => {
  // The whole point of this fix: the daemon's cron fires at HH:MM:00 and
  // then takes ~10-20s of work before the order actually submits. Showing
  // "FIRING NOW" *before* HH:MM misleads the viewer into thinking an order
  // has gone out when in reality the daemon hasn't even received the tick.
  // These tests pin that: pre-entry = imminent, post-entry = firing.

  const s = spec(["09:45"], [0, 1, 2, 3, 4]);

  it("30s before entry → imminent, NOT firing", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:44", 30));
    expect(info.state).toBe("imminent");
  });

  it("15s before entry → imminent, NOT firing", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:44", 45));
    expect(info.state).toBe("imminent");
  });

  it("1s before entry → imminent, NOT firing", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:44", 59));
    expect(info.state).toBe("imminent");
  });

  it("exactly at entry time → firing", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:45"));
    expect(info.state).toBe("firing");
  });

  it("15s after entry → firing", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:45", 15));
    expect(info.state).toBe("firing");
  });

  it("30s after entry → firing (boundary, inclusive)", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:45", 30));
    expect(info.state).toBe("firing");
  });

  it("31s after entry → recently_fired, not firing", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:45", 31));
    expect(info.state).toBe("recently_fired");
  });

  it("2 min before entry with GO → imminent (unchanged)", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:43"));
    expect(info.state).toBe("imminent");
  });

  it("SKIP signal 20s before entry → not_fired_yet (no false firing)", () => {
    const info = deriveLifecycle(s, "SKIP", false, atET("09:44", 40));
    expect(info.state).toBe("not_fired_yet");
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
