/**
 * Tests for the brokerState staleness-clear decision (#40 N6).
 *
 * The underlying useDCData hook is hard to test without a DOM
 * renderer, but the load-bearing staleness contract is a pure
 * function — extracted as `brokerStateDecision` so it can be pinned
 * here. The three branches map 1:1 to the operator-visible outcomes:
 *   - "update" → fresh snapshot lands on screen
 *   - "clear"  → API offline; the panel MUST stop showing cached
 *                snapshot_at as if it were fresh (that's the whole
 *                point of the freshness promise)
 *   - "retain" → API online but sidecar momentarily missing; don't
 *                blank the panel every poll-blip, let the age-color
 *                indicator shade toward red instead.
 */

import { describe, expect, it } from "vitest";
import type { DCBrokerState } from "../api/dcTypes";
import { brokerStateDecision } from "./useDCData";

function fakeBrokerState(overrides: Partial<DCBrokerState> = {}): DCBrokerState {
  return {
    snapshot_at: "2026-04-21T12:00:00-04:00",
    positions: [],
    open_orders: [],
    ...overrides,
  };
}

describe("brokerStateDecision", () => {
  it("fresh payload + API online → update", () => {
    expect(brokerStateDecision(fakeBrokerState(), true)).toBe("update");
  });

  it("fresh payload + API offline → still update", () => {
    // If we somehow got a payload back while the apiOnline flag says
    // false, trust the payload. In practice online is derived from
    // the summary endpoint succeeding, so this shouldn't fire — but
    // the decision is still deterministic.
    expect(brokerStateDecision(fakeBrokerState(), false)).toBe("update");
  });

  it("null payload + API offline → clear (staleness contract)", () => {
    // THE load-bearing case. The panel's age-color indicator would
    // otherwise shade a minutes-old cached snapshot as if it were
    // fresh. Clearing surfaces the "No snapshot available" empty
    // state, truthfully signaling the daemon isn't talking to us.
    expect(brokerStateDecision(null, false)).toBe("clear");
  });

  it("null payload + API online → retain (sidecar regen window)", () => {
    // Daemon restart: summary endpoint is back up (online=true) but
    // broker_state.json hasn't been rewritten yet. Keeping the prior
    // value means the operator sees slightly-old data with the age
    // indicator aging appropriately — better than a flash to empty
    // state every poll cycle during the 1-2 minute sidecar regen.
    expect(brokerStateDecision(null, true)).toBe("retain");
  });
});
