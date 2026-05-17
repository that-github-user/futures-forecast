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
  buildSpotPathSeries,
  buildUnifiedMinuteAxis,
  buildXLabelMask,
  computeMaxVolume,
  formatMinuteLabel,
  formatVolume,
  HEATMAP_GRID_BOTTOM,
  HEATMAP_GRID_TOP,
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

  it("emits a cell for EVERY (row, col) — including zero-volume cells (#206 R2 B2)", () => {
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
    // ts1: call 60 + put 10 = 70; ts2: call 50; ts3: no print → 0 cell
    // (operator can still hover for "0 prints this minute"; the
    // visualMap low stop renders this as a faint baseline tint).
    expect(cells.map((c) => c.value)).toEqual([
      [0, 0, 70],
      [1, 0, 50],
      [2, 0, 0],
    ]);
  });

  it("emits zero-volume cells with a transparent fill override (#206 R2 round-2 N1+N2)", () => {
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
    // Both ts1 and ts2 emit; ts2 is a zero cell. The visualMap's
    // amber-floor low stop would otherwise tint EVERY zero cell with a
    // faint warm wash, masking the "no print this minute" signal — so
    // we override the fill to fully transparent at the cell level.
    expect(cells.length).toBe(2);
    expect(cells[0].value).toEqual([0, 0, 60]);
    expect(cells[0].itemStyle).toBeUndefined(); // non-zero, no spike → no itemStyle
    expect(cells[1].value).toEqual([1, 0, 0]);
    expect(cells[1].itemStyle).toEqual({ color: "transparent" });
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
    // Spike border uses the textBright token (NOT accentRed) so it
    // remains visible on the heatmap's hottest cells, which are
    // themselves accentRed via the visualMap top stop (#206 R2 B1).
    expect(SPIKE_BORDER_COLOR).toBe(colors.textBright);
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

  it("attaches spike borders to BOTH cells when two strikes spike at the same minute (#206 R1 I5)", () => {
    // Two strikes both spiking at ts1 — assert both cells carry the
    // spike border with their respective rowIdx values. Regression
    // guard against any per-strike state leaking across the row loop.
    const t = tape({
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [minute(ts1, 700)],
          put_minutes: [],
          call_spike_minutes: [ts1],
          put_spike_minutes: [],
        }),
        strike({
          strike: 7505,
          call_minutes: [minute(ts1, 800)],
          put_minutes: [],
          call_spike_minutes: [ts1],
          put_spike_minutes: [],
        }),
      ],
    });
    const cells = buildHeatmapCells(t, [7505, 7500], [ts1]);
    expect(cells.length).toBe(2);
    // rowIdx=0 → 7505 (caller's first), rowIdx=1 → 7500 (caller's second)
    expect(cells[0].value).toEqual([0, 0, 800]);
    expect(cells[0].itemStyle?.borderColor).toBe(SPIKE_BORDER_COLOR);
    expect(cells[1].value).toEqual([0, 1, 700]);
    expect(cells[1].itemStyle?.borderColor).toBe(SPIKE_BORDER_COLOR);
  });

  it("attaches a spike border to a zero-volume cell when its timestamp is in the spike set (orphan-spike pinning, #206 R1 I6)", () => {
    // An orphan spike: the spike-detection threshold flagged ts2, but
    // there's no recorded minute on either side for ts2. With B2 (emit
    // zero cells), the cell now DOES exist — and its spike border must
    // still attach so the operator sees the flag.
    const t = tape({
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [minute(ts1, 200)],
          put_minutes: [],
          call_spike_minutes: [ts2], // ts2 has zero volume → orphan
          put_spike_minutes: [],
        }),
      ],
    });
    const cells = buildHeatmapCells(t, [7500], [ts1, ts2]);
    expect(cells.length).toBe(2);
    expect(cells[0].value).toEqual([0, 0, 200]);
    expect(cells[0].itemStyle).toBeUndefined();
    // ts2: zero volume, orphan spike → transparent fill (zero override)
    // AND spike border. Both layer onto the same itemStyle object —
    // the border still surfaces against the transparent (panel-color)
    // background, which is the desired contrast for an orphan spike.
    expect(cells[1].value).toEqual([1, 0, 0]);
    expect(cells[1].itemStyle).toEqual({
      color: "transparent",
      borderColor: SPIKE_BORDER_COLOR,
      borderWidth: SPIKE_BORDER_WIDTH,
    });
  });

  it("layers transparent fill onto every zero-volume cell, leaves non-zero cells untouched (#206 R2 round-2 N1+N2)", () => {
    // Mixed row: ts1=non-zero, ts2=zero, ts3=non-zero. Walk every
    // cell to assert the zero-override stays cell-local and doesn't
    // bleed into adjacent non-zero cells.
    const t = tape({
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [minute(ts1, 40), minute(ts3, 20)],
          put_minutes: [],
        }),
      ],
    });
    const cells = buildHeatmapCells(t, [7500], [ts1, ts2, ts3]);
    expect(cells.length).toBe(3);
    expect(cells[0].itemStyle).toBeUndefined();
    expect(cells[1].itemStyle).toEqual({ color: "transparent" });
    expect(cells[2].itemStyle).toBeUndefined();
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


