import { describe, expect, it } from "vitest";
import type { MarkupReviewAlert } from "../../api/terminalTypes";
import { floorEpochSec } from "../../lib/tfBuckets";
import {
  CONVICTION_COLORS,
  DEFAULT_FILTERS,
  MUTED_ALPHA,
  alertEventSec,
  askScore,
  askSize,
  breadthScore,
  buildMarkers,
  clusterAlerts,
  conviction,
  etDateString,
  filterAlerts,
  fromInputDate,
  indexByBarTime,
  isMuted,
  isoToUtc,
  median,
  minSinceOpenET,
  passesFilters,
  sessionBucket,
  shiftSessionDate,
  subsetStats,
  toInputDate,
  todScore,
} from "./markupReviewHelpers";

/** `bar_time` DEFAULTS to the server's 1m derivation from `alert_ts`
 *  (`epoch - epoch % 60`) so the common fixture is a pair the API really sends.
 *  It stays overridable because the server floors it to whatever `tf` was
 *  requested and the live path floors it to the minute regardless: the two
 *  spellings are both on the wire, and a fixture that could not express them
 *  could not pin the property that matters — that NOTHING downstream reads the
 *  field. Placement is the display grid's job, so a test that wants a marker
 *  somewhere else moves `alert_ts`. */
function mk(o: Partial<MarkupReviewAlert> = {}): MarkupReviewAlert {
  const alert_ts = o.alert_ts ?? "2026-06-16T09:36:46.5-04:00";
  const barMs = Math.floor(Date.parse(alert_ts) / 60_000) * 60_000;
  return {
    alert_ts,
    // An unparseable instant has no floor to derive; echo it so the malformed
    // case stays expressible rather than throwing inside the fixture.
    bar_time: Number.isFinite(barMs) ? new Date(barMs).toISOString() : alert_ts,
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

/** ET instant → epoch seconds (EDT session dates only in this file). */
const et = (hms: string): number => Date.parse(`2026-06-16T${hms}-04:00`) / 1000;

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
    // 4 strikes (breadth 1.0) + ask floor 2.5 (0.3) + open bar (1.0) = 2.3 → STRONG
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
  it("muted-bucket arrows are alpha-dimmed (spec §4 dashed channel → opacity)", () => {
    // 13:00 ET = 210 min since open → midday (muted)
    const m = buildMarkers([mk({ alert_ts: "2026-06-16T13:00:00-04:00" })])[0];
    expect(m.color).toBe(`${CONVICTION_COLORS.up.weak}${MUTED_ALPHA}`);
  });
  it("CAUTION stays solid grey even in a muted bucket (trap style stays distinct)", () => {
    const m = buildMarkers([
      mk({ alert_ts: "2026-06-16T13:00:00-04:00", ask_jump: 3.5 }),
    ])[0];
    expect(m.color).toBe(CONVICTION_COLORS.up.caution);
  });
  it("styling is outcome-independent (pending vs finalized identical)", () => {
    const base = { ask_jump: 2.5, dist_from_atm: 5 as number };
    const fin = buildMarkers([mk({ ...base, status: "finalized", mfe: 30 })])[0];
    const pend = buildMarkers([mk({ ...base, status: "pending", mfe: null })])[0];
    expect([pend.color, pend.size, pend.shape]).toEqual([fin.color, fin.size, fin.shape]);
  });
  it("breadth counts every fired strike regardless of status (causal)", () => {
    // 4 strikes fired in the bar, one pending + one lost — breadth must be 4
    // (→ STRONG), never demoted by the post-fire status of a strike.
    const m = buildMarkers([
      mk({ ask_jump: 2.5, dist_from_atm: 0, status: "finalized" }),
      mk({ ask_jump: 2.5, dist_from_atm: 5, status: "finalized" }),
      mk({ ask_jump: 2.5, dist_from_atm: -5, status: "pending", mfe: null }),
      mk({ ask_jump: 2.5, dist_from_atm: 10, status: "lost", mfe: null }),
    ])[0];
    expect(m.text).toBe("×4");
    expect(m.color).toBe(CONVICTION_COLORS.up.strong);
  });
  it("markers are sorted ascending by time", () => {
    const later = mk({ alert_ts: "2026-06-16T10:00:00-04:00" });
    const earlier = mk({ alert_ts: "2026-06-16T09:45:00-04:00" });
    const m = buildMarkers([later, earlier]);
    expect((m[0].time as number) < (m[1].time as number)).toBe(true);
  });
});

