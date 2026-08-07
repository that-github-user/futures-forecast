import { describe, expect, it } from "vitest";
import type { MarkupAlert, MarkupState } from "../api/terminalTypes";
import {
  boundSpotWindow,
  buildWindowCandles,
  deriveLiveMarkup,
  etMinutesOfDay,
  isCashRthMinute,
  liveAlertToReview,
  liveSessionCandles,
  mergeSpotSeries,
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

describe("buildWindowCandles", () => {
  const utc = (hms: string) => Date.parse(`2026-06-18T${hms}Z`) / 1000;

  it("returns nothing with no spots", () => {
    expect(buildWindowCandles([])).toEqual([]);
  });

  it("builds the newest minute's OHLC from that minute's samples only", () => {
    const spots: [string, number][] = [
      ["2026-06-18T10:30:58-04:00", 7500], // 10:30, oldest bucket → partial
      ["2026-06-18T10:31:00-04:00", 7510], // open
      ["2026-06-18T10:31:20-04:00", 7515], // high
      ["2026-06-18T10:31:40-04:00", 7508], // low
      ["2026-06-18T10:31:55-04:00", 7512], // close (latest)
    ];
    // 10:30 is dropped: its one surviving sample is not its open (10:31:00 EDT
    // = 14:31:00 UTC → epoch seconds).
    expect(buildWindowCandles(spots)).toEqual([
      {
        time: utc("14:31:00"),
        open: 7510,
        high: 7515,
        low: 7508,
        close: 7512,
      },
    ]);
  });

  it("a single sample yields a flat forming candle", () => {
    expect(buildWindowCandles([["2026-06-18T10:31:10-04:00", 7510]])).toEqual([
      { time: utc("14:31:00"), open: 7510, high: 7510, low: 7510, close: 7510 },
    ]);
  });

  it("emits a minute that was never the newest one — the 10:47 hole", () => {
    // Regression for the silently-dropped candle: the spot stream gapped across
    // 10:47 and only healed (via the server's 120s window) once 10:48 was
    // current, so 10:47 was never the newest sample's minute at any recompute.
    // The single-candle builder could only ever emit 10:48 and the chart's
    // monotonic guard then sealed 10:47 out for good.
    const spots: [string, number][] = [
      ["2026-06-18T10:46:10-04:00", 7500],
      ["2026-06-18T10:46:50-04:00", 7502],
      ["2026-06-18T10:47:05-04:00", 7505], // 10:47 open
      ["2026-06-18T10:47:35-04:00", 7509], // 10:47 high
      ["2026-06-18T10:47:50-04:00", 7503], // 10:47 low + close
      ["2026-06-18T10:48:05-04:00", 7506], // forming
    ];
    expect(buildWindowCandles(spots)).toEqual([
      {
        time: utc("14:47:00"),
        open: 7505,
        high: 7509,
        low: 7503,
        close: 7503,
      },
      {
        time: utc("14:48:00"),
        open: 7506,
        high: 7506,
        low: 7506,
        close: 7506,
      },
    ]);
  });

  it("excludes the oldest minute — the window truncation destroyed its open", () => {
    const spots: [string, number][] = [
      ["2026-06-18T10:46:59-04:00", 7500], // sole survivor of 10:46, NOT its open
      ["2026-06-18T10:47:10-04:00", 7505],
      ["2026-06-18T10:48:00-04:00", 7507],
    ];
    const out = buildWindowCandles(spots);
    expect(out.map((c) => c.time)).toEqual([utc("14:47:00"), utc("14:48:00")]);
    expect(out.some((c) => c.open === 7500)).toBe(false); // no fabricated open
  });

  it("keeps the oldest minute when its first sample lands ON the boundary", () => {
    // The truncation exclusion is about a FABRICATED open; a sample exactly at
    // the minute's start IS that minute's open, so suppressing it would only
    // narrow the heal reach.
    const spots: [string, number][] = [
      ["2026-06-18T10:46:00-04:00", 7500], // exactly 10:46:00 → a real open
      ["2026-06-18T10:46:40-04:00", 7504],
      ["2026-06-18T10:47:10-04:00", 7505],
    ];
    const out = buildWindowCandles(spots);
    expect(out.map((c) => c.time)).toEqual([utc("14:46:00"), utc("14:47:00")]);
    expect(out[0].open).toBe(7500);
  });

  it("a window inside one minute still yields the forming candle", () => {
    const spots: [string, number][] = [
      ["2026-06-18T10:47:05-04:00", 7505],
      ["2026-06-18T10:47:50-04:00", 7509],
    ];
    expect(buildWindowCandles(spots)).toEqual([
      { time: utc("14:47:00"), open: 7505, high: 7509, low: 7505, close: 7509 },
    ]);
  });

  it("skips unparseable timestamps instead of NaN-bucketing them", () => {
    const spots: [string, number][] = [
      ["not-a-date", 1],
      ["2026-06-18T10:46:10-04:00", 7500],
      ["2026-06-18T10:47:10-04:00", 7505],
    ];
    expect(buildWindowCandles(spots).map((c) => c.time)).toEqual([
      utc("14:47:00"),
    ]);
    expect(buildWindowCandles([["not-a-date", 1]])).toEqual([]);
  });
});

describe("mergeSpotSeries", () => {
  const ts = (hms: string): string => `2026-06-18T${hms}-04:00`;

  it("fills a gap in the fine-grained series from the server window", () => {
    // The local SSE stream missed 10:31:05–10:31:35 (throttled tab / dropped
    // queue entry); the server re-sends its whole window every state event.
    const existing: [string, number][] = [
      [ts("10:30:10"), 7500],
      [ts("10:31:50"), 7509],
    ];
    const incoming: [string, number][] = [
      [ts("10:31:05"), 7503],
      [ts("10:31:35"), 7506],
    ];
    expect(mergeSpotSeries(existing, incoming, 120_000)).toEqual([
      [ts("10:30:10"), 7500],
      [ts("10:31:05"), 7503],
      [ts("10:31:35"), 7506],
      [ts("10:31:50"), 7509],
    ]);
  });

  it("keeps the local sample on a timestamp collision", () => {
    // The local sample is the sub-second SSE tick; the server series is a coarse
    // 5s resample of the same instant and must never clobber it.
    const existing: [string, number][] = [[ts("10:31:05"), 7503]];
    const incoming: [string, number][] = [
      [ts("10:31:05"), 9999],
      [ts("10:31:10"), 7504],
    ];
    expect(mergeSpotSeries(existing, incoming, 120_000)).toEqual([
      [ts("10:31:05"), 7503],
      [ts("10:31:10"), 7504],
    ]);
  });

  it("keeps the local sample when the two sources spell the instant differently", () => {
    // The producers need not agree on formatting (sub-second local tick vs
    // whole-second server resample, ET offset vs Z). Keyed on the raw string
    // both would survive and the coarse price would widen the minute's
    // high/low — the exact fidelity loss the precedence rule exists to prevent.
    const existing: [string, number][] = [["2026-06-18T10:31:05.250-04:00", 7503]];
    const incoming: [string, number][] = [["2026-06-18T14:31:05.250Z", 9999]];
    expect(mergeSpotSeries(existing, incoming, 120_000)).toEqual([
      ["2026-06-18T10:31:05.250-04:00", 7503],
    ]);
  });

  it("bounds the merged series to the window", () => {
    const existing: [string, number][] = [[ts("10:29:00"), 7490]];
    const incoming: [string, number][] = [
      [ts("10:31:30"), 7503],
      [ts("10:32:00"), 7505],
    ];
    expect(mergeSpotSeries(existing, incoming, 120_000)).toEqual([
      [ts("10:31:30"), 7503],
      [ts("10:32:00"), 7505],
    ]);
  });

  it("an absent server series leaves the local samples intact", () => {
    // useLiveMarkup passes `s.spot_series ?? []` — spot_series is optional.
    const existing: [string, number][] = [
      [ts("10:31:05"), 7503],
      [ts("10:31:10"), 7504],
    ];
    expect(mergeSpotSeries(existing, [], 120_000)).toEqual(existing);
    expect(mergeSpotSeries([], [], 120_000)).toEqual([]);
  });

  it("drops unparseable timestamps rather than scrambling the sort", () => {
    const existing: [string, number][] = [
      ["not-a-date", 7],
      [ts("10:31:00"), 7500],
    ];
    const incoming: [string, number][] = [[ts("10:31:30"), 7503]];
    expect(mergeSpotSeries(existing, incoming, 120_000)).toEqual([
      [ts("10:31:00"), 7500],
      [ts("10:31:30"), 7503],
    ]);
  });

  it("orders a lone late-delivered sample behind the tail", () => {
    // The `onSpot` call shape: one sample, delivered after a state already
    // merged the server window past it. Appending would leave the array
    // unsorted, and boundSpotWindow reads its cutoff off the LAST element.
    const existing: [string, number][] = [
      [ts("10:31:00"), 7500],
      [ts("10:31:50"), 7509],
    ];
    expect(mergeSpotSeries(existing, [[ts("10:31:20"), 7504]], 120_000)).toEqual([
      [ts("10:31:00"), 7500],
      [ts("10:31:20"), 7504],
      [ts("10:31:50"), 7509],
    ]);
  });
});

describe("etMinutesOfDay (DST-correct ET wall-clock)", () => {
  it("reads EDT (summer, UTC-4)", () => {
    // 2026-06-18T13:30:00Z → 09:30 EDT → 570
    expect(etMinutesOfDay(Date.parse("2026-06-18T13:30:00Z") / 1000)).toBe(570);
  });

  it("reads EST (winter, UTC-5) — same UTC hour, different ET", () => {
    // 2026-01-15T13:30:00Z → 08:30 EST → 510 (proves the offset flips with DST)
    expect(etMinutesOfDay(Date.parse("2026-01-15T13:30:00Z") / 1000)).toBe(510);
  });
});

describe("isCashRthMinute (SPX cash 09:30–16:00 ET)", () => {
  const at = (iso: string) => isCashRthMinute(Date.parse(iso) / 1000);

  it("true mid-session", () => {
    expect(at("2026-06-18T14:31:00Z")).toBe(true); // 10:31 ET
  });

  it("true exactly at the 09:30 open (inclusive)", () => {
    expect(at("2026-06-18T13:30:00Z")).toBe(true); // 09:30 ET
  });

  it("false at the 16:00 close (exclusive)", () => {
    expect(at("2026-06-18T20:00:00Z")).toBe(false); // 16:00 ET
  });

  it("false pre-open", () => {
    expect(at("2026-06-18T13:29:00Z")).toBe(false); // 09:29 ET
  });

  it("false post-close (the float the gate suppresses)", () => {
    expect(at("2026-06-18T20:05:00Z")).toBe(false); // 16:05 ET
  });
});

describe("liveSessionCandles (cash-RTH gate)", () => {
  const times = (spots: [string, number][]) =>
    liveSessionCandles(spots).map((c) => c.time);
  const utc = (hms: string) => Date.parse(`2026-06-18T${hms}Z`) / 1000;

  it("shows the forming candle during the cash session", () => {
    expect(times([["2026-06-18T10:31:10-04:00", 7509]])).toEqual([
      utc("14:31:00"),
    ]);
  });

  it("shows the candle regardless of how stale the (now-removed) seed is", () => {
    // Regression for the freeze bug: 5+ min into the page's life the candle must
    // still draw. No historical-bar reference exists to go stale anymore.
    expect(times([["2026-06-18T15:59:10-04:00", 7509]])).toEqual([
      utc("19:59:00"),
    ]);
  });

  it("suppresses the candle once cash RTH has closed (post-16:00 float)", () => {
    expect(times([["2026-06-18T16:05:00-04:00", 7509]])).toEqual([]);
  });

  it("suppresses the candle before the 09:30 open", () => {
    expect(times([["2026-06-18T09:15:00-04:00", 7509]])).toEqual([]);
  });

  it("returns nothing when there are no spots", () => {
    expect(times([])).toEqual([]);
  });

  it("drops the out-of-session minutes and keeps the rest, at the close", () => {
    // The window straddles 16:00: 15:58 is the partial oldest, 16:00 is the
    // forming minute but past the cash close — only 15:59 survives.
    expect(
      times([
        ["2026-06-18T15:58:30-04:00", 7500],
        ["2026-06-18T15:59:20-04:00", 7502],
        ["2026-06-18T16:00:10-04:00", 7504],
        ["2026-06-18T16:00:50-04:00", 7505],
      ]),
    ).toEqual([utc("19:59:00")]);
  });

  it("drops a LEADING out-of-session minute without breaking the rest", () => {
    // The window straddles the 09:30 open: dropping 09:29 must leave 09:30 and
    // 09:31 ascending, or the chart's monotonic guard would cost a bar.
    expect(
      times([
        ["2026-06-18T09:28:40-04:00", 7500],
        ["2026-06-18T09:29:30-04:00", 7501],
        ["2026-06-18T09:30:10-04:00", 7504],
        ["2026-06-18T09:31:05-04:00", 7506],
      ]),
    ).toEqual([utc("13:30:00"), utc("13:31:00")]);
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