describe("buildUnifiedMinuteAxis", () => {
  it("returns the union of strike-print minutes and spot_path minutes (#206 R2 B3)", () => {
    // Strike prints at :30, :31, :33; spot path at :30, :31, :32, :33.
    // Union: :30, :31, :32, :33 — :32 is spot-only, :33 is shared.
    const t = tape({
      spot_path: [
        { ts: "2026-05-15T15:30:00-04:00", price: 7424.30 },
        { ts: "2026-05-15T15:31:00-04:00", price: 7423.50 },
        { ts: "2026-05-15T15:32:00-04:00", price: 7422.20 },
        { ts: "2026-05-15T15:33:00-04:00", price: 7421.80 },
      ],
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [
            minute("2026-05-15T15:30:00-04:00", 60),
            minute("2026-05-15T15:31:00-04:00", 50),
            minute("2026-05-15T15:33:00-04:00", 40),
          ],
          put_minutes: [],
        }),
      ],
    });
    expect(buildUnifiedMinuteAxis(t)).toEqual([
      "2026-05-15T15:30:00-04:00",
      "2026-05-15T15:31:00-04:00",
      "2026-05-15T15:32:00-04:00",
      "2026-05-15T15:33:00-04:00",
    ]);
  });

  it("falls back to strike-only minutes when spot_path is null", () => {
    const t = tape({
      spot_path: null,
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [
            minute("2026-05-15T15:30:00-04:00", 60),
            minute("2026-05-15T15:31:00-04:00", 50),
          ],
          put_minutes: [],
        }),
      ],
    });
    expect(buildUnifiedMinuteAxis(t)).toEqual([
      "2026-05-15T15:30:00-04:00",
      "2026-05-15T15:31:00-04:00",
    ]);
  });

  it("includes spot-only minutes even when no strike printed (B3 silent-misalignment guard)", () => {
    // Strike printed only at :30. Spot path covers :30, :31, :32. The
    // unified axis must include :31 and :32 so the spot chart's later
    // points don't get collapsed onto the same x-position as :30 in
    // the heatmap (the original bug).
    const t = tape({
      spot_path: [
        { ts: "2026-05-15T15:30:00-04:00", price: 7424.30 },
        { ts: "2026-05-15T15:31:00-04:00", price: 7423.50 },
        { ts: "2026-05-15T15:32:00-04:00", price: 7422.20 },
      ],
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [minute("2026-05-15T15:30:00-04:00", 60)],
          put_minutes: [],
        }),
      ],
    });
    expect(buildUnifiedMinuteAxis(t)).toEqual([
      "2026-05-15T15:30:00-04:00",
      "2026-05-15T15:31:00-04:00",
      "2026-05-15T15:32:00-04:00",
    ]);
  });

  it("dedupes when a timestamp appears in both strike minutes and spot_path", () => {
    const ts = "2026-05-15T15:30:00-04:00";
    const t = tape({
      spot_path: [{ ts, price: 7424.30 }],
      strikes: [
        strike({
          strike: 7500,
          call_minutes: [minute(ts, 60)],
          put_minutes: [],
        }),
      ],
    });
    expect(buildUnifiedMinuteAxis(t)).toEqual([ts]);
  });
});


