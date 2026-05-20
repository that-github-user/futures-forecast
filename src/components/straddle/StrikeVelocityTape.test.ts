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
  cellIndexFromX,
  classifyLiveStatus,
  dominanceColor,
  nextFocusedCell,
  formatMinuteLabel,
  formatVolume,
  MAX_ROWS,
  panelMaxVol,
  priceToY,
  resolveSpikeSigma,
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
  it("suppresses the penultimate stride label when adjacent to a non-stride live label (#322)", () => {
    // Replay window ends at :56 (non-stride). The penultimate index
    // is :55 (stride). Without collision avoidance both labels
    // render one minute apart and overlap at typical axis widths.
    // After #322: the penultimate stride is dropped; the live-minute
    // label reads cleanly.
    const axis = [
      "2026-05-15T15:53:00-04:00", // :53 → false
      "2026-05-15T15:54:00-04:00", // :54 → false
      "2026-05-15T15:55:00-04:00", // :55 stride, but PENULTIMATE → suppressed
      "2026-05-15T15:56:00-04:00", // :56 non-stride live → force-true
    ];
    expect(buildXLabelMask(axis)).toEqual([false, false, false, true]);
  });

  it("keeps the penultimate stride when the live label IS on a stride (no collision)", () => {
    // Window ends at :40 (stride). Penultimate :35 is stride — both
    // are 5 minutes apart, no visual collision. Both survive.
    const axis = [
      "2026-05-15T15:31:00-04:00",
      "2026-05-15T15:32:00-04:00",
      "2026-05-15T15:35:00-04:00", // stride
      "2026-05-15T15:36:00-04:00",
      "2026-05-15T15:40:00-04:00", // stride + live
    ];
    expect(buildXLabelMask(axis)).toEqual([false, false, true, false, true]);
  });

  it("keeps a penultimate non-stride when live is non-stride (no collision to suppress)", () => {
    // Window ends at :04 (non-stride). Penultimate :03 is non-stride
    // — already false; no special-case suppression to apply.
    const axis = [
      "2026-05-15T16:00:00-04:00", // stride
      "2026-05-15T16:01:00-04:00",
      "2026-05-15T16:02:00-04:00",
      "2026-05-15T16:03:00-04:00",
      "2026-05-15T16:04:00-04:00", // live, non-stride
    ];
    expect(buildXLabelMask(axis)).toEqual([true, false, false, false, true]);
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
  it("hour wraparound: :55 stride / :00 penultimate-stride suppressed / :01 force-last", () => {
    // Hour boundary case: :55 stride survives (5 min away from live);
    // :00 stride would render alongside :01 live (non-stride) — both
    // sit one minute apart → visual collision → suppressed by #322
    // collision-avoidance.
    const axis = [
      "2026-05-15T15:55:00-04:00", // stride
      "2026-05-15T15:56:00-04:00",
      "2026-05-15T15:57:00-04:00",
      "2026-05-15T15:58:00-04:00",
      "2026-05-15T15:59:00-04:00",
      "2026-05-15T16:00:00-04:00", // penultimate stride — suppressed (#322)
      "2026-05-15T16:01:00-04:00", // force-last
    ];
    expect(buildXLabelMask(axis)).toEqual([
      true, false, false, false, false, false, true,
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

// ── cellIndexFromX (hover-tooltip mouse → column) ─────────────────

describe("cellIndexFromX", () => {
  // Mock SVG bounding rect at left=100 width=600 (so the lane spans
  // 100..700 in client coords). 30-minute axis → each column is 20px wide.
  const rect = { left: 100, width: 600 };
  const N = 30;
  it("maps a cursor at the leftmost edge to column 0", () => {
    expect(cellIndexFromX(100, rect, N)).toBe(0);
    expect(cellIndexFromX(119, rect, N)).toBe(0);
  });
  it("maps a cursor at the rightmost cell to column N-1", () => {
    expect(cellIndexFromX(685, rect, N)).toBe(29);
  });
  it("maps a cursor in the middle correctly", () => {
    // x=300: each column is 20px wide (600/30), col 0 spans 100..119,
    // col 1 spans 120..139, ..., col 10 spans 300..319. x=300 lands at
    // the START of col 10.
    expect(cellIndexFromX(300, rect, N)).toBe(10);
  });
  it("returns -1 for cursor LEFT of the lane", () => {
    expect(cellIndexFromX(50, rect, N)).toBe(-1);
  });
  it("returns -1 for cursor RIGHT of the lane (frac >= 1)", () => {
    expect(cellIndexFromX(700, rect, N)).toBe(-1);
    expect(cellIndexFromX(800, rect, N)).toBe(-1);
  });
  it("returns -1 on zero width (degenerate layout)", () => {
    expect(cellIndexFromX(100, { left: 100, width: 0 }, N)).toBe(-1);
  });
  it("returns -1 on zero axisLength (empty tape)", () => {
    expect(cellIndexFromX(300, rect, 0)).toBe(-1);
  });
  it("works with a long axis (regression guard for low cellW values)", () => {
    // 200 columns over 600px → 3px per column. Cursor at x=190
    // is 90/600=15% across → floor(0.15 * 200) = 30.
    expect(cellIndexFromX(190, rect, 200)).toBe(30);
  });
  it("returns -1 for NaN inputs (defensive guard, #329 R1 nit 2)", () => {
    expect(cellIndexFromX(NaN, rect, N)).toBe(-1);
    expect(cellIndexFromX(300, { left: NaN, width: 600 }, N)).toBe(-1);
    expect(cellIndexFromX(300, { left: 100, width: NaN }, N)).toBe(-1);
  });
});

// ── #331 keyboard nav (nextFocusedCell) ──────────────────────────

describe("nextFocusedCell", () => {
  const MAX_ROW = 4;
  const MAX_COL = 9;

  it("returns 'init' when no cell is focused and a nav key is pressed", () => {
    expect(nextFocusedCell("ArrowLeft", null, MAX_ROW, MAX_COL))
      .toEqual({ kind: "init" });
    expect(nextFocusedCell("ArrowRight", null, MAX_ROW, MAX_COL))
      .toEqual({ kind: "init" });
    expect(nextFocusedCell("ArrowUp", null, MAX_ROW, MAX_COL))
      .toEqual({ kind: "init" });
    expect(nextFocusedCell("ArrowDown", null, MAX_ROW, MAX_COL))
      .toEqual({ kind: "init" });
    expect(nextFocusedCell("Home", null, MAX_ROW, MAX_COL))
      .toEqual({ kind: "init" });
    expect(nextFocusedCell("End", null, MAX_ROW, MAX_COL))
      .toEqual({ kind: "init" });
    expect(nextFocusedCell("PageUp", null, MAX_ROW, MAX_COL))
      .toEqual({ kind: "init" });
    expect(nextFocusedCell("PageDown", null, MAX_ROW, MAX_COL))
      .toEqual({ kind: "init" });
  });

  it("returns 'unchanged' for non-nav keys with no focus (Tab still works)", () => {
    expect(nextFocusedCell("Tab", null, MAX_ROW, MAX_COL))
      .toEqual({ kind: "unchanged" });
    expect(nextFocusedCell("a", null, MAX_ROW, MAX_COL))
      .toEqual({ kind: "unchanged" });
    expect(nextFocusedCell("Enter", null, MAX_ROW, MAX_COL))
      .toEqual({ kind: "unchanged" });
  });

  it("Escape always returns 'clear', regardless of focus state", () => {
    expect(nextFocusedCell("Escape", null, MAX_ROW, MAX_COL))
      .toEqual({ kind: "clear" });
    expect(nextFocusedCell("Escape", { rowIdx: 2, colIdx: 5 }, MAX_ROW, MAX_COL))
      .toEqual({ kind: "clear" });
  });

  it("arrow keys move within bounds — left / right", () => {
    expect(nextFocusedCell("ArrowLeft", { rowIdx: 2, colIdx: 5 }, MAX_ROW, MAX_COL))
      .toEqual({ kind: "move", rowIdx: 2, colIdx: 4 });
    expect(nextFocusedCell("ArrowRight", { rowIdx: 2, colIdx: 5 }, MAX_ROW, MAX_COL))
      .toEqual({ kind: "move", rowIdx: 2, colIdx: 6 });
  });

  it("arrow keys move within bounds — up / down", () => {
    expect(nextFocusedCell("ArrowUp", { rowIdx: 2, colIdx: 5 }, MAX_ROW, MAX_COL))
      .toEqual({ kind: "move", rowIdx: 1, colIdx: 5 });
    expect(nextFocusedCell("ArrowDown", { rowIdx: 2, colIdx: 5 }, MAX_ROW, MAX_COL))
      .toEqual({ kind: "move", rowIdx: 3, colIdx: 5 });
  });

  it("clamps at edges (left/top/right/bottom) — no wrap-around", () => {
    expect(nextFocusedCell("ArrowLeft", { rowIdx: 2, colIdx: 0 }, MAX_ROW, MAX_COL))
      .toEqual({ kind: "move", rowIdx: 2, colIdx: 0 });
    expect(nextFocusedCell("ArrowUp", { rowIdx: 0, colIdx: 5 }, MAX_ROW, MAX_COL))
      .toEqual({ kind: "move", rowIdx: 0, colIdx: 5 });
    expect(nextFocusedCell("ArrowRight", { rowIdx: 2, colIdx: MAX_COL }, MAX_ROW, MAX_COL))
      .toEqual({ kind: "move", rowIdx: 2, colIdx: MAX_COL });
    expect(nextFocusedCell("ArrowDown", { rowIdx: MAX_ROW, colIdx: 5 }, MAX_ROW, MAX_COL))
      .toEqual({ kind: "move", rowIdx: MAX_ROW, colIdx: 5 });
  });

  it("Home / End jump to row-start / row-end", () => {
    expect(nextFocusedCell("Home", { rowIdx: 2, colIdx: 5 }, MAX_ROW, MAX_COL))
      .toEqual({ kind: "move", rowIdx: 2, colIdx: 0 });
    expect(nextFocusedCell("End", { rowIdx: 2, colIdx: 5 }, MAX_ROW, MAX_COL))
      .toEqual({ kind: "move", rowIdx: 2, colIdx: MAX_COL });
  });

  it("PageUp / PageDown jump to first / last row", () => {
    expect(nextFocusedCell("PageUp", { rowIdx: 2, colIdx: 5 }, MAX_ROW, MAX_COL))
      .toEqual({ kind: "move", rowIdx: 0, colIdx: 5 });
    expect(nextFocusedCell("PageDown", { rowIdx: 2, colIdx: 5 }, MAX_ROW, MAX_COL))
      .toEqual({ kind: "move", rowIdx: MAX_ROW, colIdx: 5 });
  });

  it("returns 'unchanged' for non-nav keys with focus set (lets Tab through)", () => {
    expect(nextFocusedCell("Tab", { rowIdx: 2, colIdx: 5 }, MAX_ROW, MAX_COL))
      .toEqual({ kind: "unchanged" });
    expect(nextFocusedCell("Enter", { rowIdx: 2, colIdx: 5 }, MAX_ROW, MAX_COL))
      .toEqual({ kind: "unchanged" });
  });

  it("returns 'unchanged' on degenerate grid (no rows or no cols)", () => {
    // Empty axis or empty row list → degenerate grid; nav must
    // refuse to init / move (avoids colIdx=-1 from the init path).
    expect(nextFocusedCell("ArrowRight", null, -1, MAX_COL))
      .toEqual({ kind: "unchanged" });
    expect(nextFocusedCell("ArrowRight", null, MAX_ROW, -1))
      .toEqual({ kind: "unchanged" });
    expect(nextFocusedCell("Home", { rowIdx: 0, colIdx: 0 }, MAX_ROW, -1))
      .toEqual({ kind: "unchanged" });
  });

  it("Escape still clears focus even on degenerate grid", () => {
    // Escape should always work — defensive dismiss path.
    expect(nextFocusedCell("Escape", { rowIdx: 0, colIdx: 0 }, -1, -1))
      .toEqual({ kind: "clear" });
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

// ── resolveSpikeSigma (#330) ──────────────────────────────────────

describe("resolveSpikeSigma", () => {
  const TS = "2026-05-15T15:35:00-04:00";

  it("returns the call σ when only the call side flagged", () => {
    const calls = new Map([[TS, 5.2]]);
    const puts = new Map<string, number>();
    expect(resolveSpikeSigma(calls, puts, TS)).toBe(5.2);
  });

  it("returns the put σ when only the put side flagged", () => {
    const calls = new Map<string, number>();
    const puts = new Map([[TS, 7.1]]);
    expect(resolveSpikeSigma(calls, puts, TS)).toBe(7.1);
  });

  it("returns the MAX of the two when both sides flagged the same minute", () => {
    // Operator expectation: tooltip shows the larger σ so the
    // visible value lines up with the dominant side's outlier
    // magnitude. Lower σ would understate the burst.
    const calls = new Map([[TS, 5.2]]);
    const puts = new Map([[TS, 9.4]]);
    expect(resolveSpikeSigma(calls, puts, TS)).toBe(9.4);
  });

  it("returns null when neither side has a σ for the ts", () => {
    // Either a non-spike cell OR a pre-#330 backend payload where
    // the legacy spike timestamps populated but the σ maps are
    // empty. Tooltip falls back to the generic label.
    const calls = new Map<string, number>();
    const puts = new Map<string, number>();
    expect(resolveSpikeSigma(calls, puts, TS)).toBeNull();
  });

  it("returns null when the ts isn't in either map (different minute)", () => {
    // Sigmas exist for OTHER minutes but not this one — hovering an
    // un-spiked cell on a row that has spikes elsewhere must still
    // return null so the tooltip stays silent.
    const calls = new Map([["other-ts", 5.0]]);
    const puts = new Map([["another-ts", 6.0]]);
    expect(resolveSpikeSigma(calls, puts, TS)).toBeNull();
  });
});


// ── classifyLiveStatus (#349 PR-3) ────────────────────────────────

describe("classifyLiveStatus", () => {
  function tapeWith(overrides: Partial<VelocityTape>): VelocityTape {
    return {
      replay_session_date: "20260519",
      window_start: "2026-05-19T09:30:00-04:00",
      window_end: "2026-05-19T11:00:00-04:00",
      spot_path: null,
      strikes: [],
      ...overrides,
    };
  }

  it("returns cold-start when tape is null", () => {
    const status = classifyLiveStatus(null);
    expect(status.kind).toBe("cold-start");
  });

  it("returns LIVE when window_end is within the staleness threshold", () => {
    // window_end at 11:00 ET; 'now' 60s later → LIVE.
    const nowMs = Date.parse("2026-05-19T11:01:00-04:00");
    const status = classifyLiveStatus(
      tapeWith({ window_end: "2026-05-19T11:00:00-04:00" }),
      nowMs,
    );
    expect(status.kind).toBe("live");
    expect((status as { kind: "live"; ageSeconds: number }).ageSeconds)
      .toBeCloseTo(60, 0);
  });

  it("returns LIVE at exactly the staleness threshold boundary", () => {
    // 180s old — boundary inclusive per <= check.
    const nowMs = Date.parse("2026-05-19T11:03:00-04:00");
    const status = classifyLiveStatus(
      tapeWith({ window_end: "2026-05-19T11:00:00-04:00" }),
      nowMs,
    );
    expect(status.kind).toBe("live");
  });

  it("returns FROZEN when window_end is older than the staleness threshold", () => {
    // 5 min old — past the 180s threshold.
    const nowMs = Date.parse("2026-05-19T11:05:00-04:00");
    const status = classifyLiveStatus(
      tapeWith({ window_end: "2026-05-19T11:00:00-04:00" }),
      nowMs,
    );
    expect(status.kind).toBe("frozen");
    expect((status as { kind: "frozen"; sessionDate: string | null })
      .sessionDate).toBe("20260519");
  });

  it("returns FROZEN with the prior session's date for an aged replay", () => {
    // Tape from Friday's close; 'now' is Monday morning pre-RTH.
    const nowMs = Date.parse("2026-05-18T09:00:00-04:00");
    const status = classifyLiveStatus(
      tapeWith({
        replay_session_date: "20260515",
        window_end: "2026-05-15T16:00:00-04:00",
      }),
      nowMs,
    );
    expect(status.kind).toBe("frozen");
    expect((status as { kind: "frozen"; sessionDate: string | null })
      .sessionDate).toBe("20260515");
  });

  it("returns FROZEN when window_end is malformed (defensive)", () => {
    const status = classifyLiveStatus(
      tapeWith({ window_end: "not-a-date" }),
    );
    expect(status.kind).toBe("frozen");
  });
});
