import { describe, expect, it } from "vitest";
import type { MarkupAlert, MarkupBandStrike } from "../../api/terminalTypes";
import {
  clamp01,
  directionMeta,
  formatAlertEvidence,
  intensityColor,
  lerpHex,
  pickFeatured,
  relativeAge,
  alertMarkerX,
  sparkGeometry,
  spotLineGeometry,
  spreadHeat,
  SLOPE_REF,
} from "./markupHelpers";
import { colors } from "../../styles/tokens";

const ts = (i: number) => `2026-05-28T10:12:${String(i).padStart(2, "0")}-04:00`;
function series(asks: number[], bids?: number[]): [string, number, number][] {
  return asks.map((a, i) => [ts(i), bids ? bids[i] : a - 0.1, a]);
}

describe("clamp01 / lerpHex / intensityColor", () => {
  it("clamps", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.3)).toBeCloseTo(0.3);
  });
  it("lerpHex midpoint of black→white is grey", () => {
    expect(lerpHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
  it("intensityColor ramps dim → amber → red", () => {
    expect(intensityColor(0)).toBe(colors.textDim);
    expect(intensityColor(0.5)).toBe(colors.accentAmber);
    expect(intensityColor(1)).toBe(colors.accentRed);
  });
});

describe("sparkGeometry", () => {
  it("returns null for <2 points", () => {
    expect(sparkGeometry([], 100, 50)).toBeNull();
    expect(sparkGeometry(series([1]), 100, 50)).toBeNull();
  });

  it("flat ask → all-zero segment intensities", () => {
    const geo = sparkGeometry(series([15, 15, 15, 15]), 200, 60)!;
    expect(geo.segments).toHaveLength(3);
    expect(geo.segments.every((s) => s.intensity === 0)).toBe(true);
  });

  it("a SLOPE_REF ask jump → full intensity on that segment", () => {
    // calm, calm, then a jump of exactly SLOPE_REF
    const geo = sparkGeometry(series([15, 15, 15 + SLOPE_REF]), 200, 60)!;
    expect(geo.segments[0].intensity).toBe(0);
    expect(geo.segments[2 - 1].intensity).toBeCloseTo(1); // last segment
  });

  it("points span the width and fillPath closes the spread polygon", () => {
    const geo = sparkGeometry(series([15, 16, 17]), 200, 60, 2)!;
    expect(geo.ask).toHaveLength(3);
    expect(geo.ask[0].x).toBeCloseTo(2); // pad
    expect(geo.ask[2].x).toBeCloseTo(198); // w - pad
    expect(geo.fillPath.startsWith("M ")).toBe(true);
    expect(geo.fillPath.trimEnd().endsWith("Z")).toBe(true);
  });

  it("baseline reference present only when baselineSpread given", () => {
    expect(sparkGeometry(series([15, 16]), 200, 60, 2, null)!.baselineY).toBeNull();
    expect(sparkGeometry(series([15, 16]), 200, 60, 2, 0.1)!.baselineY).not.toBeNull();
  });

  it("baseline stays on-canvas even when it exceeds the bid/ask span", () => {
    // tight flat series (span 0.1) + a large baseline_spread that the old
    // code mapped to y=-24 (off the 60px viewBox). Now folded into the
    // y-domain → must land in [0, h].
    const h = 60;
    const geo = sparkGeometry(
      [[ts(0), 14.9, 15.0], [ts(1), 14.9, 15.0]],
      200, h, 2, 0.15,
    )!;
    expect(geo.baselineY).not.toBeNull();
    expect(geo.baselineY!).toBeGreaterThanOrEqual(0);
    expect(geo.baselineY!).toBeLessThanOrEqual(h);
  });
});

describe("spreadHeat", () => {
  it("0 when spread == baseline, ~1 at 8x", () => {
    expect(spreadHeat(0.1, 0.1)).toBe(0);
    expect(spreadHeat(0.8, 0.1)).toBeCloseTo(1);
  });
  it("0 on null / non-positive baseline", () => {
    expect(spreadHeat(null, 0.1)).toBe(0);
    expect(spreadHeat(2, null)).toBe(0);
    expect(spreadHeat(2, 0)).toBe(0);
  });
});

describe("directionMeta", () => {
  it("call-up green ▲, put-down red ▼", () => {
    expect(directionMeta("up")).toEqual({ glyph: "▲", color: colors.accentGreen, label: "UP" });
    expect(directionMeta("down")).toEqual({ glyph: "▼", color: colors.accentRed, label: "DOWN" });
  });
});

describe("formatAlertEvidence", () => {
  it("formats spread/baseline/σ/ask-jump", () => {
    const a: MarkupAlert = {
      ts: ts(0), strike: 7515, side: "call", direction: "up",
      spread: 2.2, baseline_spread: 0.15, spread_z: 27.6, ask_jump: 2.5,
    };
    expect(formatAlertEvidence(a)).toBe("spread $2.20 vs $0.15 · 27.6σ · ask +$2.50");
  });
});

describe("relativeAge", () => {
  const now = new Date("2026-05-28T10:13:00-04:00").getTime();
  it("seconds then minutes", () => {
    expect(relativeAge("2026-05-28T10:12:48-04:00", now)).toBe("12s ago");
    expect(relativeAge("2026-05-28T10:10:00-04:00", now)).toBe("3m ago");
  });
});

describe("pickFeatured", () => {
  const mk = (strike: number, side: "call" | "put", spread: number): MarkupBandStrike => ({
    strike, side, bid: 1, ask: 1 + spread, spread, baseline_spread: 0.1, series: [],
  });
  it("picks the strike nearest centerAtm", () => {
    const band = [mk(7510, "call", 0.1), mk(7510, "put", 0.1), mk(7520, "call", 0.1), mk(7520, "put", 0.1)];
    const f = pickFeatured(band, 7518);
    expect(f.strike).toBe(7520);
    expect(f.call?.strike).toBe(7520);
    expect(f.put?.side).toBe("put");
  });
  it("falls back to widest-spread strike when centerAtm null", () => {
    const band = [mk(7510, "call", 0.1), mk(7520, "call", 3.0)];
    expect(pickFeatured(band, null).strike).toBe(7520);
  });
  it("empty band → nulls", () => {
    expect(pickFeatured([], 7515)).toEqual({ strike: null, call: null, put: null });
  });
});

describe("spotLineGeometry / alertMarkerX", () => {
  const spot = (prices: number[]): [string, number][] =>
    prices.map((p, i) => [ts(i), p]);

  it("returns null for <2 points", () => {
    expect(spotLineGeometry([], 200, 60)).toBeNull();
    expect(spotLineGeometry(spot([7515]), 200, 60)).toBeNull();
  });

  it("points span width; time domain from first/last ts", () => {
    const geo = spotLineGeometry(spot([7515, 7518, 7520]), 200, 60, 2)!;
    expect(geo.points).toHaveLength(3);
    expect(geo.points[0].x).toBeCloseTo(2);
    expect(geo.points[2].x).toBeCloseTo(198);
    expect(geo.tMin).toBe(new Date(ts(0)).getTime());
    expect(geo.tMax).toBe(new Date(ts(2)).getTime());
  });

  it("flat prices don't divide-by-zero", () => {
    const geo = spotLineGeometry(spot([7515, 7515, 7515]), 200, 60)!;
    expect(geo.points.every((p) => Number.isFinite(p.y))).toBe(true);
  });

  it("alertMarkerX: in-window → x in range, out-of-window → null", () => {
    const tMin = new Date(ts(0)).getTime();
    const tMax = new Date(ts(10)).getTime();
    const xMid = alertMarkerX(ts(5), tMin, tMax, 200, 2);
    expect(xMid).not.toBeNull();
    expect(xMid!).toBeGreaterThan(2);
    expect(xMid!).toBeLessThan(198);
    expect(alertMarkerX(ts(20), tMin, tMax, 200, 2)).toBeNull(); // after window
    expect(alertMarkerX("not-a-date", tMin, tMax, 200, 2)).toBeNull();
  });
});
