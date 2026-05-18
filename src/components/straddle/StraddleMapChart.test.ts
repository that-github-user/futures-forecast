/**
 * Tests for the StraddleMapChart option-builder.
 *
 * The React component is a thin wrapper over `buildStraddleMapOption`
 * and the `buildReferenceLineIndices` helper — we pin both directly
 * since the project has no @testing-library/react setup and rendering
 * ECharts under happy-dom requires a real canvas.
 *
 * Coverage (single-bar net-OI layout):
 *   - empty / cold-start payloads return null from the option builder
 *   - reference-line fractional indices (spot / em_upper / em_lower)
 *     produced by `buildReferenceLineIndices` — on-strike, clamp
 *     above/below the visible window, fractional interpolation, and
 *     per-field null handling for cold-start. The component-side
 *     `applyReferenceLines` consumes these and uses
 *     `chart.convertToPixel` between integer indices to render the
 *     reference lines as `graphic` overlays in pixel space (#321).
 *   - absence-of-markLine guard: the option builder no longer emits
 *     a markLine on the net-OI series (#321).
 *   - single net-OI series carries `[call_oi - put_oi, strike]` tuples
 *   - bar tint follows hemisphere convention (positive net → blue,
 *     negative net → amber)
 *   - net-fresh-flow glyph fires above the visibility threshold and
 *     stays suppressed at/below it
 */

import { describe, expect, it, vi } from "vitest";
import { createRef, type MutableRefObject } from "react";
import type * as echarts from "echarts";
import type {
  ProgramFlowState,
  StraddleChainResponse,
  StraddleStrikeRow,
} from "../../api/terminalTypes";
import { colors, withAlpha } from "../../styles/tokens";
import {
  buildReferenceLineIndices,
  buildStraddleMapOption,
  NET_FRESH_FLOW_GLYPH_MIN,
  NET_OI_ALPHA,
  netFreshFlow,
  netFreshFlowGlyph,
  netOi,
  netOiTint,
} from "./straddleMapHelpers";
import { applyReferenceLines } from "./applyReferenceLines";


function emptyProgramFlow(): ProgramFlowState {
  return { active_windowed: [], active_continuous: [], upcoming: [] };
}

function strike(overrides: Partial<StraddleStrikeRow> = {}): StraddleStrikeRow {
  return {
    strike: 5180,
    call_oi: 1000,
    call_volume: 100,
    call_iv: 0.15,
    call_delta: 0.5,
    call_bid: 10,
    call_ask: 10.5,
    fresh_flow_call: 0,
    put_oi: 800,
    put_volume: 80,
    put_iv: 0.16,
    put_delta: -0.5,
    put_bid: 9.5,
    put_ask: 10,
    fresh_flow_put: 0,
    ...overrides,
  };
}

function snapshot(overrides: Partial<StraddleChainResponse> = {}): StraddleChainResponse {
  return {
    snapshot_time: "2026-05-15T10:00:00-04:00",
    expiry: "20260515",
    spot: 5180,
    atm_strike: 5180,
    atm_straddle_mid: 22,
    em_upper: 5202,
    em_lower: 5158,
    session_open_spot: 5174,
    session_open_straddle: 23,
    realized_range_pts: 12,
    realized_vs_implied_pct: 54.5,
    strikes: [
      // 5160: put-dominant → net = 500 - 1200 = -700 → amber.
      strike({ strike: 5160, call_oi: 500, put_oi: 1200 }),
      // 5180: call-dominant → net = 1500 - 1100 = +400 → blue.
      strike({ strike: 5180, call_oi: 1500, put_oi: 1100 }),
      // 5200: call-dominant → net = 1300 - 600 = +700 → blue.
      strike({ strike: 5200, call_oi: 1300, put_oi: 600 }),
    ],
    pin_candidates: [],
    program_flow: emptyProgramFlow(),
    stale: false,
    data_age_seconds: 30,
    velocity_tape: null,
    ...overrides,
  };
}