// ── grouping vs placement (the 5m correctness fix) ─────────────────────

describe("grouping is the spec's 1-minute grain, placement is the display grid", () => {
  // Two same-direction events inside ONE 5-minute bucket (09:35–09:40 ET).
  const trap = () =>
    mk({ alert_ts: "2026-06-16T09:36:10-04:00", ask_jump: 3.5, dist_from_atm: 5 });
  const breadth4 = () => [
    mk({ alert_ts: "2026-06-16T09:38:20-04:00", ask_jump: 2.5, dist_from_atm: 0 }),
    mk({ alert_ts: "2026-06-16T09:38:20-04:00", ask_jump: 2.5, dist_from_atm: 5 }),
    mk({ alert_ts: "2026-06-16T09:38:20-04:00", ask_jump: 2.5, dist_from_atm: -5 }),
    mk({ alert_ts: "2026-06-16T09:38:20-04:00", ask_jump: 2.5, dist_from_atm: 10 }),
  ];

  it("alertEventSec floors alert_ts to the minute", () => {
    expect(alertEventSec(trap())).toBe(et("09:36:00"));
  });

  it("clusters are identical at any timeframe — only the marker time moves", () => {
    // Opposite directions, so both survive the 5m bar and every styling channel
    // is comparable side by side.
    const alerts = [
      mk({ alert_ts: "2026-06-16T09:36:10-04:00", ask_jump: 2.5, dist_from_atm: 5 }),
      mk({ alert_ts: "2026-06-16T09:36:10-04:00", ask_jump: 2.5, dist_from_atm: 10 }),
      mk({ alert_ts: "2026-06-16T09:38:40-04:00", direction: "down", side: "put", ask_jump: 2.0, dist_from_atm: -5 }),
      mk({ alert_ts: "2026-06-16T09:38:40-04:00", direction: "down", side: "put", ask_jump: 2.0, dist_from_atm: -10 }),
      mk({ alert_ts: "2026-06-16T09:38:40-04:00", direction: "down", side: "put", ask_jump: 2.0, dist_from_atm: 0 }),
    ];
    const style = (m: { color: string; shape: string; size: number; text: string }) => ({
      color: m.color, shape: m.shape, size: m.size, text: m.text,
    });
    const at1 = buildMarkers(alerts, "1m");
    const at5 = buildMarkers(alerts, "5m");
    expect(at1.map(style)).toEqual(at5.map(style));
    expect(at1.map((m) => m.text)).toEqual(["×2", "×3"]);
    expect(at1.map((m) => m.time as number)).toEqual([et("09:36:00"), et("09:38:00")]);
    expect(at5.map((m) => m.time as number)).toEqual([et("09:35:00"), et("09:35:00")]);
  });

  it("THE TRAP MUST SURVIVE: a lone-spike CAUTION still reads CAUTION at 5m", () => {
    // The lone big-ask spike (clusterSize 1, ask ≥ 3.0) is the worst-performing
    // bucket measured. Grouping on the server's 5m `bar_time`
    // merged it with the breadth-4 event two minutes later, so the trap
    // dissolved into a STRONG arrow — one of 24 CAUTION markers the 5m view used
    // to hide. Every transition a coarser grid produces flatters, so the trap
    // outranks anything it collides with.
    const alerts = [trap(), ...breadth4()];

    const at1 = buildMarkers(alerts, "1m");
    expect(at1).toHaveLength(2);
    expect(at1[0]).toMatchObject({
      time: et("09:36:00"),
      shape: "circle",
      color: CONVICTION_COLORS.up.caution,
      text: "",
    });
    expect(at1[1]).toMatchObject({ time: et("09:38:00"), color: CONVICTION_COLORS.up.strong });

    const at5 = buildMarkers(alerts, "5m");
    expect(at5).toHaveLength(1);
    expect(at5[0]).toMatchObject({
      time: et("09:35:00"),
      shape: "circle",
      color: CONVICTION_COLORS.up.caution,
      size: 4, // askSize(3.5) — the trap's own magnitude, not the cluster's
      text: "", // ×1: its OWN breadth, never 5
    });
  });

  it("a display-grid collision keeps the highest-conviction cluster and ITS OWN ×N", () => {
    const two = [
      mk({ alert_ts: "2026-06-16T09:36:10-04:00", dist_from_atm: 5 }),
      mk({ alert_ts: "2026-06-16T09:36:10-04:00", dist_from_atm: 10 }),
    ];
    const four = breadth4();
    const at5 = buildMarkers([...two, ...four], "5m");
    expect(at5).toHaveLength(1);
    expect(at5[0].color).toBe(CONVICTION_COLORS.up.strong);
    expect(at5[0].text).toBe("×4"); // the winner's breadth — NOT ×6
    // Both clusters still exist and keep their own breadth at the spec grain.
    expect(buildMarkers([...two, ...four], "1m").map((m) => m.text)).toEqual([
      "×2",
      "×4",
    ]);
  });

  it("THE TRAP MUST SURVIVE the payload the server serves at tf=5m", () => {
    // The same shape, but carrying the server's OWN 5-minute `bar_time` on every
    // alert — the payload that used to collapse all five into one ×5 STRONG
    // arrow. Grouping reads `alert_ts` and nothing else, so the field's flooring
    // cannot reach the marker.
    const floored = "2026-06-16T13:35:00Z";
    const at5 = buildMarkers(
      [trap(), ...breadth4()].map((a) => ({ ...a, bar_time: floored })),
      "5m",
    );
    expect(at5).toHaveLength(1);
    expect(at5[0]).toMatchObject({
      time: et("09:35:00"),
      shape: "circle",
      color: CONVICTION_COLORS.up.caution,
      text: "",
    });
  });

  it("collision precedence below CAUTION: score, then breadth, then ask", () => {
    // Two 1-minute events in one 5-minute bucket, same direction. The scored
    // channels are read off the WINNER, so each leg is observable: ×N is the
    // winner's own breadth and the arrow size is its own ask magnitude.
    const evt = (
      hms: string,
      n: number,
      ask: number,
    ): MarkupReviewAlert[] =>
      Array.from({ length: n }, (_, i) =>
        mk({
          alert_ts: `2026-06-16T${hms}-04:00`,
          ask_jump: ask,
          dist_from_atm: 5 * (i + 1),
        }),
      );

    // Equal score (breadth 2 and 3 both score 0.3; ask both ≥ 1.8) → breadth.
    const byBreadth = buildMarkers(
      [...evt("09:36:10", 2, 1.9), ...evt("09:38:20", 3, 1.9)],
      "5m",
    );
    expect(byBreadth).toHaveLength(1);
    expect(byBreadth[0].text).toBe("×3");

    // Equal score AND equal breadth → ask magnitude, read through arrow size.
    const byAsk = buildMarkers(
      [...evt("09:36:10", 2, 2.5), ...evt("09:38:20", 2, 1.9)],
      "5m",
    );
    expect(byAsk).toHaveLength(1);
    expect(byAsk[0].size).toBe(askSize(2.5));

    // Higher score outranks a bigger ask.
    const byScore = buildMarkers(
      [...evt("09:36:10", 4, 1.9), ...evt("09:38:20", 2, 2.5)],
      "5m",
    );
    expect(byScore).toHaveLength(1);
    expect(byScore[0].text).toBe("×4");
  });

  it("a live strike and its fetched twin cluster together despite different bar_time flooring", () => {
    // The live path floors bar_time to the minute; a 5m fetch floors it to five.
    // Grouping off alert_ts is what stops the same event drawing twice at half
    // the breadth.
    const fetched = mk({ alert_ts: "2026-06-16T09:36:10-04:00", dist_from_atm: 5 });
    const liveTwin = {
      ...mk({ alert_ts: "2026-06-16T09:36:40-04:00", dist_from_atm: 10 }),
      bar_time: "2026-06-16T13:35:00.000Z", // as a 5m server floor would stamp it
    };
    const m = buildMarkers([fetched, liveTwin], "5m");
    expect(m).toHaveLength(1);
    expect(m[0].text).toBe("×2");
  });

  it("drops an unparseable alert_ts instead of merging every one into a fake event", () => {
    // A NaN event key collapses every such alert into ONE cluster whose count
    // becomes its cluster_size — a fabricated breadth feeding the conviction
    // score and the lone-spike trap test — and places a marker at an unplottable
    // time. Grouping only started depending on this parse with the split from
    // `bar_time`, so the blast radius grew from one tooltip line to the chart.
    const bad = [
      mk({ alert_ts: "not-a-date" }),
      mk({ alert_ts: "not-a-date" }),
      mk({ alert_ts: "not-a-date" }),
    ];
    expect(clusterAlerts(bad)).toEqual([]);
    expect(buildMarkers(bad, "5m")).toEqual([]);
    expect(indexByBarTime(bad, "5m").size).toBe(0);
    // A good alert alongside them keeps its own breadth of one.
    const mixed = buildMarkers([...bad, mk()], "1m");
    expect(mixed).toHaveLength(1);
    expect(mixed[0].text).toBe("");
  });

  it("clusterAlerts orders by event minute then direction", () => {
    const cs = clusterAlerts([
      mk({ alert_ts: "2026-06-16T09:38:00-04:00" }),
      mk({ alert_ts: "2026-06-16T09:36:00-04:00", direction: "down", side: "put" }),
      mk({ alert_ts: "2026-06-16T09:36:00-04:00" }),
    ]);
    expect(cs.map((c) => [c.eventSec, c.direction])).toEqual([
      [et("09:36:00"), "down"],
      [et("09:36:00"), "up"],
      [et("09:38:00"), "up"],
    ]);
  });
});

