/**
 * Tests for the StrikeVelocityTape helpers.
 *
 * The React component is a thin shell over the data shapers in
 * `strikeVelocityHelpers.ts` — we pin those directly since the project
 * has no @testing-library/react setup (same pattern as
 * `StraddleMapChart.test.ts`). The visual layer's correctness is
 * implicit in the heatmap data array + spot path math being honest;
 * ECharts render is pure data → canvas.
 *
 * Heatmap redesign (#320) coverage:
 *   - sumVolume / rowTotalVolume math
 *   - formatVolume tiers (raw / k-suffix / zero)
 *   - buildMinuteAxis union semantics (per-side missing minutes)
 *   - resolveStrikeOrder honors strikeOrder from chart, filters
 *     missing strikes, falls back to descending tape order
 *   - buildHeatmapCells emits combined call+put totals, skips zero
 *     cells, attaches spike borders to spike minutes (either side)
 *   - buildSpotPathPoints returns null on missing/short spot_path
 *   - computeMaxVolume yields the max combined-volume cell, falls back
 *     to 1 on empty input
 *   - formatMinuteLabel renders HH:MM in ET
 */

import { describe, expect, it } from "vitest";
import type { VelocityStrike, VelocityTape } from "../../api/terminalTypes";
import { colors } from "../../styles/tokens";
import {
  buildHeatmapCells,
  buildMinuteAxis,
  buildSpotPathPoints,
  computeMaxVolume,
  formatMinuteLabel,
  formatVolume,
  resolveStrikeOrder,
  rowTotalVolume,
  SPIKE_BORDER_COLOR,
  SPIKE_BORDER_WIDTH,
  sumVolume,
} from "./strikeVelocityHelpers";


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


describe("sumVolume", () => {
  it("sums every minute's volume", () => {
    const s = strike();
    expect(sumVolume(s.call_minutes)).toBe(110);
    expect(sumVolume(s.put_minutes)).toBe(10);
  });

  it("returns 0 for empty array", () => {
    expect(sumVolume([])).toBe(0);
  });
});


describe("rowTotalVolume", () => {
  it("sums call + put volume across the entire window", () => {
    expect(rowTotalVolume(strike())).toBe(120);
  });

  it("works on a put-empty row (call-skewed Friday close)", () => {
    expect(rowTotalVolume(strike({ put_minutes: [] }))).toBe(110);
  });
});


describe("formatVolume", () => {
  it("renders zero as '0'", () => {
    expect(formatVolume(0)).toBe("0");
  });

  it("keeps sub-1000 values raw (illiquid strike readability)", () => {
    expect(formatVolume(7)).toBe("7");
    expect(formatVolume(123)).toBe("123");
    expect(formatVolume(999)).toBe("999");
  });

  it("uses k-suffix at >= 1000", () => {
    expect(formatVolume(1000)).toBe("1.0k");
    expect(formatVolume(5583)).toBe("5.6k");
    expect(formatVolume(12500)).toBe("12.5k");
  });
});


describe("buildMinuteAxis", () => {
  it("returns the sorted union across all (strike, side) minutes", () => {
    const t = tape({
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [
            minute("2026-05-15T15:30:00-04:00", 60),
            minute("2026-05-15T15:32:00-04:00", 80),
          ],
          put_minutes: [
            minute("2026-05-15T15:31:00-04:00", 10),
          ],
        }),
        strike({
          strike: 7505,
          call_minutes: [
            minute("2026-05-15T15:33:00-04:00", 40),
          ],
          put_minutes: [],
        }),
      ],
    });
    const axis = buildMinuteAxis(t);
    // Sorted ascending; one entry per unique minute across both sides.
    expect(axis).toEqual([
      "2026-05-15T15:30:00-04:00",
      "2026-05-15T15:31:00-04:00",
      "2026-05-15T15:32:00-04:00",
      "2026-05-15T15:33:00-04:00",
    ]);
  });

  it("returns empty array for a strikes-free tape", () => {
    expect(buildMinuteAxis(tape({ strikes: [] }))).toEqual([]);
  });
});


describe("resolveStrikeOrder", () => {
  const t = tape({
    strikes: [
      strike({ strike: 7495 }),
      strike({ strike: 7500 }),
      strike({ strike: 7505 }),
    ],
  });

  it("preserves chart-supplied order, filtering missing strikes", () => {
    // Chart passes descending order including a strike the tape lacks
    // (7510 isn't in the cluster); helper must drop it without crashing.
    const out = resolveStrikeOrder(t, [7510, 7505, 7500, 7495]);
    expect(out).toEqual([7505, 7500, 7495]);
  });

  it("defaults to tape's own strikes sorted descending when no chart order", () => {
    expect(resolveStrikeOrder(t, undefined)).toEqual([7505, 7500, 7495]);
  });

  it("treats an empty chart order as 'no order' and falls back", () => {
    expect(resolveStrikeOrder(t, [])).toEqual([7505, 7500, 7495]);
  });
});


