import { describe, expect, it } from "vitest";
import type { MarkupAlert, MarkupState } from "../api/terminalTypes";
import {
  boundSpotWindow,
  buildFormingCandle,
  deriveLiveMarkup,
  liveAlertToReview,
  liveSessionCandle,
} from "./liveMarkupHelpers";

const baseState = (over: Partial<MarkupState> = {}): MarkupState => ({
  session_date: "20260618",
  active_expiry: "20260618",
  center_atm: 7515,
  updated_at: "2026-06-18T10:30:00-04:00",
  age_seconds: 0,
  stale: false,
  band: [
    {
      strike: 7515,
      side: "call",
      bid: 1.0,
      ask: 1.4,
      spread: 0.4,
      baseline_spread: 0.1,
      series: [],
    },
  ],
  recent_alerts: [],
  spot_series: [],
  ...over,
});

const alert = (ts: string, over: Partial<MarkupAlert> = {}): MarkupAlert => ({
  ts,
  strike: 7515,
  side: "call",
  direction: "up",
  spread: 0.4,
  baseline_spread: 0.1,
  spread_z: 5.2,
  ask_jump: 1.35,
  ...over,
});

describe("boundSpotWindow", () => {
  it("drops points older than the window before the newest", () => {
    const spots: [string, number][] = [
      ["2026-06-18T10:29:30-04:00", 7510], // 150s before newest → dropped
      ["2026-06-18T10:31:30-04:00", 7511], // 30s before → kept
      ["2026-06-18T10:32:00-04:00", 7512], // newest
    ];
    const out = boundSpotWindow(spots, 120_000);
    expect(out).toEqual([
      ["2026-06-18T10:31:30-04:00", 7511],
      ["2026-06-18T10:32:00-04:00", 7512],
    ]);
  });

  it("keeps everything within the window", () => {
    const spots: [string, number][] = [
      ["2026-06-18T10:31:30-04:00", 7511],
      ["2026-06-18T10:32:00-04:00", 7512],
    ];
    expect(boundSpotWindow(spots, 120_000)).toBe(spots); // unchanged identity
  });

  it("empty stays empty", () => {
    expect(boundSpotWindow([], 120_000)).toEqual([]);
  });

  it("falls back to a 300-point cap on unparseable timestamps", () => {
    const spots: [string, number][] = Array.from({ length: 350 }, (_, i) => [
      "not-a-date",
      i,
    ]);
    expect(boundSpotWindow(spots, 120_000).length).toBe(300);
  });
});

describe("deriveLiveMarkup", () => {
  it("returns null with no base (hide panel)", () => {
    expect(deriveLiveMarkup(null, [], [])).toBeNull();
  });

  it("returns null when the band is empty (off-hours)", () => {
    expect(deriveLiveMarkup(baseState({ band: [] }), [["t", 1]], [])).toBeNull();
  });

  it("returns null when outside the live window (post-curb), even with a band", () => {
    expect(deriveLiveMarkup(baseState({ live_window: false }), [["t", 1]], [])).toBeNull();
  });

  it("shows when live_window is true or absent (backward-compat)", () => {
    expect(deriveLiveMarkup(baseState({ live_window: true }), [], [])).not.toBeNull();
    expect(deriveLiveMarkup(baseState(), [], [])).not.toBeNull(); // absent → live
  });

  it("overlays the live spot series over the coarse one", () => {
    const base = baseState({ spot_series: [["coarse", 7500]] });
    const live: [string, number][] = [["fine1", 7510], ["fine2", 7511]];
    const out = deriveLiveMarkup(base, live, []);
    expect(out?.spot_series).toEqual(live); // fine replaces coarse
  });

  it("falls back to the base spot series when no live spots accumulated yet", () => {
    const base = baseState({ spot_series: [["coarse", 7500]] });
    expect(deriveLiveMarkup(base, [], [])?.spot_series).toEqual([["coarse", 7500]]);
  });

  it("prepends live alerts, deduped by ts against the authoritative ring", () => {
    const a1 = alert("2026-06-18T10:30:01-04:00"); // already in base (authoritative)
    const a2 = alert("2026-06-18T10:30:05-04:00"); // brand-new live alert
    const base = baseState({ recent_alerts: [a1] });
    const out = deriveLiveMarkup(base, [], [a2, a1]);
    // a2 prepended once; a1 not duplicated
    expect(out?.recent_alerts.map((a) => a.ts)).toEqual([a2.ts, a1.ts]);
  });
});