describe("buildStraddleMapOption", () => {
  it("returns null when data is null", () => {
    expect(buildStraddleMapOption(null)).toBeNull();
  });

  it("returns null when strikes is empty (cold-start)", () => {
    expect(
      buildStraddleMapOption(snapshot({ strikes: [] })),
    ).toBeNull();
  });

  it("computes reference-line indices for em_upper / em_lower / spot via the exported helper", () => {
    // The fractional indices feed the component-side
    // `applyReferenceLines` post-render step (`chart.convertToPixel`
    // between integer indices, then linear interpolation). Strikes
    // descending: [5200, 5180, 5160] → idx 0/1/2.
    const indices = buildReferenceLineIndices(snapshot());
    // spot=5180 lines up exactly with idx 1 (on-strike).
    expect(indices.spot).toBe(1);
    // em_upper=5202 is above the top strike → clamps to 0.
    expect(indices.emUpper).toBe(0);
    // em_lower=5158 is below the bottom strike → clamps to N-1 = 2.
    expect(indices.emLower).toBe(2);
  });

  it("interpolates reference-line indices for values between strikes (#321)", () => {
    // spot 5170 is exactly halfway between 5180 (idx 1) and 5160
    // (idx 2). The helper returns 1.5 so the component can map it
    // to a precise pixel y via interpolation.
    const indices = buildReferenceLineIndices(snapshot({ spot: 5170 }));
    expect(indices.spot).toBeCloseTo(1.5, 5);
  });

  it("returns null indices when any headline field is null (cold-start)", () => {
    const indices = buildReferenceLineIndices(
      snapshot({ em_lower: null, spot: null }),
    );
    expect(indices.spot).toBeNull();
    expect(indices.emLower).toBeNull();
    expect(indices.emUpper).toBe(0); // still set
  });

  it("returns all-null indices for empty strikes or null data", () => {
    expect(buildReferenceLineIndices(null)).toEqual({
      spot: null,
      emUpper: null,
      emLower: null,
    });
    expect(buildReferenceLineIndices(snapshot({ strikes: [] }))).toEqual({
      spot: null,
      emUpper: null,
      emLower: null,
    });
  });

  it("does NOT emit markLine entries — reference lines are graphic overlays (#321)", () => {
    // Pre-#321: spot + EM were `markLine` entries with fractional yAxis
    // on a category axis. ECharts 6.x's OrdinalScale.parse rounds those
    // values, mis-aligning the lines by up to ±half a strike interval.
    // Fix: the option builder no longer emits markLine; the component
    // overlays graphic-line elements via `applyReferenceLines` using
    // `convertToPixel` between integer indices. Test that the option
    // does NOT carry a markLine on the net-OI series — the absence is
    // the contract.
    const option = buildStraddleMapOption(snapshot());
    expect(option).not.toBeNull();
    const series = option!.series as Array<{
      markLine?: unknown;
    }>;
    expect(series[0].markLine).toBeUndefined();
  });

  it("renders a category yAxis with strike labels in descending order", () => {
    // Horizontal diverging chart requires yAxis=category so bars extend
    // along xAxis from the x=0 baseline. Strikes are sorted descending
    // so highest strikes sit at the top of the chart (matches how
    // operators read option chains, calls/upside above the ATM line).
    const option = buildStraddleMapOption(snapshot());
    const yAxis = option!.yAxis as { type?: string; data?: string[] };
    expect(yAxis.type).toBe("category");
    expect(yAxis.data).toEqual(["5200", "5180", "5160"]);
  });

  it("preserves fractional strike precision in yAxis category labels", () => {
    // Tooltip lookup parses the axis label string back to a number to
    // find the matching strike row (`data.strikes.find(s.strike === n)`).
    // `.toFixed(0)` would render 5180.5 as "5181" → Number("5181") =
    // 5181 → no match → empty tooltip. Use String(s.strike) so the
    // round-trip is lossless for any future fractional strikes (e.g.,
    // SPY 1pt grid with half-strikes, weekly SPX widenings).
    const option = buildStraddleMapOption(
      snapshot({
        strikes: [
          strike({ strike: 5180.5, call_oi: 500, put_oi: 200 }),
          strike({ strike: 5180, call_oi: 300, put_oi: 700 }),
        ],
      }),
    );
    const yAxis = option!.yAxis as { data?: string[] };
    expect(yAxis.data).toEqual(["5180.5", "5180"]);
    // Round-trip: Number(label) recovers the original strike.
    expect(Number(yAxis.data![0])).toBe(5180.5);
    expect(Number(yAxis.data![1])).toBe(5180);
  });

  it("sets yAxis.inverse=true so descending data renders highest-at-top", () => {
    // ECharts cartesian2d category yAxis defaults to data[0]-at-bottom
    // (origin at bottom). Our `strikeCategories` is sorted descending,
    // so without inverse=true the chart renders FLIPPED — operators
    // would see 7405 at the top and 7585 at the bottom, opposite their
    // option-chain mental model. This test locks the orientation so a
    // future refactor (e.g., switching the sort to ascending) doesn't
    // silently re-introduce the flip without also flipping `inverse`.
    const option = buildStraddleMapOption(snapshot());
    const yAxis = option!.yAxis as { inverse?: boolean };
    expect(yAxis.inverse).toBe(true);
  });

  it("emits a single net-OI bar series with scalar signed values in descending-strike order", () => {
    const option = buildStraddleMapOption(snapshot());
    const series = option!.series as Array<{
      name?: string;
      data?: Array<{ value?: number }>;
    }>;
    // Single-bar layout: exactly one bar series, no separate puts series.
    expect(series).toHaveLength(1);
    expect(series[0].name).toBe("net_oi");
    // Scalar values (NOT [x, y] tuples) align 1:1 with yAxis.data order.
    // Order matches the descending-strike yAxis: 5200, 5180, 5160.
    const values = series[0].data!.map((d) => d.value);
    expect(values).toEqual([
      700, //  5200: 1300 - 600  → call-dominant
      400, //  5180: 1500 - 1100 → call-dominant
      -700, // 5160:  500 - 1200 → put-dominant
    ]);
  });

  it("tints call-dominant bars accentBlue and put-dominant bars accentAmber", () => {
    const option = buildStraddleMapOption(snapshot());
    const data = (option!.series as Array<{
      data?: Array<{ itemStyle?: { color?: string } }>;
    }>)[0].data!;
    // Descending-strike order: data[0]=5200(+700 blue), [1]=5180(+400 blue),
    // [2]=5160(-700 amber).
    expect(data[0].itemStyle?.color).toBe(
      withAlpha(colors.accentBlue, NET_OI_ALPHA),
    );
    expect(data[1].itemStyle?.color).toBe(
      withAlpha(colors.accentBlue, NET_OI_ALPHA),
    );
    expect(data[2].itemStyle?.color).toBe(
      withAlpha(colors.accentAmber, NET_OI_ALPHA),
    );
  });

  it("uses a symmetric x-axis padded ~10% past max |net_oi|", () => {
    const option = buildStraddleMapOption(snapshot());
    const xAxis = option!.xAxis as { min?: number; max?: number };
    // max |net| in the fixture is 700 → padded by ~10%. Lock both the
    // symmetry (min == -max) and the rough magnitude (in [770, 780]) so
    // a future tweak to the padding factor can't silently flip the axis
    // sign convention.
    expect(xAxis.max).toBeGreaterThanOrEqual(770);
    expect(xAxis.max).toBeLessThanOrEqual(780);
    expect(xAxis.min).toBe(-(xAxis.max as number));
  });
});


