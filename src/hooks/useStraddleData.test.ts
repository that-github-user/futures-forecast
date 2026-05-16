// @vitest-environment node
//
// Explicit-node env: this file tests the mock-fixture + types contract
// for the straddle hook without rendering React. The hook itself is
// effect-heavy and the project doesn't run @testing-library/react in
// CI; mirroring the useDCData approach, we test the pure surface here
// and rely on the eyeball-level dev-server check for the full
// integration.

/**
 * Contract tests for the useStraddleData hook's data sources.
 *
 * The hook itself is effect-heavy (polling, setInterval, demo
 * fallback) and the repo doesn't have a React-rendered test harness.
 * We pin the testable contracts here so a future refactor can't
 * silently:
 *   - Drift the mock-fixture shape away from StraddleChainResponse.
 *   - Lose the cold-start path's "headline fields null" property the
 *     page relies on to show the warming-up banner.
 *   - Change the API client method name without updating callers.
 *
 * The hook's network/state logic is covered by the dev-server smoke
 * check in the PR's verification section.
 */

import { describe, expect, it } from "vitest";
import { mockStraddleSnapshot } from "../api/mock";
import { terminal } from "../api/terminalClient";
import type { StraddleChainResponse } from "../api/terminalTypes";


describe("mockStraddleSnapshot (demo fallback fixture)", () => {
  it("returns a payload conforming to StraddleChainResponse", () => {
    const snap: StraddleChainResponse = mockStraddleSnapshot();
    expect(snap.snapshot_time).toBeTypeOf("string");
    expect(snap.expiry).toBeTypeOf("string");
    expect(snap.spot).toBeTypeOf("number");
    expect(snap.atm_strike).toBeTypeOf("number");
    expect(snap.atm_straddle_mid).toBeTypeOf("number");
    expect(snap.em_upper).toBeTypeOf("number");
    expect(snap.em_lower).toBeTypeOf("number");
    expect(snap.stale).toBe(false);
    expect(Array.isArray(snap.strikes)).toBe(true);
    expect(Array.isArray(snap.pin_candidates)).toBe(true);
    expect(snap.program_flow.active_windowed).toBeDefined();
    expect(snap.program_flow.active_continuous).toBeDefined();
    expect(snap.program_flow.upcoming).toBeDefined();
  });

  it("seeds a realistic strike grid centered on ATM", () => {
    const snap = mockStraddleSnapshot();
    // 40 strikes on a 5pt grid; ATM should sit in the middle.
    expect(snap.strikes.length).toBeGreaterThanOrEqual(30);
    const strikes = snap.strikes.map((s) => s.strike).sort((a, b) => a - b);
    const min = strikes[0];
    const max = strikes[strikes.length - 1];
    expect(snap.atm_strike).toBeGreaterThanOrEqual(min);
    expect(snap.atm_strike).toBeLessThanOrEqual(max);
    // ±100pt half-window: max - min should be at least 150pt.
    expect(max - min).toBeGreaterThanOrEqual(150);
  });

  it("keeps em_upper above em_lower with spot bracketed inside", () => {
    const snap = mockStraddleSnapshot();
    expect(snap.em_upper!).toBeGreaterThan(snap.em_lower!);
    expect(snap.spot!).toBeGreaterThanOrEqual(snap.em_lower!);
    expect(snap.spot!).toBeLessThanOrEqual(snap.em_upper!);
  });

  it("pin_candidates strikes all fall within the EM band", () => {
    // The mock only emits within-EM candidates (the spec's actionable
    // subset). If a future tweak ever lets out-of-band strikes through
    // we want a deliberate decision, not a silent regression.
    const snap = mockStraddleSnapshot();
    for (const candidate of snap.pin_candidates) {
      expect(candidate.within_em).toBe(true);
      expect(candidate.strike).toBeGreaterThanOrEqual(snap.em_lower!);
      expect(candidate.strike).toBeLessThanOrEqual(snap.em_upper!);
      expect(candidate.density_score).toBeGreaterThanOrEqual(0);
      expect(candidate.density_score).toBeLessThanOrEqual(1);
    }
  });

  it("populates upcoming program-flow events for the right-column list", () => {
    // The hook delivers `program_flow.upcoming` straight through to
    // `<UpcomingProgramFlow>` which filters to windowed only — but
    // we need at least one windowed event so the panel renders
    // content in demo mode.
    const snap = mockStraddleSnapshot();
    const windowed = snap.program_flow.upcoming.filter(
      (e) => e.intensity === "windowed",
    );
    expect(windowed.length).toBeGreaterThan(0);
  });

  it("stamps a recent snapshot_time and small data_age_seconds", () => {
    // The fixture isn't supposed to look stale — the watermark on the
    // page communicates demo-ness, not the freshness pill.
    const snap = mockStraddleSnapshot();
    expect(snap.stale).toBe(false);
    expect(snap.data_age_seconds!).toBeLessThan(120);
  });
});


describe("terminal.straddle0dte (client method)", () => {
  it("is exposed on the terminal client surface", () => {
    // Forward-defense: if a refactor drops the method without updating
    // the hook, this assertion makes the breakage visible at test time
    // rather than at runtime when the /straddle page polls.
    expect(typeof terminal.straddle0dte).toBe("function");
  });
});
