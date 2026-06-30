import { describe, expect, it } from "vitest";
import type { MarkupReviewAlert } from "../../api/terminalTypes";
import {
  CONVICTION_COLORS,
  DEFAULT_FILTERS,
  askScore,
  askSize,
  breadthScore,
  buildMarkers,
  conviction,
  etDateString,
  filterAlerts,
  fromInputDate,
  indexByBarTime,
  isoToUtc,
  median,
  minSinceOpenET,
  passesFilters,
  shiftSessionDate,
  subsetStats,
  toInputDate,
  todScore,
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

describe("shiftSessionDate", () => {
  // 2026-06-18 is a Thursday; 19 Fri, 20 Sat, 21 Sun, 22 Mon.
  const MAX = "20260630";

  it("steps back/forward one weekday", () => {
    expect(shiftSessionDate("20260618", -1, MAX)).toBe("20260617");
    expect(shiftSessionDate("20260618", 1, MAX)).toBe("20260619");
  });

  it("skips weekends", () => {
    expect(shiftSessionDate("20260622", -1, MAX)).toBe("20260619"); // Mon → Fri
    expect(shiftSessionDate("20260619", 1, MAX)).toBe("20260622"); // Fri → Mon
  });

  it("does not step past today on a forward move (no-op)", () => {
    expect(shiftSessionDate("20260618", 1, "20260618")).toBe("20260618");
  });

  it("can always step backward past the max", () => {
    expect(shiftSessionDate("20260618", -1, "20260618")).toBe("20260617");
  });

  it("crosses month/year boundaries", () => {
    expect(shiftSessionDate("20260101", -1, MAX)).toBe("20251231"); // Thu → Wed
  });
});

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
  it("styles by causal conviction (not outcome): strong open cluster → bright arrow", () => {
    // 4 strikes (breadth 1.0) + sweet-spot ask 2.5 (1.0) + open bar (1.0) = 3.0 → STRONG
    const m = buildMarkers([
      mk({ ask_jump: 2.5, dist_from_atm: 0 }),
      mk({ ask_jump: 2.5, dist_from_atm: 5 }),
      mk({ ask_jump: 2.5, dist_from_atm: -5 }),
      mk({ ask_jump: 2.5, dist_from_atm: 10 }),
    ])[0];
    expect(m.shape).toBe("arrowUp");
    expect(m.color).toBe(CONVICTION_COLORS.up.strong);
    expect(m.size).toBe(3); // askSize(2.5)
    expect(m.text).toBe("×4");
  });
  it("lone big-ask spike → CAUTION circle, never a hot arrow", () => {
    const m = buildMarkers([mk({ ask_jump: 3.5, dist_from_atm: 5 })])[0];
    expect(m.shape).toBe("circle");
    expect(m.color).toBe(CONVICTION_COLORS.up.caution);
  });
  it("styling is outcome-independent (pending vs finalized identical)", () => {
    const base = { ask_jump: 2.5, dist_from_atm: 5 as number };
    const fin = buildMarkers([mk({ ...base, status: "finalized", mfe: 30 })])[0];
    const pend = buildMarkers([mk({ ...base, status: "pending", mfe: null })])[0];
    expect([pend.color, pend.size, pend.shape]).toEqual([fin.color, fin.size, fin.shape]);
  });
  it("markers are sorted ascending by time", () => {
    const later = mk({ bar_time: "2026-06-16T14:00:00Z" });
    const earlier = mk({ bar_time: "2026-06-16T13:00:00Z" });
    const m = buildMarkers([later, earlier]);
    expect((m[0].time as number) < (m[1].time as number)).toBe(true);
  });
});

describe("conviction scoring (causal)", () => {
  it("breadthScore — monotonic in ladder breadth", () => {
    expect(breadthScore(1)).toBe(0);
    expect(breadthScore(3)).toBe(0.3);
    expect(breadthScore(4)).toBe(1.0);
  });
  it("askScore — inverted-U, sweet spot 2.2–3.0", () => {
    expect(askScore(1.5)).toBe(0);
    expect(askScore(2.0)).toBe(0.4);
    expect(askScore(2.5)).toBe(1.0);
    expect(askScore(3.5)).toBe(0.6);
  });
  it("todScore — open best, midday dead", () => {
    expect(todScore(10)).toBe(1.0); // open
    expect(todScore(60)).toBe(0); // morning
    expect(todScore(180)).toBe(-0.5); // midday
    expect(todScore(300)).toBe(0.5); // afternoon
    expect(todScore(380)).toBe(0); // power+curb
  });
  it("askSize — monotonic in ask magnitude", () => {
    expect(askSize(1.5)).toBe(1);
    expect(askSize(2.0)).toBe(2);
    expect(askSize(2.5)).toBe(3);
    expect(askSize(3.5)).toBe(4);
  });
  it("tiers: strong / moderate / weak by score", () => {
    const t = (o: Parameters<typeof conviction>[0]) => conviction(o).tier;
    expect(t({ clusterSize: 4, maxAskJump: 2.5, minSinceOpen: 10, atmOnly: false })).toBe("strong"); // 3.0
    expect(t({ clusterSize: 1, maxAskJump: 1.4, minSinceOpen: 10, atmOnly: false })).toBe("moderate"); // 1.0
    expect(t({ clusterSize: 1, maxAskJump: 1.4, minSinceOpen: 60, atmOnly: false })).toBe("weak"); // 0.0
  });
  it("midday never reads STRONG", () => {
    expect(conviction({ clusterSize: 4, maxAskJump: 2.5, minSinceOpen: 180, atmOnly: false }).tier).toBe("moderate");
  });
  it("trap overrides → CAUTION (lone big-ask, ATM-only)", () => {
    expect(conviction({ clusterSize: 1, maxAskJump: 3.5, minSinceOpen: 10, atmOnly: false }).tier).toBe("caution");
    expect(conviction({ clusterSize: 4, maxAskJump: 2.5, minSinceOpen: 10, atmOnly: true }).tier).toBe("caution");
  });
});

describe("minSinceOpenET", () => {
  it("ET minutes since 09:30 (DST-correct)", () => {
    expect(minSinceOpenET("2026-06-16T13:36:00Z")).toBe(6); // 09:36 EDT
    expect(minSinceOpenET("2026-06-16T19:30:00Z")).toBe(360); // 15:30 EDT
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