describe("5-minute flooring cannot re-score time-of-day (§4.2 proof, pinned)", () => {
  // The display grid is UTC-modulo while todScore is anchored to the 09:30 ET
  // open. They coincide only because ET's UTC offset is a whole number of hours
  // and 86400 % 300 === 0. If a future tod edge lands on a non-5-aligned minute,
  // or a venue runs a half-hour offset, this fails instead of silently
  // re-bucketing 8.7% of alerts.
  const opens = [
    ["EDT", Date.parse("2026-06-16T09:30:00-04:00") / 1000],
    ["EST", Date.parse("2026-01-15T09:30:00-05:00") / 1000],
  ] as const;

  it("09:30 ET and every bucket edge sit ON the 5-minute grid", () => {
    for (const [, open] of opens) {
      expect(open % 300).toBe(0);
      for (const edge of [0, 30, 120, 240, 360]) {
        expect((open + edge * 60) % 300).toBe(0);
      }
    }
  });

  it("no minute of the session changes session bucket under the 5m floor", () => {
    for (const [, open] of opens) {
      for (let m = 0; m <= 390; m++) {
        const sec = open + m * 60;
        const floored = floorEpochSec(sec, "5m");
        const raw = sessionBucket(minSinceOpenET(new Date(sec * 1000).toISOString()));
        const flat = sessionBucket(
          minSinceOpenET(new Date(floored * 1000).toISOString()),
        );
        expect(flat).toBe(raw);
      }
    }
  });
});