/**
 * Hand-rolled mock of the slice of `echarts.ECharts` that
 * `applyReferenceLines` actually touches. happy-dom doesn't simulate
 * canvas + the ECharts layout pipeline, so we mock at the API
 * boundary: `convertToPixel`, `getWidth`, and `setOption`. Each test
 * controls what convertToPixel returns to exercise a specific code
 * path (valid pixels, [NaN, NaN], throw, or after-dispose).
 */
function makeMockChart(opts: {
  pixels?: [number, number] | "nan" | "throw";
  width?: number;
  setOptionThrows?: boolean;
} = {}) {
  const { pixels = [400, 200], width = 800, setOptionThrows = false } = opts;
  const setOption = vi.fn();
  if (setOptionThrows) {
    setOption.mockImplementation(() => {
      throw new Error("chart disposed");
    });
  }
  const convertToPixel = vi.fn((_: unknown, idx: number) => {
    if (pixels === "throw") throw new Error("model not ready");
    if (pixels === "nan") return [NaN, NaN];
    // Linear ramp between top=pixels[1] and bot=pixels[1]+300 for
    // smoke-test purposes. The shape of the returned array is all
    // that matters for the production code — values just need to be
    // finite for the success path.
    return idx === 0 ? [pixels[0], pixels[1]] : [pixels[0], pixels[1] + 300];
  });
  return {
    chart: {
      convertToPixel,
      getWidth: () => width,
      setOption,
    } as unknown as echarts.ECharts,
    setOption,
    convertToPixel,
  };
}

