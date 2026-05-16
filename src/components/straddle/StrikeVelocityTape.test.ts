/**
 * Tests for the StrikeVelocityTape helpers.
 *
 * The React component is a thin shell over the data shapers in
 * `strikeVelocityHelpers.ts` — we pin those directly since the project
 * has no @testing-library/react setup (same pattern as
 * `StraddleMapChart.test.ts`). The visual layer's correctness is
 * already implicit in the per-axis densification + spike-flag math
 * being honest; SVG render is pure data → DOM.
 *
 * Coverage:
 *   - sumVolume / rowTotalVolume math
 *   - formatVolume tiers (raw / k-suffix / zero)
 *   - buildMinuteAxis union semantics (per-side missing minutes)
 *   - densify preserves axis alignment with null for absent minutes
 *   - resolveStrikeOrder honors strikeOrder from chart, filters
 *     missing strikes, falls back to descending tape order
 */

import { describe, expect, it } from "vitest";
import type { VelocityStrike, VelocityTape } from "../../api/terminalTypes";
import {
  buildMinuteAxis,
  densify,
  formatVolume,
  resolveStrikeOrder,
  rowTotalVolume,
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


describe("densify", () => {
  it("aligns minute volumes to the axis with null for absent slots", () => {
    const axis = [
      "2026-05-15T15:30:00-04:00",
      "2026-05-15T15:31:00-04:00",
      "2026-05-15T15:32:00-04:00",
    ];
    const minutes = [
      minute("2026-05-15T15:30:00-04:00", 60),
      // missing 15:31
      minute("2026-05-15T15:32:00-04:00", 80),
    ];
    expect(densify(minutes, axis)).toEqual([60, null, 80]);
  });

  it("returns all-null when no minutes overlap the axis", () => {
    const axis = [
      "2026-05-15T15:30:00-04:00",
      "2026-05-15T15:31:00-04:00",
    ];
    const minutes = [minute("2026-05-15T16:00:00-04:00", 99)];
    expect(densify(minutes, axis)).toEqual([null, null]);
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
  });
});