describe("conviction scoring (causal)", () => {
  it("breadthScore — monotonic in ladder breadth", () => {
    expect(breadthScore(1)).toBe(0);
    expect(breadthScore(3)).toBe(0.3);
    expect(breadthScore(4)).toBe(1.0);
  });
  it("askScore — coarse floor at ≥1.8, no sweet spot (§8: 8-session peak void)", () => {
    expect(askScore(1.5)).toBe(0);
    expect(askScore(1.8)).toBe(0.3);
    expect(askScore(2.5)).toBe(0.3);
    expect(askScore(3.5)).toBe(0.3);
  });
  it("todScore — open best; midday and power+curb dead; afternoon neutral", () => {
    expect(todScore(10)).toBe(1.0); // open
    expect(todScore(60)).toBe(0); // morning
    expect(todScore(180)).toBe(-0.5); // midday
    expect(todScore(300)).toBe(0); // afternoon (neutralized 2026-07-10)
    expect(todScore(380)).toBe(-0.5); // power+curb (demoted 2026-07-10)
    expect(todScore(-5)).toBe(0); // pre-open guarded (not the open bucket)
  });
  it("todScore — exact bucket edges", () => {
    expect(todScore(0)).toBe(1.0); // open starts at 0
    expect(todScore(30)).toBe(0); // morning starts at 30
    expect(todScore(120)).toBe(-0.5); // midday starts at 120
    expect(todScore(240)).toBe(0); // afternoon starts at 240
    expect(todScore(360)).toBe(-0.5); // power+curb starts at 360
  });
  it("isMuted — midday and power+curb only, edges exact", () => {
    expect(isMuted(-5)).toBe(false);
    expect(isMuted(10)).toBe(false);
    expect(isMuted(119)).toBe(false);
    expect(isMuted(120)).toBe(true); // midday start
    expect(isMuted(239)).toBe(true);
    expect(isMuted(240)).toBe(false); // afternoon is neutral, not muted
    expect(isMuted(359)).toBe(false);
    expect(isMuted(360)).toBe(true); // power+curb start (added 2026-07-10)
  });
  it("askSize — monotonic in ask magnitude", () => {
    expect(askSize(1.5)).toBe(1);
    expect(askSize(2.0)).toBe(2);
    expect(askSize(2.5)).toBe(3);
    expect(askSize(3.5)).toBe(4);
  });
  it("tiers: strong / moderate / weak by score", () => {
    const t = (o: Parameters<typeof conviction>[0]) => conviction(o).tier;
    expect(t({ clusterSize: 4, maxAskJump: 2.5, minSinceOpen: 10, atmOnly: false })).toBe("strong"); // 2.3
    expect(t({ clusterSize: 4, maxAskJump: 1.4, minSinceOpen: 10, atmOnly: false })).toBe("strong"); // 2.0 — breadth + open alone
    expect(t({ clusterSize: 1, maxAskJump: 1.4, minSinceOpen: 10, atmOnly: false })).toBe("moderate"); // 1.0
    expect(t({ clusterSize: 1, maxAskJump: 1.4, minSinceOpen: 60, atmOnly: false })).toBe("weak"); // 0.0
  });
  it("afternoon breadth cluster no longer reads STRONG (neutralized)", () => {
    // 1.0 + 0.3 + 0.0 = 1.3 → moderate (was 1.0 + 1.0 + 0.5 = 2.5 → strong
    // under the pre-re-validation constants)
    expect(conviction({ clusterSize: 4, maxAskJump: 2.5, minSinceOpen: 300, atmOnly: false }).tier).toBe("moderate");
  });
  it("muted buckets (midday, power+curb) never read STRONG and set the muted flag", () => {
    // best possible muted score: 1.0 + 0.3 - 0.5 = 0.8 → weak
    const midday = conviction({ clusterSize: 4, maxAskJump: 2.5, minSinceOpen: 180, atmOnly: false });
    const curb = conviction({ clusterSize: 4, maxAskJump: 2.5, minSinceOpen: 380, atmOnly: false });
    expect(midday.tier).toBe("weak");
    expect(curb.tier).toBe("weak");
    expect(midday.muted).toBe(true);
    expect(curb.muted).toBe(true);
    expect(conviction({ clusterSize: 4, maxAskJump: 2.5, minSinceOpen: 10, atmOnly: false }).muted).toBe(false);
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
  it("groups alerts by the display bar they are drawn inside", () => {
    const idx = indexByBarTime([mk(), mk({ direction: "down", side: "put" })]);
    const t = isoToUtc("2026-06-16T13:36:00Z") as number;
    expect(idx.get(t)).toHaveLength(2);
  });

  it("a 5m hover returns every alert in the five minutes under the candle", () => {
    // The tooltip prints each alert's true alert_ts, so widening the index is
    // the only place the sub-bar timing has to survive.
    const alerts = [
      mk({ alert_ts: "2026-06-16T09:35:02-04:00" }),
      mk({ alert_ts: "2026-06-16T09:36:10-04:00" }),
      mk({ alert_ts: "2026-06-16T09:39:59-04:00" }),
      mk({ alert_ts: "2026-06-16T09:40:00-04:00" }), // next bucket
    ];
    const idx = indexByBarTime(alerts, "5m");
    expect(idx.get(et("09:35:00"))).toHaveLength(3);
    expect(idx.get(et("09:40:00"))).toHaveLength(1);
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
