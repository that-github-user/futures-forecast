// @vitest-environment node
//
// Covers the two helpers added for LiveCountdown — etSecondsOfDay and
// parseHHMMToSeconds. The larger lifecycle state machine is verified
// via the existing DCSignalsTab integration and by code review.

import { describe, expect, it } from "vitest";
import { deriveLifecycle, etSecondsOfDay, parseHHMMToSeconds } from "./dcLifecycle";
import type { DCStrategySpec } from "../api/dcTypes";

// Minimal spec builder — only the fields deriveLifecycle actually reads.
function spec(entryTimesET: string[], entryDays: number[] = [0, 1, 2, 3, 4]): DCStrategySpec {
  return {
    name: "t",
    entry_days: entryDays,
    entry_times: entryTimesET,
    entry_window_end: null,
    profit_target_pct: 10,
    sl_ratio_min: null,
    sl_ratio_exit: null,
  } as unknown as DCStrategySpec;
}

// Build a Date at a specific ET wall-clock time on 2026-04-22 (Wed, EDT).
// April is always EDT, so the offset is fixed at -04:00.
function atET(hhmm: string, offsetSec = 0): Date {
  const base = new Date(`2026-04-22T${hhmm}:00-04:00`).valueOf();
  return new Date(base + offsetSec * 1000);
}

describe("etSecondsOfDay", () => {
  it("midnight UTC in March maps to 20:00 ET (EDT UTC-4)", () => {
    // 2026-03-20 00:00:00 UTC === 2026-03-19 20:00:00 ET (DST active)
    const d = new Date("2026-03-20T00:00:00Z");
    expect(etSecondsOfDay(d)).toBe(20 * 3600);
  });

  it("midnight UTC in January maps to 19:00 ET (EST UTC-5)", () => {
    const d = new Date("2026-01-15T00:00:00Z");
    expect(etSecondsOfDay(d)).toBe(19 * 3600);
  });

  it("14:30 ET round-trips via UTC", () => {
    // 2026-04-21 18:30 UTC (DST, UTC-4) === 14:30 ET
    const d = new Date("2026-04-21T18:30:00Z");
    expect(etSecondsOfDay(d)).toBe(14 * 3600 + 30 * 60);
  });

  it("handles DST spring-forward correctly", () => {
    // 2026-03-08 07:00 UTC — the instant when DST begins in US.
    // Before: 02:00 EST; official wall-clock at that instant = 03:00 EDT.
    // Intl should report 03:00 ET (= 10800s).
    const d = new Date("2026-03-08T07:00:00Z");
    expect(etSecondsOfDay(d)).toBe(3 * 3600);
  });
});

describe("deriveLifecycle: firing state is post-entry only", () => {
  // The whole point of this fix: the daemon's cron fires at HH:MM:00 and
  // then takes ~10-20s of work before the order actually submits. Showing
  // "FIRING NOW" *before* HH:MM misleads the viewer into thinking an order
  // has gone out when in reality the daemon hasn't even received the tick.
  // These tests pin that: pre-entry = imminent, post-entry = firing.

  const s = spec(["09:45"], [0, 1, 2, 3, 4]);

  it("30s before entry → imminent, NOT firing", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:44", 30));
    expect(info.state).toBe("imminent");
  });

  it("15s before entry → imminent, NOT firing", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:44", 45));
    expect(info.state).toBe("imminent");
  });

  it("1s before entry → imminent, NOT firing", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:44", 59));
    expect(info.state).toBe("imminent");
  });

  it("exactly at entry time → firing", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:45"));
    expect(info.state).toBe("firing");
  });

  it("15s after entry → firing", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:45", 15));
    expect(info.state).toBe("firing");
  });

  it("30s after entry → firing (boundary, inclusive)", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:45", 30));
    expect(info.state).toBe("firing");
  });

  it("31s after entry → recently_fired, not firing", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:45", 31));
    expect(info.state).toBe("recently_fired");
  });

  it("2 min before entry with GO → imminent (unchanged)", () => {
    const info = deriveLifecycle(s, "GO", false, atET("09:43"));
    expect(info.state).toBe("imminent");
  });

  it("SKIP signal 20s before entry → not_fired_yet (no false firing)", () => {
    const info = deriveLifecycle(s, "SKIP", false, atET("09:44", 40));
    expect(info.state).toBe("not_fired_yet");
  });
});

