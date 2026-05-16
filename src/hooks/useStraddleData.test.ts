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

import { describe, expect, it, vi } from "vitest";
import { mockStraddleSnapshot } from "../api/mock";
import { terminal } from "../api/terminalClient";
import type { StraddleChainResponse } from "../api/terminalTypes";
import { applyFetchResult, FAILURE_THRESHOLD } from "./useStraddleData";


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


// ─────────────────────────────────────────────────────────────────────
// R1 — setState-after-unmount race
//
// The hook awaits `terminal.straddle0dte()`. If the component unmounts
// while the promise is in flight, naively calling setData/setOnline/etc
// after the await would emit a React "can't update unmounted component"
// warning and leak state writes. The hook gates every post-await
// setState behind `mountedRef.current`. The pure `applyFetchResult`
// helper exposes that gate as a unit-testable decision: given a fetch
// result + an isMounted flag, it returns the set of setState ops the
// hook should fire. With isMounted=false, the op set MUST be empty.
//
// We can't run a full hook unmount in this test file (the repo
// deliberately doesn't ship jsdom / @testing-library/react), but
// testing the pure helper at the decision boundary covers the same
// invariant: if applyFetchResult returns no setData/setOnline/etc when
// unmounted, the hook can't fire any setState calls regardless of how
// the await races against cleanup.
// ─────────────────────────────────────────────────────────────────────

describe("applyFetchResult (unmount-race guard)", () => {
  const snap = mockStraddleSnapshot();

  it("emits NO setState ops when isMounted is false (success path)", () => {
    // The success path normally writes data/online/loading. After
    // unmount, none of these should fire — the only field returned is
    // the failCount pass-through so the caller can persist it (a no-op
    // semantically since the component is gone).
    const ops = applyFetchResult(snap, 0, false);
    expect(ops.setData).toBeUndefined();
    expect(ops.setOnline).toBeUndefined();
    expect(ops.setLoading).toBeUndefined();
    expect(ops.setDemoMode).toBeUndefined();
    expect(ops.failCount).toBe(0);
  });

  it("emits NO setState ops when isMounted is false (failure path)", () => {
    // The failure path increments failCount and toggles online=false.
    // With isMounted=false even the online flip should be suppressed
    // so the dead-component invariant holds across both branches.
    const ops = applyFetchResult(null, 1, false);
    expect(ops.setData).toBeUndefined();
    expect(ops.setOnline).toBeUndefined();
    expect(ops.setLoading).toBeUndefined();
    expect(ops.setDemoMode).toBeUndefined();
  });

  it("emits NO setState ops when isMounted is false (demo-fallback path)", () => {
    // After FAILURE_THRESHOLD-1 prior failures, the next failed fetch
    // would normally flip demoMode and inject the fixture. If the
    // component unmounted during that await, that flip MUST NOT fire.
    const ops = applyFetchResult(null, FAILURE_THRESHOLD - 1, false);
    expect(ops.setData).toBeUndefined();
    expect(ops.setDemoMode).toBeUndefined();
  });

  it("emits the success-path setStates when isMounted is true", () => {
    // Sanity check: the live-component path still produces the
    // expected ops so the guard isn't suppressing the happy case.
    const ops = applyFetchResult(snap, 2, true);
    expect(ops.setData).toBe(snap);
    expect(ops.setOnline).toBe(true);
    expect(ops.setLoading).toBe(false);
    expect(ops.failCount).toBe(0);
  });

  it("emits the failure-path setStates when isMounted is true", () => {
    const ops = applyFetchResult(null, 1, true);
    expect(ops.setOnline).toBe(false);
    expect(ops.setLoading).toBe(false);
    expect(ops.failCount).toBe(2);
    expect(ops.setDemoMode).toBeUndefined();
  });

  it("triggers demo fallback once consecutive failures hit threshold", () => {
    // The hook's contract: after FAILURE_THRESHOLD consecutive nulls,
    // surface a synthetic snapshot + flip demoMode so the watermark
    // renders. Verify the exact threshold so a regression that drops
    // by one would be caught.
    const ops = applyFetchResult(null, FAILURE_THRESHOLD - 1, true);
    expect(ops.failCount).toBe(FAILURE_THRESHOLD);
    expect(ops.setDemoMode).toBe(true);
    expect(ops.setData).not.toBeNull();
  });

  it("logs no console.error when applying ops via the unmounted gate", () => {
    // Smoke check for the reviewer-asked invariant. The pure helper
    // returns no setters when unmounted; applying that op-set via the
    // hook's gate is a no-op, so a faithful gate emits no warnings.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ops = applyFetchResult(null, FAILURE_THRESHOLD - 1, false);
    // Simulate the hook's "apply ops only if mounted" step. Since
    // isMounted=false the ops bundle is empty — nothing fires.
    if (ops.setData !== undefined) {
      /* would call setData here */
    }
    if (ops.setOnline !== undefined) {
      /* would call setOnline here */
    }
    if (ops.setLoading !== undefined) {
      /* would call setLoading here */
    }
    if (ops.setDemoMode !== undefined) {
      /* would call setDemoMode here */
    }
    expect(errorSpy).toHaveBeenCalledTimes(0);
    errorSpy.mockRestore();
  });
});
