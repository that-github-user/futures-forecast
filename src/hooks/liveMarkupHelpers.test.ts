import { describe, expect, it } from "vitest";
import type { MarkupAlert, MarkupState } from "../api/terminalTypes";
import { boundSpotWindow, deriveLiveMarkup } from "./liveMarkupHelpers";

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