describe("applyReferenceLines (#351 regression)", () => {
  const stableRef = (): MutableRefObject<string> => {
    const r = createRef<string>() as MutableRefObject<string>;
    r.current = "";
    return r;
  };

  // Operator's 2026-05-18 11:35 ET production snapshot — verified at
  // the time as: em_upper=7414.25 / em_lower=7354.15 / spot=7384.2 /
  // strike grid 7285..7480 step 5. This is the data that failed to
  // render EM lines on the live page; pinning it as a regression
  // fixture protects against future helper drift.
  function operatorSnapshot(): StraddleChainResponse {
    const strikes: StraddleStrikeRow[] = [];
    for (let s = 7285; s <= 7480; s += 5) {
      strikes.push(strike({ strike: s, call_oi: 100, put_oi: 100 }));
    }
    return snapshot({
      spot: 7384.2,
      atm_strike: 7385,
      atm_straddle_mid: 30.05,
      em_upper: 7414.25,
      em_lower: 7354.15,
      strikes,
    });
  }

  it("does NOT write graphics when convertToPixel returns [NaN, NaN] (root cause of #351)", () => {
    // Pre-fix: applyReferenceLines proceeded with NaN, propagating
    // non-finite coords into graphic line shapes which ECharts
    // silently dropped — visible bug = "EM lines missing despite
    // valid data". Post-fix: the not-ready branch returns without
    // calling setOption({graphic: ...}) so the next 'finished' event
    // gets a clean retry.
    const { chart, setOption } = makeMockChart({ pixels: "nan" });
    applyReferenceLines(chart, operatorSnapshot(), stableRef());
    expect(setOption).not.toHaveBeenCalled();
  });

  it("does NOT write graphics when convertToPixel throws (disposed/uninit model)", () => {
    // Same posture as the NaN path — convertToPixel can throw when
    // ECharts' component model is partially initialized or after
    // dispose (#347 hotfix comment). The function must swallow the
    // throw without calling setOption.
    const { chart, setOption } = makeMockChart({ pixels: "throw" });
    applyReferenceLines(chart, operatorSnapshot(), stableRef());
    expect(setOption).not.toHaveBeenCalled();
  });

  it("writes graphics with replaceMerge when convertToPixel returns finite pixels", () => {
    const { chart, setOption } = makeMockChart({ pixels: [50, 100] });
    const ref = stableRef();
    applyReferenceLines(chart, operatorSnapshot(), ref);
    expect(setOption).toHaveBeenCalledTimes(1);
    const [optArg, mergeArg] = setOption.mock.calls[0];
    expect(mergeArg).toEqual({ replaceMerge: ["graphic"] });
    // 3 reference lines × 2 elements (line + label) = 6 graphic
    // entries on the operator's snapshot (em_upper + em_lower + spot
    // are all finite).
    const graphic = (optArg as { graphic: unknown[] }).graphic;
    expect(graphic).toHaveLength(6);
    // Cache key updated so re-entry on identical data short-circuits.
    expect(ref.current.length).toBeGreaterThan(0);
  });

  it("short-circuits when the cache key matches (no setOption re-fire)", () => {
    // Critical: ECharts 'finished' event fires after every setOption
    // including the one applyReferenceLines itself makes. Without a
    // cache-key guard this would loop forever. The TentChart precedent
    // (#347) uses the same pattern.
    const { chart, setOption } = makeMockChart({ pixels: [50, 100] });
    const ref = stableRef();
    applyReferenceLines(chart, operatorSnapshot(), ref);
    expect(setOption).toHaveBeenCalledTimes(1);
    applyReferenceLines(chart, operatorSnapshot(), ref);
    // Still 1 — second call detected unchanged graphics via cache key.
    expect(setOption).toHaveBeenCalledTimes(1);
  });

  it("survives setOption throwing mid-tick (chart disposed between checks)", () => {
    // Race: convertToPixel succeeds but the chart is disposed before
    // the subsequent setOption. The try/catch must swallow the throw
    // so the 'finished' handler doesn't propagate an unhandled
    // exception up to ChunkLoadErrorBoundary (this caused the Tent-tab
    // self-heal loop pre-#225 — same class of bug).
    const { chart } = makeMockChart({
      pixels: [50, 100],
      setOptionThrows: true,
    });
    const ref = stableRef();
    expect(() =>
      applyReferenceLines(chart, operatorSnapshot(), ref),
    ).not.toThrow();
    // Cache reset so a future remount re-applies cleanly.
    expect(ref.current).toBe("");
  });

  it("clears graphics (with replaceMerge) on cold-start when previously applied", () => {
    const { chart, setOption } = makeMockChart({ pixels: [50, 100] });
    const ref = stableRef();
    // First populate.
    applyReferenceLines(chart, operatorSnapshot(), ref);
    expect(setOption).toHaveBeenCalledTimes(1);
    // Then transition to cold-start (no strikes).
    applyReferenceLines(chart, snapshot({ strikes: [] }), ref);
    expect(setOption).toHaveBeenCalledTimes(2);
    const [, mergeArg] = setOption.mock.calls[1];
    expect(mergeArg).toEqual({ replaceMerge: ["graphic"] });
    const optArg = setOption.mock.calls[1][0] as { graphic: unknown[] };
    expect(optArg.graphic).toEqual([]);
    expect(ref.current).toBe("");
  });

  it("verifies the operator's exact production indices produce finite pixels (not NaN)", () => {
    // Trace-through of the math: with em_upper=7414.25 between
    // strikes 7415 (idx 13) and 7410 (idx 14), the helper returns
    // ~13.15 — well within (0, 39) on the 40-strike fixture. The
    // pre-fix bug wasn't the math; it was the timing of
    // convertToPixel. This test asserts the math itself stays
    // correct: helper → pxForIndex must produce finite y-pixels for
    // every reference line on the operator's exact snapshot.
    const data = operatorSnapshot();
    const indices = buildReferenceLineIndices(data);
    expect(indices.spot).not.toBeNull();
    expect(indices.emUpper).not.toBeNull();
    expect(indices.emLower).not.toBeNull();
    expect(Number.isFinite(indices.spot!)).toBe(true);
    expect(Number.isFinite(indices.emUpper!)).toBe(true);
    expect(Number.isFinite(indices.emLower!)).toBe(true);
    // em_upper closest to top → small index; em_lower closest to
    // bottom → large index. Locks the orientation.
    expect(indices.emUpper!).toBeLessThan(indices.spot!);
    expect(indices.spot!).toBeLessThan(indices.emLower!);
  });
});


