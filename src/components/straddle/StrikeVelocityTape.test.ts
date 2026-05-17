/**
 * Helper specs for `StrikeVelocityTape` (v4 lane redesign — #325).
 *
 * The component itself is exercised via the helpers — there's no
 * React-test setup in this project. Coverage targets:
 *   - Volume aggregates (sumVolume, formatVolume, rowTotalVolume,
 *     rowSplit, rowMaxVol, panelMaxVol)
 *   - Minute axis + label mask (buildMinuteAxis, formatMinuteLabel,
 *     buildXLabelMask)
 *   - Strike selection (selectVisibleStrikes — cap, ATM centering)
 *   - Price-to-y interpolation (priceToY — clamp, between-row,
 *     edge cases)
 *   - Dominance color (call/put thresholds, zero-cell transparency)
 */

import { describe, expect, it } from "vitest";
import type { VelocityStrike, VelocityTape } from "../../api/terminalTypes";
import {
  buildMinuteAxis,
  buildXLabelMask,
  dominanceColor,
  formatMinuteLabel,
  formatVolume,
  MAX_ROWS,
  panelMaxVol,
  priceToY,
  ROW_H,
  rowMaxVol,
  rowSplit,
  rowTotalVolume,
  selectVisibleStrikes,
  STRIKE_COL_W,
  sumVolume,
} from "./strikeVelocityHelpers";

// ── fixtures ───────────────────────────────────────────────────────

function minute(ts: string, volume: number) {
  return { ts, volume, trade_count: Math.max(1, Math.floor(volume / 4)), avg_price: 2.5 };
}

function strike(overrides: Partial<VelocityStrike> = {}): VelocityStrike {
  return {
    strike: 7500,
    call_minutes: [
      minute("2026-05-15T15:30:00-04:00", 60),
      minute("2026-05-15T15:31:00-04:00", 50),
    ],
    put_minutes: [
      minute("2026-05-15T15:30:00-04:00", 10),
    ],
    call_spike_minutes: [],
    put_spike_minutes: [],
    ...overrides,
  };
}

function tape(overrides: Partial<VelocityTape> = {}): VelocityTape {
  return {
    replay_session_date: "20260515",
    window_start: "2026-05-15T15:30:00-04:00",
    window_end: "2026-05-15T16:00:00-04:00",
    spot_path: null,
    strikes: [strike()],
    ...overrides,
  };
}

// ── sumVolume ──────────────────────────────────────────────────────

describe("sumVolume", () => {
  it("sums an array of minutes", () => {
    expect(sumVolume([minute("t", 10), minute("t", 20)])).toBe(30);
  });
  it("returns 0 on empty input", () => {
    expect(sumVolume([])).toBe(0);
  });
});

// ── formatVolume ───────────────────────────────────────────────────

describe("formatVolume", () => {
  it("returns the raw value for sub-1000 numbers", () => {
    expect(formatVolume(0)).toBe("0");
    expect(formatVolume(7)).toBe("7");
    expect(formatVolume(999)).toBe("999");
  });
  it("returns k-formatted for >= 1000", () => {
    expect(formatVolume(1000)).toBe("1.0k");
    expect(formatVolume(5583)).toBe("5.6k");
    expect(formatVolume(12345)).toBe("12.3k");
  });
});

// ── rowTotalVolume, rowSplit ───────────────────────────────────────

describe("rowTotalVolume", () => {
  it("sums call + put minute volumes", () => {
    expect(rowTotalVolume(strike())).toBe(60 + 50 + 10);
  });
});

describe("rowSplit", () => {
  it("returns call/put/total broken down", () => {
    const s = rowSplit(strike());
    expect(s).toEqual({ call: 110, put: 10, total: 120 });
  });
  it("handles a zero-volume strike", () => {
    const s = rowSplit(strike({ call_minutes: [], put_minutes: [] }));
    expect(s).toEqual({ call: 0, put: 0, total: 0 });
  });
});

// ── rowMaxVol ──────────────────────────────────────────────────────