describe("parseHHMMToSeconds", () => {
  it("parses 09:32", () => {
    expect(parseHHMMToSeconds("09:32")).toBe(9 * 3600 + 32 * 60);
  });

  it("parses 00:00 as 0", () => {
    expect(parseHHMMToSeconds("00:00")).toBe(0);
  });

  it("parses 16:00 (RTH close)", () => {
    expect(parseHHMMToSeconds("16:00")).toBe(16 * 3600);
  });

  it("zero-fills single-digit hours/minutes gracefully", () => {
    // The daemon emits zero-padded HH:MM, but make sure a stray "9:5"
    // doesn't explode — parseInt handles it.
    expect(parseHHMMToSeconds("9:5")).toBe(9 * 3600 + 5 * 60);
  });
});

describe("deriveLifecycle: today_outcome blacklist-on-entered semantics (#277)", () => {
  // The fix: post-window state should reflect what the DAEMON did,
  // not what the ensemble signal said. Frontend rule is to blacklist
  // `entered` — every other outcome value means "didn't enter."

  const s = spec(["09:45"], [0, 1, 2, 3, 4]);

  // Use a time past the 10-minute recently_fired window so we land
  // in the terminal post-window branch (passed_will_fire vs
  // passed_skipped) rather than recently_fired vs passed_skipped.
  const POST_WINDOW = atET("11:00");  // 1h 15min past entry

  it("outcome=entered → passed_will_fire (daemon entered)", () => {
    const info = deriveLifecycle(s, "GO", false, POST_WINDOW, "entered");
    expect(info.state).toBe("passed_will_fire");
    expect(info.todayOutcome).toBe("entered");
  });

  it("outcome=blocked_sl_gate → passed_skipped (operator-reported case)", () => {
    // The 2026-05-12 case: GO signal but SL gate failed. Pre-#277 this
    // rendered as "Should have entered earlier" — wrong; daemon
    // correctly skipped.
    const info = deriveLifecycle(
      s, "GO", false, POST_WINDOW, "blocked_sl_gate",
      "SL ratio 0.65 below 0.70 minimum",
    );
    expect(info.state).toBe("passed_skipped");
    expect(info.todayOutcome).toBe("blocked_sl_gate");
    expect(info.todayOutcomeReason).toBe("SL ratio 0.65 below 0.70 minimum");
  });

  it("outcome=skipped_signal → passed_skipped", () => {
    const info = deriveLifecycle(s, "SKIP", false, POST_WINDOW, "skipped_signal");
    expect(info.state).toBe("passed_skipped");
  });

  it("outcome=blocked_margin → passed_skipped", () => {
    // Signal-side gate. The daemon DECIDED not to enter — passed_skipped
    // is correct. (Contrast with blocked_order below, which is the
    // broker-side failure case where the daemon DID attempt to enter.)
    const info = deriveLifecycle(s, "GO", false, POST_WINDOW, "blocked_margin");
    expect(info.state).toBe("passed_skipped");
  });

  it("outcome=blocked_entries_disabled → passed_will_fire, NOT passed_skipped", () => {
    // The 2026-08-01 DC retirement. A GO+ genuinely fired; we declined to
    // trade it because the product is retired. Rendering it identically to
    // a SKIP day ("NO FIRE", dimmed to 55%) misreports the session — the
    // operator's framing is "we should have entered, we simply chose not
    // to." So it lands in the fired family and stays highlighted; the chip
    // is relabelled to "NOT TRADED" (chipPresentation) so nothing claims
    // an order went out.
    const info = deriveLifecycle(
      s, "GO_PLUS", false, POST_WINDOW, "blocked_entries_disabled",
      "DC entry disabled by config (signal was GO_PLUS)",
    );
    expect(info.state).toBe("passed_will_fire");
    expect(info.state).not.toBe("passed_skipped");
    expect(info.todayOutcome).toBe("blocked_entries_disabled");
  });

  it("blocked_entries_disabled is fired-family inside the 10-min window too", () => {
    // Guards the recently_fired branch, which is a separate callsite of
    // shouldRenderAsFired from the terminal post-window one above.
    const info = deriveLifecycle(
      s, "GO_PLUS", false, atET("09:50"), "blocked_entries_disabled",
    );
    expect(info.state).toBe("recently_fired");
  });

  it("does not drag other blocked_* outcomes into the fired family", () => {
    // The retirement case is a named exception, not a loosening of the
    // blacklist-on-entered rule.
    for (const outcome of ["blocked_sl", "blocked_vix", "blocked_direction",
                           "blocked_duplicate", "blocked_entries_disabled_typo"]) {
      expect(deriveLifecycle(s, "GO", false, POST_WINDOW, outcome).state)
        .toBe("passed_skipped");
    }
  });

  it("outcome=blocked_order → passed_will_fire (broker fill failed)", () => {
    // The 2026-05-15 case: every signal-side gate cleared, the daemon
    // submitted the reprice ladder, but the broker side didn't cross
    // (or parked-at-ask exhausted). From the operator's anticipation
    // standpoint the strategy fired — graying out the card the
    // instant the ladder gave up penalizes viewing for an automation-
    // side failure that the trader's mental model treats as a real
    // play. Keep the card highlighted for the full 10min window
    // post-entry; the phantom row tracks the would-have-entered
    // position in parallel.
    const info = deriveLifecycle(s, "GO", false, POST_WINDOW, "blocked_order");
    expect(info.state).toBe("passed_will_fire");
    expect(info.todayOutcome).toBe("blocked_order");
  });

  it("outcome=blocked_order at T+30s → recently_fired (10min highlight window)", () => {
    // Within the 10-min recently_fired window, blocked_order must
    // render the same as `entered` would — the operator wants the
    // card highlighted for 10 minutes regardless of which side of
    // the broker fence the daemon ended up on.
    const info = deriveLifecycle(
      s, "GO", false, atET("09:46", 30), "blocked_order",
    );
    expect(info.state).toBe("recently_fired");
  });

  it("future unknown outcome (e.g. blocked_capital) → passed_skipped (forward-compat)", () => {
    // The whole point of the blacklist-`entered` rule: a daemon that
    // grows a new skip reason tomorrow MUST classify as passed_skipped
    // here without a frontend update.
    const info = deriveLifecycle(
      s, "GO", false, POST_WINDOW, "blocked_capital_constraint_xyz",
    );
    expect(info.state).toBe("passed_skipped");
  });

  it("outcome=null with GO signal → passed_will_fire (legacy fallback)", () => {
    // No outcome from API (cold-start, daemon was down, pre-#277
    // deploy). Falls back to ensemble signal — preserves prior
    // behavior so the card doesn't suddenly read NO FIRE.
    const info = deriveLifecycle(s, "GO", false, POST_WINDOW, null);
    expect(info.state).toBe("passed_will_fire");
  });

  it("outcome=null with SKIP signal → passed_skipped (legacy fallback)", () => {
    const info = deriveLifecycle(s, "SKIP", false, POST_WINDOW, null);
    expect(info.state).toBe("passed_skipped");
  });

  it("outcome flows into LifecycleInfo on every state (pre-window too)", () => {
    // Pre-window state — outcome is null in practice but we still
    // pass it through so a tooltip-capable UI surface has access.
    const info = deriveLifecycle(s, "GO", false, atET("09:00"), "entered");
    // 45min pre-entry → primed
    expect(info.state).toBe("primed");
    expect(info.todayOutcome).toBe("entered");
  });

  it("recently_fired 30-60s after entry + outcome=blocked_sl_gate → passed_skipped", () => {
    // Edge case: daemon writes signal_events row within ~30s of fire,
    // so the recently_fired window (30s-10min post-fire) sees the
    // outcome immediately. Card should flip from "FIRING" → "NO FIRE"
    // promptly, not wait 10min for the recently_fired window to close.
    const info = deriveLifecycle(
      s, "GO", false, atET("09:46", 30), "blocked_sl_gate",
    );
    expect(info.state).toBe("passed_skipped");
  });
});