describe("netOi / netFreshFlow helpers", () => {
  it("treats null sides as zero in netOi", () => {
    expect(netOi(null, null)).toBe(0);
    expect(netOi(500, null)).toBe(500);
    expect(netOi(null, 300)).toBe(-300);
  });

  it("treats null sides as zero in netFreshFlow", () => {
    expect(netFreshFlow(null, null)).toBe(0);
    expect(netFreshFlow(120, null)).toBe(120);
    expect(netFreshFlow(null, 80)).toBe(-80);
    expect(netFreshFlow(200, 50)).toBe(150);
  });
});


describe("netOiTint", () => {
  it("returns the blue tint for positive net (calls dominant)", () => {
    expect(netOiTint(500)).toBe(withAlpha(colors.accentBlue, NET_OI_ALPHA));
  });

  it("returns the amber tint for negative net (puts dominant)", () => {
    expect(netOiTint(-500)).toBe(withAlpha(colors.accentAmber, NET_OI_ALPHA));
  });

  it("returns a muted neutral tint for exact-tie zero net", () => {
    // Rare in practice but the bar should still render at all-zero
    // — assert we don't fall through to undefined or empty string.
    const tint = netOiTint(0);
    expect(typeof tint).toBe("string");
    expect(tint.length).toBeGreaterThan(0);
  });

  it("blue and amber tints share the same alpha byte (symmetric)", () => {
    // Symmetry invariant — same alpha so neither hemisphere visually
    // outshouts the other. Catches future drift to saturated-vs-alpha.
    const blue = netOiTint(500);
    const amber = netOiTint(-500);
    expect(blue.slice(-2)).toBe(amber.slice(-2));
  });
});


