/**
 * Tests for the signal-events retain-vs-clear decision.
 *
 * The hook itself needs a DOM renderer, but the contract that matters is
 * pure and is extracted as `signalEventsDecision`. What it protects: the
 * Events tab leads with three 22px verdict counts, so an empty list is no
 * longer a quiet corner of the page — it is the page's loudest statement.
 * One dropped 30s poll on a WiFi-only tunnelled box used to blank the
 * array and paint "0 IN · 0 SHOULD BE IN · 0 NO TRADE" as fact, next to
 * "No events on <date>." The audit log is append-only, so a beat-stale
 * view is strictly more truthful than a blank one.
 *
 * The one case that must still clear is a filter change: rows fetched for
 * a different date or strategy answer a different question and must never
 * sit under the new filter's label.
 */

import { describe, expect, it } from "vitest";
import type { DCSignalEvent } from "../api/dcTypes";
import { signalEventsDecision } from "./useDCSignalEvents";

function event(overrides: Partial<DCSignalEvent> = {}): DCSignalEvent {
  return {
    id: 1,
    // Placeholder, not a real strategy name — this repo is public and
    // strategy names are redacted here by policy. The hook is
    // name-agnostic, so any string exercises the same paths.
    strategy_name: "STRAT-A",
    signal: "GO",
    outcome: "blocked_entries_disabled",
    outcome_reason: "entries disabled by config",
    entry_time: "2026-08-03T09:50:00-04:00",
    entry_date: "2026-08-03",
    ...overrides,
  } as DCSignalEvent;
}

describe("signalEventsDecision", () => {
  it("a payload always replaces, landed or not", () => {
    expect(signalEventsDecision([event()], false)).toBe("replace");
    expect(signalEventsDecision([event()], true)).toBe("replace");
  });

  it("an empty payload is still a payload — not an outage", () => {
    // A genuinely quiet session returns []. That must overwrite whatever
    // we held, or a strategy filter change from a busy day to a quiet one
    // would leave the busy day's rows on screen forever.
    expect(signalEventsDecision([], true)).toBe("replace");
  });

  it("null after this scope already loaded → retain (THE poll-blip case)", () => {
    // The load-bearing one. The rows are an append-only audit record; they
    // do not decay. Blanking them turns a 30s network blip into three
    // confident zeros in the operator's headline.
    expect(signalEventsDecision(null, true)).toBe("retain");
  });

  it("null before this scope loaded anything → clear", () => {
    // First poll after a date/strategy change failed. Whatever we hold was
    // fetched for the OLD filter, so showing it under the new filter's
    // label would attribute one session's events to another.
    expect(signalEventsDecision(null, false)).toBe("clear");
  });
});