describe("rowMaxVol", () => {
  it("returns the largest (call+put) per minute, not just per-side max", () => {
    // Per-side maxes would say 60 (call) — but at ts1 there's ALSO a
    // put of 50, so the (call+put) total at ts1 is 110. That's the
    // value that drives the lane's height scale.
    const s = strike({
      call_minutes: [
        minute("2026-05-15T15:30:00-04:00", 60),
        minute("2026-05-15T15:31:00-04:00", 30),
      ],
      put_minutes: [
        minute("2026-05-15T15:30:00-04:00", 50),
      ],
    });
    expect(rowMaxVol(s)).toBe(110);
  });
  it("returns 1 (not 0) on an empty strike so callers can divide safely", () => {
    expect(rowMaxVol(strike({ call_minutes: [], put_minutes: [] }))).toBe(1);
  });
  it("counts each minute independently", () => {
    const s = strike({
      call_minutes: [
        minute("2026-05-15T15:30:00-04:00", 30),
        minute("2026-05-15T15:31:00-04:00", 100),
      ],
      put_minutes: [],
    });
    expect(rowMaxVol(s)).toBe(100);
  });
});

// ── panelMaxVol ────────────────────────────────────────────────────

describe("panelMaxVol", () => {
  const ts1 = "2026-05-15T15:30:00-04:00";
  it("scans only the visible-strike subset", () => {
    const t = tape({
      strikes: [
        strike({ strike: 7500, call_minutes: [minute(ts1, 100)], put_minutes: [] }),
        strike({ strike: 7510, call_minutes: [minute(ts1, 800)], put_minutes: [] }),
        strike({ strike: 7520, call_minutes: [minute(ts1, 250)], put_minutes: [] }),
      ],
    });
    // 7510 has the highest minute total but is NOT in visible →
    // panelMax must be 250 (the second-highest, which IS visible).
    expect(panelMaxVol(t, [7500, 7520])).toBe(250);
    // When all three are visible, 800 wins.
    expect(panelMaxVol(t, [7500, 7510, 7520])).toBe(800);
  });
  it("returns 1 (not 0) on empty input so callers can divide safely", () => {
    expect(panelMaxVol(tape({ strikes: [] }), [])).toBe(1);
  });
});

// ── buildMinuteAxis ────────────────────────────────────────────────

describe("buildMinuteAxis", () => {
  const ts1 = "2026-05-15T15:30:00-04:00";
  const ts2 = "2026-05-15T15:31:00-04:00";
  const ts3 = "2026-05-15T15:32:00-04:00";
  it("unions and sorts call + put minute timestamps", () => {
    const t = tape({
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [minute(ts1, 1), minute(ts3, 1)],
          put_minutes: [minute(ts2, 1)],
        }),
      ],
    });
    expect(buildMinuteAxis(t)).toEqual([ts1, ts2, ts3]);
  });
  it("dedupes timestamps shared by call+put sides", () => {
    const t = tape({
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [minute(ts1, 60)],
          put_minutes: [minute(ts1, 10)],
        }),
      ],
    });
    expect(buildMinuteAxis(t)).toEqual([ts1]);
  });
});

// ── formatMinuteLabel ──────────────────────────────────────────────

describe("formatMinuteLabel", () => {
  it("extracts HH:MM from an ISO timestamp with offset", () => {
    expect(formatMinuteLabel("2026-05-15T15:30:00-04:00")).toBe("15:30");
    expect(formatMinuteLabel("2026-05-15T09:45:30-04:00")).toBe("09:45");
  });
  it("returns the raw string on parse failure", () => {
    expect(formatMinuteLabel("not-a-ts")).toBe("not-a-ts");
  });
});

// ── buildXLabelMask ────────────────────────────────────────────────

describe("buildXLabelMask", () => {
  it("marks 5-min stride boundaries AND always marks the last index", () => {
    const axis = [
      "2026-05-15T15:32:00-04:00",
      "2026-05-15T15:33:00-04:00",
      "2026-05-15T15:34:00-04:00",
      "2026-05-15T15:35:00-04:00", // stride
      "2026-05-15T15:36:00-04:00",
      "2026-05-15T15:40:00-04:00", // stride + last
    ];
    expect(buildXLabelMask(axis)).toEqual([false, false, false, true, false, true]);
  });
  it("force-shows the rightmost label as the live-minute cue", () => {
    const axis = [
      "2026-05-15T15:31:00-04:00",
      "2026-05-15T15:32:00-04:00",
      "2026-05-15T15:33:00-04:00",
    ];
    expect(buildXLabelMask(axis)).toEqual([false, false, true]);
  });
  it("single-element axis: only index is the last → true", () => {
    expect(buildXLabelMask(["2026-05-15T15:33:00-04:00"])).toEqual([true]);
  });
  it("empty axis → empty mask", () => {
    expect(buildXLabelMask([])).toEqual([]);
  });
  it("hour wraparound: :55 stride / :00 stride / :01 force-last", () => {
    const axis = [
      "2026-05-15T15:55:00-04:00", // stride
      "2026-05-15T15:56:00-04:00",
      "2026-05-15T15:57:00-04:00",
      "2026-05-15T15:58:00-04:00",
      "2026-05-15T15:59:00-04:00",
      "2026-05-15T16:00:00-04:00", // stride
      "2026-05-15T16:01:00-04:00", // force-last
    ];
    expect(buildXLabelMask(axis)).toEqual([
      true, false, false, false, false, true, true,
    ]);
  });
});