describe("netFreshFlowGlyph (colorblind cue)", () => {
  it("returns empty string for zero net flow", () => {
    expect(netFreshFlowGlyph(0)).toBe("");
  });

  it("returns empty string for |net flow| at the visibility threshold", () => {
    // Boundary: glyph fires only ABOVE the threshold so a +50 / -50
    // net flow stays quiet — within noise floor for the daily baseline.
    expect(netFreshFlowGlyph(NET_FRESH_FLOW_GLYPH_MIN)).toBe("");
    expect(netFreshFlowGlyph(-NET_FRESH_FLOW_GLYPH_MIN)).toBe("");
  });

  it("returns ▲ for net flow just above the threshold (opening)", () => {
    expect(netFreshFlowGlyph(NET_FRESH_FLOW_GLYPH_MIN + 1)).toBe("▲");
  });

  it("returns ▼ for net flow just below the negative threshold (closing)", () => {
    expect(netFreshFlowGlyph(-(NET_FRESH_FLOW_GLYPH_MIN + 1))).toBe("▼");
  });
});


describe("buildStraddleMapOption — net fresh-flow labels", () => {
  it("renders the ▲ / ▼ glyph only when |net fresh flow| exceeds the threshold", () => {
    const option = buildStraddleMapOption(
      snapshot({
        strikes: [
          // Net flow = 250 - 0 = 250 → above threshold → ▲ (green).
          strike({ strike: 5180, fresh_flow_call: 250, fresh_flow_put: 0 }),
          // Net flow = 0 - 120 = -120 → below threshold → ▼ (red).
          strike({ strike: 5160, fresh_flow_call: 0, fresh_flow_put: 120 }),
          // Net flow = 30 - 20 = 10 → within noise floor → no glyph.
          strike({ strike: 5200, fresh_flow_call: 30, fresh_flow_put: 20 }),
        ],
      }),
    );
    const data = (option!.series as Array<{
      data?: Array<{ label?: { show?: boolean; formatter?: string; color?: string } }>;
    }>)[0].data!;
    // Strikes are sorted descending in the chart, so data order is
    // [5200, 5180, 5160] regardless of fixture input order.
    // data[0]=5200 → below-threshold → no glyph.
    expect(data[0].label?.show).toBe(false);
    // data[1]=5180 → ▲ green opening.
    expect(data[1].label?.show).toBe(true);
    expect(data[1].label?.formatter).toBe("▲");
    expect(data[1].label?.color).toBe(colors.accentGreen);
    // data[2]=5160 → ▼ red closing.
    expect(data[2].label?.show).toBe(true);
    expect(data[2].label?.formatter).toBe("▼");
    expect(data[2].label?.color).toBe(colors.accentRed);
  });

  it("fires the glyph at exactly threshold+1 contracts (boundary)", () => {
    // Lock the strict inequality: |net| MUST exceed the threshold.
    // At threshold+1, the glyph appears. At threshold (==), it doesn't.
    const above = buildStraddleMapOption(
      snapshot({
        strikes: [
          strike({
            strike: 5180,
            fresh_flow_call: NET_FRESH_FLOW_GLYPH_MIN + 1,
            fresh_flow_put: 0,
          }),
        ],
      }),
    );
    const aboveData = (above!.series as Array<{
      data?: Array<{ label?: { show?: boolean } }>;
    }>)[0].data!;
    expect(aboveData[0].label?.show).toBe(true);

    const atThreshold = buildStraddleMapOption(
      snapshot({
        strikes: [
          strike({
            strike: 5180,
            fresh_flow_call: NET_FRESH_FLOW_GLYPH_MIN,
            fresh_flow_put: 0,
          }),
        ],
      }),
    );
    const atData = (atThreshold!.series as Array<{
      data?: Array<{ label?: { show?: boolean } }>;
    }>)[0].data!;
    expect(atData[0].label?.show).toBe(false);
  });
});