describe("buildXLabelMask", () => {
  it("marks wall-clock minutes divisible by 5 AND always marks the last index (#206 R3 R2 B1)", () => {
    const axis = [
      "2026-05-15T15:32:00-04:00", // :32, idx 0 → false
      "2026-05-15T15:33:00-04:00", // :33, idx 1 → false
      "2026-05-15T15:34:00-04:00", // :34, idx 2 → false
      "2026-05-15T15:35:00-04:00", // :35, idx 3 → true (stride)
      "2026-05-15T15:36:00-04:00", // :36, idx 4 → false
      "2026-05-15T15:40:00-04:00", // :40, idx 5 → true (last + stride)
    ];
    expect(buildXLabelMask(axis)).toEqual([false, false, false, true, false, true]);
  });

  it("anchors to wall-clock (not array index) so axis offset doesn't shift labels", () => {
    // Axis starts at :32 — an index-based mask would surface labels at
    // indices [0, 5, 10] which maps to :32 / :37 / :42 (wrong).
    // Wall-clock mask must surface :35, :40 instead. Last index (idx
    // 9, :41) is also force-true now.
    const axis = Array.from({ length: 10 }, (_, i) => {
      const minuteOfHour = 32 + i;
      const mm = String(minuteOfHour).padStart(2, "0");
      return `2026-05-15T15:${mm}:00-04:00`;
    });
    const mask = buildXLabelMask(axis);
    // True at indices 3 (:35), 8 (:40), and 9 (:41 — last-index force).
    expect(mask).toEqual([
      false, false, false, true, false, false, false, false, true, true,
    ]);
  });

  it("force-shows the rightmost label as the live-minute cue (#206 R3 R2 B1)", () => {
    // Axis where NO interior tick hits a 5-min stride — the last index
    // must STILL render so the operator can read the live minute. Drop
    // the last index from a stride-only axis to confirm the
    // pre-force-true mask was all-false, then add a non-stride last
    // tick and watch the last index flip to true.
    const axis = [
      "2026-05-15T15:31:00-04:00", // :31 → false
      "2026-05-15T15:32:00-04:00", // :32 → false
      "2026-05-15T15:33:00-04:00", // :33 → true (LAST)
    ];
    expect(buildXLabelMask(axis)).toEqual([false, false, true]);
  });

  it("single-element axis: the only index is the last index → true", () => {
    const axis = ["2026-05-15T15:33:00-04:00"];
    expect(buildXLabelMask(axis)).toEqual([true]);
  });

  it("returns an empty array for an empty axis", () => {
    expect(buildXLabelMask([])).toEqual([]);
  });

  it("falls back to true (label visible) when the timestamp can't be parsed", () => {
    // formatMinuteLabel returns the raw string on parse failure, which
    // won't match `/:(\d{2})$/`. Surface ALL labels so operators still
    // see SOMETHING rather than a silent axis.
    const axis = ["not-a-timestamp", "also-not-a-timestamp"];
    expect(buildXLabelMask(axis)).toEqual([true, true]);
  });

  it("handles hour wraparound: :55 → false, :00 → true, last is :01 force-true", () => {
    // Pin behavior across an hour boundary so a future refactor can't
    // silently break the modulo logic at the 60-minute wrap.
    const axis = [
      "2026-05-15T15:55:00-04:00", // :55 → true (stride: 55 mod 5 === 0)
      "2026-05-15T15:56:00-04:00", // :56 → false
      "2026-05-15T15:57:00-04:00", // :57 → false
      "2026-05-15T15:58:00-04:00", // :58 → false
      "2026-05-15T15:59:00-04:00", // :59 → false
      "2026-05-15T16:00:00-04:00", // :00 → true (stride)
      "2026-05-15T16:01:00-04:00", // :01 → true (LAST force)
    ];
    expect(buildXLabelMask(axis)).toEqual([
      true, false, false, false, false, true, true,
    ]);
  });
});


describe("buildSpotPathSeries", () => {
  const ts1 = "2026-05-15T15:30:00-04:00";
  const ts2 = "2026-05-15T15:31:00-04:00";
  const ts3 = "2026-05-15T15:32:00-04:00";

  it("returns prices aligned to the axis with null for missing minutes (#206 R2 B3)", () => {
    const t = tape({
      spot_path: [
        { ts: ts1, price: 7424.30 },
        { ts: ts3, price: 7422.20 },
      ],
    });
    // ts2 is in the axis but absent from spot_path → null at that index.
    expect(buildSpotPathSeries(t, [ts1, ts2, ts3])).toEqual([7424.30, null, 7422.20]);
  });

  it("returns null when spot_path is null", () => {
    expect(buildSpotPathSeries(tape({ spot_path: null }), [ts1, ts2])).toBeNull();
  });

  it("returns null when spot_path has zero entries", () => {
    expect(buildSpotPathSeries(tape({ spot_path: [] }), [ts1, ts2])).toBeNull();
  });

  it("returns null when the axis has fewer than 2 non-null aligned points", () => {
    // spot_path has one point that lines up with the axis — not enough
    // to form a line.
    const t = tape({ spot_path: [{ ts: ts1, price: 7424.30 }] });
    expect(buildSpotPathSeries(t, [ts1, ts2])).toBeNull();
  });

  it("emits the price for every shared axis minute when fully covered", () => {
    const t = tape({
      spot_path: [
        { ts: ts1, price: 7424.30 },
        { ts: ts2, price: 7423.50 },
      ],
    });
    expect(buildSpotPathSeries(t, [ts1, ts2])).toEqual([7424.30, 7423.50]);
  });
});


describe("heatmap grid constants", () => {
  // The RightTotalsColumn wrapper anchors `top`/`bottom` to these same
  // numbers so the labels sit at the heatmap row centers. If either
  // constant changes, the wrapper must change in lockstep (#206 R1 I2).
  it("exposes HEATMAP_GRID_TOP and HEATMAP_GRID_BOTTOM as numbers", () => {
    expect(typeof HEATMAP_GRID_TOP).toBe("number");
    expect(typeof HEATMAP_GRID_BOTTOM).toBe("number");
    expect(HEATMAP_GRID_TOP).toBeGreaterThan(0);
    expect(HEATMAP_GRID_BOTTOM).toBeGreaterThan(HEATMAP_GRID_TOP);
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
