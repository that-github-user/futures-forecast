/**
 * Tests for the StraddleMapChart option-builder.
 *
 * The React component is a thin wrapper over `buildStraddleMapOption`
 * — we pin the option-builder directly since the project has no
 * @testing-library/react setup and rendering ECharts under happy-dom
 * requires a real canvas. The builder is pure, so the markLines /
 * series shape can be asserted without any DOM.
 *
 * Coverage:
 *   - empty / cold-start payloads return null
 *   - em_upper / em_lower / spot all surface as markLine entries with
 *     the right dash style
 *   - call/put series carry signed OI on opposite x-axis sides
 *   - fresh-flow tint maps positive→green, negative→red, null→base
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
  FRESH_FLOW_ALPHA,
  freshFlowGlyph,
  freshFlowTint,
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
      strike({ strike: 5160, call_oi: 500, put_oi: 1200 }),
      strike({ strike: 5180, call_oi: 1500, put_oi: 1100 }),
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
    // markLine lives on the first (calls) series.
    const series = option!.series as Array<{
      markLine?: { data?: Array<{ name?: string; yAxis?: number }> };
    }>;
    const markLines = series[0].markLine?.data ?? [];
    const names = markLines.map((m) => m.name);
    expect(names).toContain("em_upper");
    expect(names).toContain("em_lower");
    expect(names).toContain("spot");
    // Each markLine pins to the correct yAxis value.
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
    // Partial null: em_upper present but em_lower null. The remaining
    // markLines should still render (graceful degradation).
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

  it("emits two bar series — calls (positive x) and puts (negative x)", () => {
    const option = buildStraddleMapOption(snapshot());
    const series = option!.series as Array<{
      name?: string;
      data?: Array<{ value?: [number, number] }>;
    }>;
    expect(series).toHaveLength(2);
    expect(series[0].name).toBe("calls");
    expect(series[1].name).toBe("puts");
    // Calls: positive OI (call_oi value), puts: negated OI.
    const callValues = series[0].data!.map((d) => d.value![0]);
    const putValues = series[1].data!.map((d) => d.value![0]);
    expect(callValues).toEqual([500, 1500, 1300]);
    expect(putValues).toEqual([-1200, -1100, -600]);
  });

  it("packs the strike value into the second slot of each data tuple", () => {
    // The tooltip lookup pulls the strike out of `data.value[1]`,
    // so the order matters — if a refactor swaps them, the tooltip
    // shows the OI as the strike and looks up nonsense.
    const option = buildStraddleMapOption(snapshot());
    const callData = (option!.series as Array<{
      data?: Array<{ value?: [number, number] }>;
    }>)[0].data!;
    expect(callData[0].value![1]).toBe(5160);
    expect(callData[1].value![1]).toBe(5180);
    expect(callData[2].value![1]).toBe(5200);
  });
});


describe("freshFlowTint", () => {
  const base = withAlpha(colors.accentBlue, 0.55);

  it("returns the base color when flow is null", () => {
    expect(freshFlowTint(null, base)).toBe(base);
  });

  it("returns the base color when flow is zero", () => {
    expect(freshFlowTint(0, base)).toBe(base);
  });

  it("returns an alpha-blended green for positive flow (opening)", () => {
    // Symmetric-alpha contract (R2 NIT 1): opening + closing tints
    // both use the shared FRESH_FLOW_ALPHA so the chart doesn't
    // shout one direction louder than the other.
    expect(freshFlowTint(500, base)).toBe(
      withAlpha(colors.accentGreen, FRESH_FLOW_ALPHA),
    );
  });

  it("returns an alpha-blended red for negative flow (closing)", () => {
    expect(freshFlowTint(-500, base)).toBe(
      withAlpha(colors.accentRed, FRESH_FLOW_ALPHA),
    );
  });

  it("opening and closing tints share the same alpha byte", () => {
    // Symmetry invariant — the last two hex digits (alpha byte) on
    // open vs close should match. Catches a future drift that
    // re-introduces the saturated-green asymmetry the review flagged.
    const open = freshFlowTint(500, base);
    const close = freshFlowTint(-500, base);
    expect(open.slice(-2)).toBe(close.slice(-2));
  });
});


describe("freshFlowGlyph (colorblind cue)", () => {
  it("returns an empty string for null flow", () => {
    expect(freshFlowGlyph(null)).toBe("");
  });

  it("returns an empty string for zero flow", () => {
    expect(freshFlowGlyph(0)).toBe("");
  });

  it("returns the up-triangle glyph for opening flow", () => {
    expect(freshFlowGlyph(100)).toBe("▲");
  });

  it("returns the down-triangle glyph for closing flow", () => {
    expect(freshFlowGlyph(-100)).toBe("▼");
  });
});


describe("buildStraddleMapOption — fresh-flow labels", () => {
  it("emits a per-point label glyph on bars with non-null fresh-flow", () => {
    // Strikes carrying opening / closing flow should surface a label
    // glyph on the bar; strikes with null flow should not.
    const option = buildStraddleMapOption(
      snapshot({
        strikes: [
          // Open call-side flow: expect ▲ on the call bar.
          strike({ strike: 5180, fresh_flow_call: 250, fresh_flow_put: null }),
          // Close put-side flow: expect ▼ on the put bar.
          strike({ strike: 5160, fresh_flow_call: null, fresh_flow_put: -120 }),
          // No flow either side: both bars should suppress the label.
          strike({ strike: 5200, fresh_flow_call: null, fresh_flow_put: null }),
        ],
      }),
    );
    const series = option!.series as Array<{
      data?: Array<{
        label?: { show?: boolean; formatter?: string };
      }>;
    }>;
    const callLabels = series[0].data!.map((d) => d.label);
    const putLabels = series[1].data!.map((d) => d.label);

    // Call bar at 5180 — opening flow, ▲.
    expect(callLabels[0]?.show).toBe(true);
    expect(callLabels[0]?.formatter).toBe("▲");
    // Put bar at 5160 — closing flow, ▼.
    expect(putLabels[1]?.show).toBe(true);
    expect(putLabels[1]?.formatter).toBe("▼");
    // The null-flow strike's labels must be suppressed (show=false).
    expect(callLabels[2]?.show).toBe(false);
    expect(putLabels[2]?.show).toBe(false);
  });
});