describe("buildHeatmapCells", () => {
  const ts1 = "2026-05-15T15:30:00-04:00";
  const ts2 = "2026-05-15T15:31:00-04:00";
  const ts3 = "2026-05-15T15:32:00-04:00";

  it("emits combined call + put volume per (row, col) cell", () => {
    const t = tape({
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [minute(ts1, 60), minute(ts2, 50)],
          put_minutes: [minute(ts1, 10)],
        }),
      ],
    });
    const cells = buildHeatmapCells(t, [7500], [ts1, ts2, ts3]);
    // ts1: call 60 + put 10 = 70; ts2: call 50; ts3: no print (skipped)
    expect(cells.map((c) => c.value)).toEqual([
      [0, 0, 70],
      [1, 0, 50],
    ]);
  });

  it("skips cells with zero combined volume (no print)", () => {
    const t = tape({
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [minute(ts1, 60)],
          put_minutes: [],
        }),
      ],
    });
    const cells = buildHeatmapCells(t, [7500], [ts1, ts2]);
    // Only one cell — ts2 had no print on either side.
    expect(cells.length).toBe(1);
    expect(cells[0].value).toEqual([0, 0, 60]);
  });

  it("attaches a spike border when the minute is in either side's spike set", () => {
    const t = tape({
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [minute(ts1, 600)],
          put_minutes: [],
          call_spike_minutes: [ts1],
          put_spike_minutes: [],
        }),
      ],
    });
    const cells = buildHeatmapCells(t, [7500], [ts1]);
    expect(cells.length).toBe(1);
    expect(cells[0].itemStyle).toEqual({
      borderColor: SPIKE_BORDER_COLOR,
      borderWidth: SPIKE_BORDER_WIDTH,
    });
    // Spike border uses the accentRed token.
    expect(SPIKE_BORDER_COLOR).toBe(colors.accentRed);
  });

  it("flags a put-only spike just as it flags a call spike", () => {
    const t = tape({
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [],
          put_minutes: [minute(ts1, 200)],
          call_spike_minutes: [],
          put_spike_minutes: [ts1],
        }),
      ],
    });
    const cells = buildHeatmapCells(t, [7500], [ts1]);
    expect(cells[0].itemStyle?.borderColor).toBe(SPIKE_BORDER_COLOR);
  });

  it("emits cells in the row order the caller supplied (not tape order)", () => {
    const t = tape({
      strikes: [
        strike({ strike: 7495, call_minutes: [minute(ts1, 5)], put_minutes: [] }),
        strike({ strike: 7505, call_minutes: [minute(ts1, 15)], put_minutes: [] }),
        strike({ strike: 7500, call_minutes: [minute(ts1, 10)], put_minutes: [] }),
      ],
    });
    // Caller supplies descending order; cell row indices follow it.
    const cells = buildHeatmapCells(t, [7505, 7500, 7495], [ts1]);
    expect(cells.map((c) => c.value)).toEqual([
      [0, 0, 15], // 7505 → row 0
      [0, 1, 10], // 7500 → row 1
      [0, 2, 5],  // 7495 → row 2
    ]);
  });

  it("skips strikes the tape doesn't carry without crashing", () => {
    const t = tape({
      strikes: [strike({ strike: 7500, call_minutes: [minute(ts1, 10)], put_minutes: [] })],
    });
    const cells = buildHeatmapCells(t, [7510, 7500], [ts1]);
    // 7510 not in tape — only 7500 emits, at rowIdx=1 (caller's order).
    expect(cells).toEqual([{ value: [0, 1, 10] }]);
  });
});


describe("buildSpotPathPoints", () => {
  it("maps spot_path to [ts, price] tuples in order", () => {
    const t = tape({
      spot_path: [
        { ts: "2026-05-15T15:30:00-04:00", price: 7424.30 },
        { ts: "2026-05-15T15:45:00-04:00", price: 7416.55 },
        { ts: "2026-05-15T15:59:00-04:00", price: 7409.18 },
      ],
    });
    expect(buildSpotPathPoints(t)).toEqual([
      ["2026-05-15T15:30:00-04:00", 7424.30],
      ["2026-05-15T15:45:00-04:00", 7416.55],
      ["2026-05-15T15:59:00-04:00", 7409.18],
    ]);
  });

  it("returns null when spot_path is null", () => {
    expect(buildSpotPathPoints(tape({ spot_path: null }))).toBeNull();
  });

  it("returns null when spot_path has fewer than 2 points (can't form a line)", () => {
    expect(buildSpotPathPoints(tape({ spot_path: [] }))).toBeNull();
    expect(
      buildSpotPathPoints(
        tape({ spot_path: [{ ts: "2026-05-15T15:30:00-04:00", price: 7424.30 }] }),
      ),
    ).toBeNull();
  });
});