describe("buildFormingCandle", () => {
  it("returns null with no spots", () => {
    expect(buildFormingCandle([])).toBeNull();
  });

  it("builds the current-minute OHLC from samples in that minute only", () => {
    const spots: [string, number][] = [
      ["2026-06-18T10:30:58-04:00", 7500], // previous minute → excluded
      ["2026-06-18T10:31:00-04:00", 7510], // open
      ["2026-06-18T10:31:20-04:00", 7515], // high
      ["2026-06-18T10:31:40-04:00", 7508], // low
      ["2026-06-18T10:31:55-04:00", 7512], // close (latest)
    ];
    const c = buildFormingCandle(spots);
    // 10:31:00 EDT = 14:31:00 UTC → epoch seconds
    expect(c).toEqual({
      time: Date.parse("2026-06-18T14:31:00Z") / 1000,
      open: 7510,
      high: 7515,
      low: 7508,
      close: 7512,
    });
  });

  it("a single sample yields a flat candle", () => {
    const c = buildFormingCandle([["2026-06-18T10:31:10-04:00", 7510]]);
    expect(c).toMatchObject({ open: 7510, high: 7510, low: 7510, close: 7510 });
  });
});

describe("liveSessionCandle (contiguity gate)", () => {
  const spots: [string, number][] = [["2026-06-18T15:59:10-04:00", 7509]];
  const candleSec = Date.parse("2026-06-18T19:59:00Z") / 1000; // 15:59 ET minute

  it("shows the candle when contiguous with the last bar (RTH lag)", () => {
    const lastBar = Date.parse("2026-06-18T19:58:00Z") / 1000; // 1 min behind
    expect(liveSessionCandle(spots, lastBar, 300)?.time).toBe(candleSec);
  });

  it("suppresses the candle when it floats far past the last bar (post-close)", () => {
    const lastBar = Date.parse("2026-06-18T19:30:00Z") / 1000; // 29 min behind
    expect(liveSessionCandle(spots, lastBar, 300)).toBeNull();
  });

  it("shows the candle when there are no historical bars yet", () => {
    expect(liveSessionCandle(spots, null, 300)?.time).toBe(candleSec);
  });

  it("returns null when there are no spots", () => {
    expect(liveSessionCandle([], 123, 300)).toBeNull();
  });
});

describe("liveAlertToReview", () => {
  const live = (over: Partial<MarkupAlert> = {}): MarkupAlert => ({
    ts: "2026-06-18T10:31:07-04:00",
    strike: 7520,
    side: "call",
    direction: "up",
    spread: 0.4,
    baseline_spread: 0.1,
    spread_z: 5.5,
    ask_jump: 1.4,
    ...over,
  });

  it("maps to a pending review alert with bar_time floored to the minute (UTC)", () => {
    const r = liveAlertToReview(live(), 7515);
    expect(r.status).toBe("pending");
    expect(r.alert_ts).toBe("2026-06-18T10:31:07-04:00");
    expect(r.bar_time).toBe(new Date(Date.parse("2026-06-18T14:31:00Z")).toISOString());
    expect(r.direction).toBe("up");
    expect(r.dist_from_atm).toBe(5); // 7520 - 7515
    expect(r.spread_z).toBe(5.5);
    expect(r.mfe).toBeNull();
    expect(r.mae).toBeNull();
  });

  it("dist_from_atm is null when center or strike is unknown", () => {
    expect(liveAlertToReview(live(), null).dist_from_atm).toBeNull();
    expect(liveAlertToReview(live({ strike: null }), 7515).dist_from_atm).toBeNull();
  });
});