// ── selectVisibleStrikes ───────────────────────────────────────────

describe("selectVisibleStrikes", () => {
  it("returns all strikes (sorted desc) when count <= maxRows", () => {
    const t = tape({
      strikes: [
        strike({ strike: 7490 }),
        strike({ strike: 7510 }),
        strike({ strike: 7500 }),
      ],
    });
    expect(selectVisibleStrikes(t, 7500, 15)).toEqual([7510, 7500, 7490]);
  });
  it("caps at maxRows, centered on ATM, descending", () => {
    const strikes = Array.from({ length: 25 }, (_, i) => ({
      strike: 7400 + i * 5,
    }));
    const t = tape({
      strikes: strikes.map((s) => strike({ strike: s.strike })),
    });
    const visible = selectVisibleStrikes(t, 7500, 7);
    // 7 closest to 7500 → 7485-7515 (3 below, 3 above, plus ATM).
    expect(visible).toEqual([7515, 7510, 7505, 7500, 7495, 7490, 7485]);
  });
  it("uses the median tape strike when atmStrike is null", () => {
    const t = tape({
      strikes: [
        strike({ strike: 7480 }),
        strike({ strike: 7500 }),
        strike({ strike: 7520 }),
      ],
    });
    // 3 strikes ≤ maxRows so all return; ordering is descending.
    expect(selectVisibleStrikes(t, null, 15)).toEqual([7520, 7500, 7480]);
  });
  it("returns [] for an empty tape", () => {
    expect(selectVisibleStrikes(tape({ strikes: [] }), 7500, 15)).toEqual([]);
  });
});

// ── priceToY ───────────────────────────────────────────────────────

describe("priceToY", () => {
  const strikes = [7530, 7525, 7520, 7515, 7510, 7505, 7500, 7495, 7490, 7485, 7480, 7475];
  it("returns row-center y for an on-strike price", () => {
    // 7500 is at index 6 (descending list), row center y = 6.5 * 44 = 286.
    expect(priceToY(7500, strikes, ROW_H)).toBeCloseTo(6.5 * ROW_H, 5);
  });
  it("interpolates between two adjacent strikes", () => {
    // 7494.5 between 7495 (idx 7, center 7.5*44=330) and 7490 (idx 8,
    // center 8.5*44=374). Fraction = (7495-7494.5)/(7495-7490) = 0.1.
    // y = 330 + 0.1 * 44 = 334.4.
    expect(priceToY(7494.5, strikes, ROW_H)).toBeCloseTo(334.4, 5);
  });
  it("clamps to top row center for prices above the visible window", () => {
    expect(priceToY(8000, strikes, ROW_H)).toBeCloseTo(0.5 * ROW_H, 5);
  });
  it("clamps to bottom row center for prices below the visible window", () => {
    expect(priceToY(7000, strikes, ROW_H)).toBeCloseTo(11.5 * ROW_H, 5);
  });
  it("clamps prices at exactly the top strike", () => {
    expect(priceToY(7530, strikes, ROW_H)).toBeCloseTo(0.5 * ROW_H, 5);
  });
  it("clamps prices at exactly the bottom strike", () => {
    expect(priceToY(7475, strikes, ROW_H)).toBeCloseTo(11.5 * ROW_H, 5);
  });
  it("returns 0 on an empty strike list", () => {
    expect(priceToY(7500, [], ROW_H)).toBe(0);
  });
});

// ── dominanceColor ────────────────────────────────────────────────