describe("computeMaxVolume", () => {
  it("returns the brightest combined-volume cell across all (strike, minute)", () => {
    const t = tape({
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [
            minute("2026-05-15T15:30:00-04:00", 60),
            minute("2026-05-15T15:31:00-04:00", 800),
          ],
          put_minutes: [
            minute("2026-05-15T15:30:00-04:00", 10),
          ],
        }),
        strike({
          strike: 7505,
          call_minutes: [minute("2026-05-15T15:30:00-04:00", 200)],
          put_minutes: [],
        }),
      ],
    });
    // 7500 @ 15:31 → 800 (call only) is the brightest.
    expect(computeMaxVolume(t, [7505, 7500])).toBe(800);
  });

  it("sums call + put when the same minute carries both sides", () => {
    const t = tape({
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [minute("2026-05-15T15:30:00-04:00", 60)],
          put_minutes: [minute("2026-05-15T15:30:00-04:00", 40)],
        }),
      ],
    });
    // 60 + 40 = 100 dominates the singleton-side cells.
    expect(computeMaxVolume(t, [7500])).toBe(100);
  });

  it("falls back to 1 (not 0) on no-data input to avoid degenerate visualMap range", () => {
    expect(computeMaxVolume(tape({ strikes: [] }), [])).toBe(1);
  });

  it("skips strikes the tape doesn't carry", () => {
    const t = tape({
      strikes: [
        strike({ strike: 7500, call_minutes: [minute("2026-05-15T15:30:00-04:00", 99)], put_minutes: [] }),
      ],
    });
    // Caller asks about a strike the tape lacks — helper safely skips it.
    expect(computeMaxVolume(t, [7510])).toBe(1);
  });
});


describe("formatMinuteLabel", () => {
  it("renders an ET wall-clock HH:MM label", () => {
    expect(formatMinuteLabel("2026-05-15T15:30:00-04:00")).toBe("15:30");
    expect(formatMinuteLabel("2026-05-15T15:42:00-04:00")).toBe("15:42");
  });

  it("falls back to the raw input on a non-parseable timestamp", () => {
    expect(formatMinuteLabel("not-a-date")).toBe("not-a-date");
  });
});


// ── Realistic-shape fixture pin ─────────────────────────────────────
// Locks the helper output for the real-data shape captured by the
// replay script — protects against accidental regressions in the
// shape the backend vends after future schema tweaks.

describe("real-shape fixture", () => {
  it("aggregates the real-Friday tape shape correctly", () => {
    const real: VelocityTape = {
      replay_session_date: "20260515",
      window_start: "2026-05-15T15:30:00-04:00",
      window_end: "2026-05-15T16:00:00-04:00",
      spot_path: [
        { ts: "2026-05-15T15:30:00-04:00", price: 7424.30 },
        { ts: "2026-05-15T15:59:00-04:00", price: 7409.18 },
      ],
      strikes: [
        {
          strike: 7500,
          call_minutes: [
            minute("2026-05-15T15:30:00-04:00", 57),
            minute("2026-05-15T15:31:00-04:00", 159),
            minute("2026-05-15T15:56:00-04:00", 800),
            minute("2026-05-15T15:59:00-04:00", 253),
          ],
          put_minutes: [
            minute("2026-05-15T15:30:00-04:00", 5),
          ],
          call_spike_minutes: ["2026-05-15T15:56:00-04:00"],
          put_spike_minutes: [],
        },
      ],
    };
    expect(rowTotalVolume(real.strikes[0])).toBe(1274);
    const axis = buildMinuteAxis(real);
    expect(axis.length).toBe(4);
    expect(axis[0]).toBe("2026-05-15T15:30:00-04:00");
    expect(axis[axis.length - 1]).toBe("2026-05-15T15:59:00-04:00");
    expect(formatVolume(rowTotalVolume(real.strikes[0]))).toBe("1.3k");

    // Heatmap helpers pin: 4 minutes × 1 strike = up to 4 cells; one
    // of them carries the spike border.
    const cells = buildHeatmapCells(real, [7500], axis);
    expect(cells.length).toBe(4);
    const spikeCell = cells.find((c) => c.value[0] === axis.indexOf("2026-05-15T15:56:00-04:00"));
    expect(spikeCell?.itemStyle?.borderColor).toBe(SPIKE_BORDER_COLOR);
    expect(spikeCell?.value[2]).toBe(800); // brightest cell

    // Spot path: 2 points → renders.
    const spotPts = buildSpotPathPoints(real);
    expect(spotPts).toEqual([
      ["2026-05-15T15:30:00-04:00", 7424.30],
      ["2026-05-15T15:59:00-04:00", 7409.18],
    ]);

    expect(computeMaxVolume(real, [7500])).toBe(800);
  });
});
