// @vitest-environment node
//
// Tests for classifyFlatState / deriveScoreRenderState (#276).

import { describe, expect, it } from "vitest";
import {
  classifyFlatState,
  deriveScoreRenderState,
  MIXED_CONTRIBUTION_THRESHOLD,
} from "./synthesizerFlatState";
import type {
  SynthesizerData,
  SynthesizerContribution,
} from "../api/terminalTypes";

function contrib(
  system: SynthesizerContribution["system"],
  contribution: number,
): SynthesizerContribution {
  return {
    system,
    score: contribution,           // not used by the classifier
    contribution,
    share: contribution / 10,      // arbitrary; not used by the classifier
  };
}

function synth(partial: {
  score: number | null;
  bias?: SynthesizerData["bias"];
  overrides?: string[];
  contributions?: SynthesizerContribution[];
}): SynthesizerData {
  // SynthesizerData.score is typed as `number`, but the API may
  // emit null on cold-start / IBKR-disconnected paths. Cast through
  // unknown to allow tests to exercise the null branch through
  // classifyFlatState — the function explicitly handles
  // `synth.score == null`.
  return {
    score: partial.score as unknown as number,
    confirms: 0,
    overrides: partial.overrides ?? [],
    advisories: [],
    bias: partial.bias ?? "FLAT",
    conviction: "NONE",
    contributions: partial.contributions ?? [],
    score_history_4h: [],
  };
}

describe("classifyFlatState", () => {
  it("AWAITING when synth is null", () => {
    expect(classifyFlatState(null)).toBe("AWAITING");
  });

  it("AWAITING when synth is undefined", () => {
    expect(classifyFlatState(undefined)).toBe("AWAITING");
  });

  it("AWAITING when score is null", () => {
    expect(classifyFlatState(synth({ score: null }))).toBe("AWAITING");
  });

  it("BLOCKED when overrides are non-empty (FLAT)", () => {
    const s = synth({
      score: -0.2,
      bias: "FLAT",
      overrides: ["weekly-vwap-lost"],
    });
    expect(classifyFlatState(s)).toBe("BLOCKED");
  });

  it("BLOCKED when overrides are non-empty even with directional bias", () => {
    // The "score is a lie" case: synthesizer math says LONG, but an
    // override suppresses actionability. BLOCKED dominates.
    const s = synth({
      score: 2.1,
      bias: "LONG",
      overrides: ["backwardation"],
      contributions: [
        contrib("volatility", 5),
        contrib("structure", 3),
      ],
    });
    expect(classifyFlatState(s)).toBe("BLOCKED");
  });

  it("MIXED — operator-reported 2026-05-12 incident replay", () => {
    // Real synth output that motivated the task: vol=+3.15,
    // structure=-6.24*W = -12.49 contrib, levels=-3.75, breadth=+4.88.
    // Net score -0.24, bias FLAT, no overrides expected from this snippet.
    const s = synth({
      score: -0.24,
      bias: "FLAT",
      contributions: [
        contrib("volatility", 9.45),
        contrib("structure", -12.49),
        contrib("levels", -3.75),
        contrib("breadth", 4.88),
      ],
    });
    expect(classifyFlatState(s)).toBe("MIXED");
  });

  it("MIXED when min/max contributions straddle the threshold", () => {
    const s = synth({
      score: 0.05,
      contributions: [
        contrib("volatility", MIXED_CONTRIBUTION_THRESHOLD),
        contrib("structure", -MIXED_CONTRIBUTION_THRESHOLD),
      ],
    });
    expect(classifyFlatState(s)).toBe("MIXED");
  });

  it("NEUTRAL when all contributions are small", () => {
    const s = synth({
      score: -0.1,
      contributions: [
        contrib("volatility", 1.0),
        contrib("structure", -0.8),
        contrib("levels", 0.5),
        contrib("breadth", -1.1),
      ],
    });
    expect(classifyFlatState(s)).toBe("NEUTRAL");
  });

  it("NEUTRAL when contributions are aligned (all positive but small)", () => {
    const s = synth({
      score: 0.4,
      contributions: [
        contrib("volatility", 1.0),
        contrib("structure", 1.5),
        contrib("levels", 0.3),
        contrib("breadth", 0.7),
      ],
    });
    expect(classifyFlatState(s)).toBe("NEUTRAL");
  });

  it("NEUTRAL when only one side hits the threshold (not split)", () => {
    // Large positive but no large negative → not contested; aligned-bullish.
    const s = synth({
      score: 0.4,
      contributions: [
        contrib("volatility", 4.0),
        contrib("structure", 0.5),
      ],
    });
    expect(classifyFlatState(s)).toBe("NEUTRAL");
  });

  it("NEUTRAL when contributions array is empty (degenerate cold-start)", () => {
    const s = synth({ score: 0.0, contributions: [] });
    expect(classifyFlatState(s)).toBe("NEUTRAL");
  });
});

describe("deriveScoreRenderState", () => {
  it("directional LONG when bias=LONG and no overrides", () => {
    const s = synth({
      score: 1.5,
      bias: "LONG",
      contributions: [contrib("volatility", 4)],
    });
    expect(deriveScoreRenderState(s)).toEqual({
      kind: "directional",
      bias: "LONG",
    });
  });

  it("directional SHORT when bias=SHORT and no overrides", () => {
    const s = synth({ score: -1.5, bias: "SHORT" });
    expect(deriveScoreRenderState(s)).toEqual({
      kind: "directional",
      bias: "SHORT",
    });
  });

  it("flat AWAITING supersedes directional bias when score is null", () => {
    // Defensive — bias=LONG with score=null shouldn't happen but the
    // classifier must not render Buy/Sell on null data.
    const s = synth({ score: null, bias: "LONG" });
    expect(deriveScoreRenderState(s)).toEqual({
      kind: "flat",
      sub: "AWAITING",
    });
  });

  it("flat BLOCKED supersedes directional LONG when overrides active", () => {
    const s = synth({
      score: 2.0,
      bias: "LONG",
      overrides: ["weekly-vwap-lost"],
    });
    expect(deriveScoreRenderState(s)).toEqual({
      kind: "flat",
      sub: "BLOCKED",
    });
  });

  it("flat MIXED when bias=FLAT and contributions split", () => {
    const s = synth({
      score: -0.24,
      bias: "FLAT",
      contributions: [
        contrib("volatility", 5),
        contrib("structure", -5),
      ],
    });
    expect(deriveScoreRenderState(s)).toEqual({
      kind: "flat",
      sub: "MIXED",
    });
  });

  it("flat NEUTRAL when bias=FLAT and contributions aligned/small", () => {
    const s = synth({
      score: -0.05,
      bias: "FLAT",
      contributions: [contrib("volatility", 0.5)],
    });
    expect(deriveScoreRenderState(s)).toEqual({
      kind: "flat",
      sub: "NEUTRAL",
    });
  });

  it("AWAITING wins over BLOCKED when score is null (no data > override)", () => {
    // Bizarre but possible: synth response with score=null but
    // overrides somehow populated. Render AWAITING (no data is more
    // urgent than override; you can't action either way).
    const s = synth({
      score: null,
      overrides: ["weekly-vwap-lost"],
    });
    expect(deriveScoreRenderState(s)).toEqual({
      kind: "flat",
      sub: "AWAITING",
    });
  });
});