describe("dominanceColor", () => {
  it("returns transparent for zero total volume", () => {
    expect(dominanceColor(0, 0)).toBe("transparent");
  });
  it("returns the balanced slate when callShare is in [0.4, 0.6]", () => {
    // 50/50 → callShare = 0.5
    expect(dominanceColor(100, 100)).toBe("#475569");
    // 40/60 → callShare = 0.4 (boundary, still balanced)
    expect(dominanceColor(40, 60)).toBe("#475569");
    // 60/40 → callShare = 0.6 (boundary)
    expect(dominanceColor(60, 40)).toBe("#475569");
  });
  it("returns a blue hue when callShare > 0.6", () => {
    // Pure calls → callShare = 1.0 → most saturated blue.
    const pureCall = dominanceColor(100, 0);
    expect(pureCall).toMatch(/^rgb\((\d+),(\d+),(\d+)\)$/);
    const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(pureCall)!;
    // R component should be the smallest of the three (a blue tint).
    expect(Number(m[1])).toBeLessThan(Number(m[3]));
    expect(Number(m[2])).toBeLessThan(Number(m[3]));
  });
  it("returns an amber hue when callShare < 0.4", () => {
    // Pure puts → callShare = 0.0 → most saturated amber.
    const purePut = dominanceColor(0, 100);
    expect(purePut).toMatch(/^rgb\((\d+),(\d+),(\d+)\)$/);
    const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(purePut)!;
    // R > G > B for amber-orange.
    expect(Number(m[1])).toBeGreaterThan(Number(m[2]));
    expect(Number(m[2])).toBeGreaterThan(Number(m[3]));
  });
  it("transitions continuously through the call-heavy band", () => {
    // 61% call should be a paler blue than 100% call.
    const justOverThreshold = dominanceColor(61, 39);
    const pureCall = dominanceColor(100, 0);
    expect(justOverThreshold).not.toBe(pureCall);
    expect(justOverThreshold).toMatch(/^rgb\(/);
  });
});

// ── Cold-start (all-null headlines) integration smoke ─────────────

describe("cold-start: all-null headlines", () => {
  // Per the snapshotter contract documented in StrikeVelocityTape.tsx
  // (automated-dc-entry/futures_terminal/systems/straddle_chain.py:822-823),
  // `spot`/`emUpper`/`emLower`/`atmStrike` populate atomically — either
  // all are non-null (live snapshot) or all are null (cold-start).
  // These tests pin that the helpers produce sensible output for the
  // all-null shape so the panel renders the replay window without
  // crashing or producing misleading visuals.
  const ts1 = "2026-05-15T15:30:00-04:00";
  const t = tape({
    strikes: [
      strike({ strike: 7510, call_minutes: [minute(ts1, 80)], put_minutes: [] }),
      strike({ strike: 7500, call_minutes: [minute(ts1, 100)], put_minutes: [minute(ts1, 50)] }),
      strike({ strike: 7490, call_minutes: [], put_minutes: [minute(ts1, 60)] }),
    ],
  });
  it("selectVisibleStrikes with all-null headlines returns the full strike list sorted descending (early-return path)", () => {
    // 3 strikes ≤ maxRows=15, so the helper short-circuits BEFORE the
    // median fallback runs. The next test exercises the actual median-
    // fallback branch (count > maxRows).
    expect(selectVisibleStrikes(t, null, 15)).toEqual([7510, 7500, 7490]);
  });
  it("selectVisibleStrikes median fallback fires when count > maxRows", () => {
    const wide = tape({
      strikes: Array.from({ length: 20 }, (_, i) =>
        strike({ strike: 7400 + i * 5 }),
      ),
    });
    // All strikes equidistant; median is 7450 (idx 10, since sorted
    // ascending input is the array order). Take 5 closest to 7450 → 7440–7460.
    const visible = selectVisibleStrikes(wide, null, 5);
    expect(visible).toEqual([7460, 7455, 7450, 7445, 7440]);
  });
  it("priceToY returns 0 when no strikes are visible", () => {
    expect(priceToY(7500, [], ROW_H)).toBe(0);
  });
  it("rowMaxVol and panelMaxVol remain >= 1 even on empty data", () => {
    const empty = tape({ strikes: [] });
    expect(panelMaxVol(empty, [])).toBe(1);
    expect(rowMaxVol(strike({ call_minutes: [], put_minutes: [] }))).toBe(1);
  });
});

// ── Geometry constants are exported for CSS coordination ──────────

describe("layout constants", () => {
  it("ROW_H matches CSS .svt-row { height } in StrikeVelocityTape.css", () => {
    // If you change ROW_H here, update StrikeVelocityTape.css's
    // `.svt-row { height: 44px }` to match — priceToY interpolation
    // produces y-pixels in this unit.
    expect(ROW_H).toBe(44);
  });
  it("STRIKE_COL_W matches CSS .svt-row first grid-template column", () => {
    // The triangle overlay is `position: absolute; width: 96px` in
    // CSS. Tests assert against this value so any drift is caught.
    expect(STRIKE_COL_W).toBe(96);
  });
  it("MAX_ROWS keeps panel height bounded", () => {
    expect(MAX_ROWS).toBe(15);
  });
});
