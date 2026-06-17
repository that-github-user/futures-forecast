import { describe, expect, it } from "vitest";
import type { MarkupReviewAlert } from "../../api/terminalTypes";
import {
  DEFAULT_FILTERS,
  buildMarkers,
  etDateString,
  filterAlerts,
  fromInputDate,
  indexByBarTime,
  isoToUtc,
  median,
  mfeSize,
  passesFilters,
  subsetStats,
  toInputDate,
} from "./markupReviewHelpers";

function mk(o: Partial<MarkupReviewAlert> = {}): MarkupReviewAlert {
  return {
    alert_ts: "2026-06-16T09:36:46.5-04:00",
    bar_time: "2026-06-16T13:36:00Z",
    side: "call",
    direction: "up",
    status: "finalized",
    strike: 7510,
    dist_from_atm: 5,
    spread_z: 20,
    ask_jump: 1.4,
    spot_at_alert: 7508,
    realized_move: 2,
    mfe: 8,
    t_mfe_s: 120,
    mae: -2,
    t_mae_s: 30,
    ...o,
  };
}

// ── filters ────────────────────────────────────────────────────────────

describe("passesFilters", () => {
  it("direction filter", () => {
    expect(passesFilters(mk({ direction: "up" }), { ...DEFAULT_FILTERS, direction: "down" })).toBe(false);
    expect(passesFilters(mk({ direction: "down", side: "put" }), { ...DEFAULT_FILTERS, direction: "down" })).toBe(true);
  });
  it("σ floor", () => {
    expect(passesFilters(mk({ spread_z: 8 }), { ...DEFAULT_FILTERS, minZ: 10 })).toBe(false);
    expect(passesFilters(mk({ spread_z: 12 }), { ...DEFAULT_FILTERS, minZ: 10 })).toBe(true);
  });
  it("ATM-distance ceiling (abs)", () => {
    expect(passesFilters(mk({ dist_from_atm: -10 }), { ...DEFAULT_FILTERS, maxDist: 5 })).toBe(false);
    expect(passesFilters(mk({ dist_from_atm: 5 }), { ...DEFAULT_FILTERS, maxDist: 5 })).toBe(true);
    expect(passesFilters(mk({ dist_from_atm: 0 }), { ...DEFAULT_FILTERS, maxDist: 0 })).toBe(true);
  });
  it("excludes pending/lost by default, includes when opted in", () => {
    const pend = mk({ status: "pending", mfe: null });
    expect(passesFilters(pend, DEFAULT_FILTERS)).toBe(false);
    expect(passesFilters(pend, { ...DEFAULT_FILTERS, includePending: true })).toBe(true);
  });
  it("filterAlerts applies all together", () => {
    const alerts = [mk({ direction: "up", spread_z: 30 }), mk({ direction: "down", side: "put", spread_z: 5 })];
    expect(filterAlerts(alerts, { ...DEFAULT_FILTERS, direction: "up", minZ: 10 })).toHaveLength(1);
  });
});

// ── markers ────────────────────────────────────────────────────────────

describe("buildMarkers", () => {
  it("clusters same-direction same-bar alerts into one ×N marker", () => {
    const m = buildMarkers([mk(), mk()]);
    expect(m).toHaveLength(1);
    expect(m[0].text).toBe("×2");
    expect(m[0].shape).toBe("arrowUp");
    expect(m[0].position).toBe("belowBar");
  });
  it("opposite directions on the same bar → two markers", () => {
    const m = buildMarkers([mk({ direction: "up" }), mk({ direction: "down", side: "put" })]);
    expect(m).toHaveLength(2);
    expect(m.map((x) => x.shape).sort()).toEqual(["arrowDown", "arrowUp"]);
  });
  it("MFE encodes marker size; all-pending cluster renders dim + size 1", () => {
    expect(buildMarkers([mk({ mfe: 12 })])[0].size).toBe(4);
    const dim = buildMarkers([mk({ status: "pending", mfe: null })])[0];
    expect(dim.size).toBe(1);
    expect(dim.color).toBe("#2b6b3f"); // upDim
  });
  it("markers are sorted ascending by time", () => {
    const later = mk({ bar_time: "2026-06-16T14:00:00Z" });
    const earlier = mk({ bar_time: "2026-06-16T13:00:00Z" });
    const m = buildMarkers([later, earlier]);
    expect((m[0].time as number) < (m[1].time as number)).toBe(true);
  });
});

describe("mfeSize", () => {
  it("buckets", () => {
    expect(mfeSize(12)).toBe(4);
    expect(mfeSize(7)).toBe(3);
    expect(mfeSize(3)).toBe(2);
    expect(mfeSize(1)).toBe(1);
    expect(mfeSize(null)).toBe(1);
  });
});

describe("indexByBarTime", () => {
  it("groups alerts by floored bar epoch", () => {
    const idx = indexByBarTime([mk(), mk({ direction: "down", side: "put" })]);
    const t = isoToUtc("2026-06-16T13:36:00Z") as number;
    expect(idx.get(t)).toHaveLength(2);
  });
});

// ── stats ────────────────────────────────────────────────────────────

describe("subsetStats", () => {
  it("rates over finalized; dirHit over realized moves", () => {
    const alerts = [
      mk({ mfe: 12, realized_move: 5 }),
      mk({ mfe: 6, realized_move: 5 }),
      mk({ mfe: 3, realized_move: -2 }),
      mk({ status: "pending", mfe: null, realized_move: null }),
    ];
    const s = subsetStats(alerts);
    expect(s.n).toBe(4);
    expect(s.finalized).toBe(3);
    expect(s.mfeGe5).toBeCloseTo(2 / 3, 5);
    expect(s.mfeGe10).toBeCloseTo(1 / 3, 5);
    expect(s.medianMfe).toBe(6);
    expect(s.dirHit).toBeCloseTo(2 / 3, 5);
  });
  it("empty → nulls, not NaN", () => {
    const s = subsetStats([]);
    expect(s.medianMfe).toBeNull();
    expect(s.mfeGe5).toBeNull();
    expect(s.dirHit).toBeNull();
  });
});

describe("median", () => {
  it("odd / even / empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

// ── date helpers ───────────────────────────────────────────────────────

describe("date helpers", () => {
  it("etDateString returns 8-digit yyyymmdd", () => {
    expect(etDateString(new Date("2026-06-16T20:00:00Z"))).toMatch(/^\d{8}$/);
  });
  it("etDateString uses ET wall date (pre-ET-midnight UTC instant)", () => {
    // 2026-06-17T02:00:00Z = 2026-06-16 22:00 ET → still the 16th in ET
    expect(etDateString(new Date("2026-06-17T02:00:00Z"))).toBe("20260616");
  });
  it("toInputDate / fromInputDate round-trip", () => {
    expect(toInputDate("20260616")).toBe("2026-06-16");
    expect(fromInputDate("2026-06-16")).toBe("20260616");
  });
});
