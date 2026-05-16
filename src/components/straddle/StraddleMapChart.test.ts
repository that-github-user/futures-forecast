/**
 * Tests for the StraddleMapChart option-builder.
 *
 * The React component is a thin wrapper over `buildStraddleMapOption`
 * — we pin the option-builder directly since the project has no
 * @testing-library/react setup and rendering ECharts under happy-dom
 * requires a real canvas. The builder is pure, so the markLines /
 * series shape can be asserted without any DOM.
 *
 * Coverage (single-bar net-OI layout):
 *   - empty / cold-start payloads return null
 *   - em_upper / em_lower / spot all surface as markLine entries with
 *     the right dash style
 *   - single net-OI series carries `[call_oi - put_oi, strike]` tuples
 *   - bar tint follows hemisphere convention (positive net → blue,
 *     negative net → amber)
 *   - net-fresh-flow glyph fires above the visibility threshold and
 *     stays suppressed at/below it
 */

import { describe, expect, it } from "vitest";
import type {
  ProgramFlowState,
  StraddleChainResponse,
  StraddleStrikeRow,
} from "../../api/terminalTypes";
import { colors, withAlpha } from "../../styles/tokens";
import {
  buildStraddleMapOption,
  NET_FRESH_FLOW_GLYPH_MIN,
  NET_OI_ALPHA,
  netFreshFlow,
  netFreshFlowGlyph,
  netOi,
  netOiTint,
} from "./straddleMapHelpers";


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

  it("emits markLine entries for em_upper, em_lower, and spot", () => {
    const option = buildStraddleMapOption(snapshot());
    expect(option).not.toBeNull();
    // markLine lives on the single net-OI series.
    const series = option!.series as Array<{
      markLine?: { data?: Array<{ name?: string; yAxis?: number }> };
    }>;
    const markLines = series[0].markLine?.data ?? [];
    const names = markLines.map((m) => m.name);
    expect(names).toContain("em_upper");
    expect(names).toContain("em_lower");
    expect(names).toContain("spot");
    expect(markLines.find((m) => m.name === "em_upper")?.yAxis).toBe(5202);
    expect(markLines.find((m) => m.name === "em_lower")?.yAxis).toBe(5158);
    expect(markLines.find((m) => m.name === "spot")?.yAxis).toBe(5180);
  });

  it("renders em markLines as dashed and spot markLine as solid", () => {
    const option = buildStraddleMapOption(snapshot());
    const markLines = (option!.series as Array<{
      markLine?: {
        data?: Array<{ name?: string; lineStyle?: { type?: string } }>;
      };
    }>)[0].markLine!.data!;
    expect(markLines.find((m) => m.name === "em_upper")?.lineStyle?.type).toBe(
      "dashed",
    );
    expect(markLines.find((m) => m.name === "em_lower")?.lineStyle?.type).toBe(
      "dashed",
    );
    expect(markLines.find((m) => m.name === "spot")?.lineStyle?.type).toBe(
      "solid",
    );
  });

  it("omits a markLine for any null em / spot field (cold-start defense)", () => {
    const option = buildStraddleMapOption(
      snapshot({ em_lower: null, spot: null }),
    );
    const markLines = (option!.series as Array<{
      markLine?: { data?: Array<{ name?: string }> };
    }>)[0].markLine!.data!;
    const names = markLines.map((m) => m.name);
    expect(names).toContain("em_upper");
    expect(names).not.toContain("em_lower");
    expect(names).not.toContain("spot");
  });

  it("emits a single net-OI bar series with signed [call_oi - put_oi, strike] tuples", () => {
    const option = buildStraddleMapOption(snapshot());
    const series = option!.series as Array<{
      name?: string;
      data?: Array<{ value?: [number, number] }>;
    }>;
    // Single-bar layout: exactly one bar series, no separate puts series.
    expect(series).toHaveLength(1);
    expect(series[0].name).toBe("net_oi");
    const values = series[0].data!.map((d) => d.value);
    expect(values).toEqual([
      [-700, 5160], // 500 - 1200 → put-dominant
      [400, 5180], //  1500 - 1100 → call-dominant
      [700, 5200], //  1300 - 600 → call-dominant
    ]);
  });

  it("packs the strike value into the second slot of each data tuple", () => {
    // Tooltip lookup pulls the strike out of `data.value[1]` — if a
    // refactor swaps the slot order the tooltip looks up nonsense.
    const option = buildStraddleMapOption(snapshot());
    const data = (option!.series as Array<{
      data?: Array<{ value?: [number, number] }>;
    }>)[0].data!;
    expect(data[0].value![1]).toBe(5160);
    expect(data[1].value![1]).toBe(5180);
    expect(data[2].value![1]).toBe(5200);
  });

  it("tints call-dominant bars accentBlue and put-dominant bars accentAmber", () => {
    const option = buildStraddleMapOption(snapshot());
    const data = (option!.series as Array<{
      data?: Array<{ itemStyle?: { color?: string } }>;
    }>)[0].data!;
    // 5160 net=-700 → amber, 5180 net=+400 → blue, 5200 net=+700 → blue.
    expect(data[0].itemStyle?.color).toBe(
      withAlpha(colors.accentAmber, NET_OI_ALPHA),
    );
    expect(data[1].itemStyle?.color).toBe(
      withAlpha(colors.accentBlue, NET_OI_ALPHA),
    );
    expect(data[2].itemStyle?.color).toBe(
      withAlpha(colors.accentBlue, NET_OI_ALPHA),
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
    // 5180 → ▲ green opening.
    expect(data[0].label?.show).toBe(true);
    expect(data[0].label?.formatter).toBe("▲");
    expect(data[0].label?.color).toBe(colors.accentGreen);
    // 5160 → ▼ red closing.
    expect(data[1].label?.show).toBe(true);
    expect(data[1].label?.formatter).toBe("▼");
    expect(data[1].label?.color).toBe(colors.accentRed);
    // 5200 → no glyph (below threshold).
    expect(data[2].label?.show).toBe(false);
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
