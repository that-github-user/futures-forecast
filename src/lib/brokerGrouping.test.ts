/**
 * Tests for the Broker Reality panel's grouping + reconstruction math.
 *
 * Frozen real-data regression pin: the LIVE_* constants below come
 * from 2026-04-21 broker_state.json for the open 2/4 30/16 position.
 * Daemon recorded entry_debit $17.60, broker avg_costs reconstruct
 * to $17.6516 per spread → $0.05 drift (commission noise). This
 * value must remain stable across refactors — if you have a newer
 * snapshot, do NOT refresh these numbers; they lock the formula.
 */

import { describe, expect, it } from "vitest";
import type { DCBrokerPosition, DCPosition } from "../api/dcTypes";
import { brokerDebitPerSpread, groupBrokerLegs } from "./brokerGrouping";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FP_CID = 866415343;
const FC_CID = 874704772;
const BP_CID = 853890853;
const BC_CID = 873291358;

const LIVE_AVG_COSTS: Record<number, number> = {
  [FP_CID]: 1756.04288335,
  [FC_CID]: 300.37621665,
  [BP_CID]: 2909.62378335,
  [BC_CID]: 911.95711665,
};

function dcFixture(overrides: Partial<DCPosition> = {}): DCPosition {
  return {
    id: 2,
    position_uid: "2-4-30-16_2026-04-20",
    strategy_name: "2/4 30/16",
    signal: "GO",
    entry_time: "2026-04-20T10:15:00-04:00",
    entry_date: "2026-04-20",
    put_strike: 7050,
    call_strike: 7230,
    front_exp: "20260422",
    back_exp: "20260424",
    entry_debit: 17.60,
    quantity: 30,
    original_quantity: 30,
    front_put_conid: FP_CID,
    front_call_conid: FC_CID,
    back_put_conid: BP_CID,
    back_call_conid: BC_CID,
    spx_at_entry: 7089,
    status: "open",
    close_reason: null,
    close_time: null,
    close_pnl: null,
    broker_entry_debit: null,
    debit_drift: null,
    drift_reason: null,
    ...overrides,
  };
}

function legFixture(conId: number, position: number): DCBrokerPosition {
  return {
    account: "DUA088145",
    contract: {
      conId,
      symbol: "SPX",
      secType: "OPT",
      expiry: "20260422",
      strike: 7050,
      right: "P",
      tradingClass: "SPXW",
      multiplier: "100",
      currency: "USD",
    },
    position,
    avg_cost: LIVE_AVG_COSTS[conId] ?? 0,
  };
}

// ---------------------------------------------------------------------------
// groupBrokerLegs
// ---------------------------------------------------------------------------

describe("groupBrokerLegs", () => {
  it("groups four matching broker legs into one complete DC group", () => {
    const dc = dcFixture();
    const legs = [FP_CID, FC_CID, BP_CID, BC_CID].map((c) =>
      legFixture(c, c === FP_CID || c === FC_CID ? -30 : 30),
    );
    const { groups, unmatched, collisions } = groupBrokerLegs(legs, [dc]);
    expect(groups).toHaveLength(1);
    expect(groups[0].daemon.id).toBe(dc.id);
    expect(groups[0].legs).toHaveLength(4);
    expect(groups[0].complete).toBe(true);
    expect(unmatched).toHaveLength(0);
    expect(collisions).toHaveLength(0);
  });

  it("routes legs with no daemon match to unmatched", () => {
    const dc = dcFixture();
    const legs = [
      legFixture(FP_CID, -30),
      legFixture(999999999, 10),   // orphan
      legFixture(888888888, -5),   // orphan
    ];
    const { groups, unmatched } = groupBrokerLegs(legs, [dc]);
    expect(groups[0].legs).toHaveLength(1);
    expect(unmatched.map((u) => u.contract.conId)).toEqual([
      999999999, 888888888,
    ]);
  });

  it("marks a partial group (<4 legs) as incomplete", () => {
    const dc = dcFixture();
    // Only 2 of the 4 daemon legs are in the broker snapshot (e.g.
    // mid-close state).
    const legs = [legFixture(FP_CID, -30), legFixture(BP_CID, 30)];
    const { groups } = groupBrokerLegs(legs, [dc]);
    expect(groups).toHaveLength(1);
    expect(groups[0].complete).toBe(false);
    expect(groups[0].legs).toHaveLength(2);
  });

  it("detects conId collisions — two daemon rows claiming one leg", () => {
    // Review B1: deconflict failure would surface as two DCs sharing
    // a conid. First-claimer wins; the second's group ends up with
    // one fewer leg, and collisions[] flags the shared conid.
    const dcA = dcFixture({ id: 10 });
    const dcB = dcFixture({
      id: 20,
      strategy_name: "5/7dte",
      front_put_conid: FP_CID,   // steal DC A's front put
    });
    const legs = [FP_CID, FC_CID, BP_CID, BC_CID].map((c) =>
      legFixture(c, c === FP_CID || c === FC_CID ? -30 : 30),
    );
    const { groups, collisions } = groupBrokerLegs(legs, [dcA, dcB]);
    expect(collisions).toContain(FP_CID);
    // First-claimer (dcA) keeps the leg; dcB's group has no matched legs.
    const byId = Object.fromEntries(groups.map((g) => [g.daemon.id, g]));
    expect(byId[10].legs).toHaveLength(4);
    expect(byId[10].complete).toBe(true);
    expect(byId[20]).toBeUndefined();  // no legs routed to it
  });

  it("marks a group incomplete when 4 legs cover <4 roles (defense-in-depth)", () => {
    // Reachable only if legLookup's first-claimer collision rule ever
    // weakens (e.g. a future refactor allows a conId to map to
    // multiple roles). Pinning this asserts the role-coverage invariant
    // catches it instead of silently marking the group complete.
    //
    // We construct a "broken" scenario by giving the daemon row two
    // roles pointing at the same conid (back_call_conid = FC_CID).
    // First-claimer wins in legLookup: FC_CID stays mapped to
    // front_call, back_call role for FC_CID is a collision and is
    // skipped. With the other three roles intact, 4 broker legs would
    // still only cover 3 roles if FC_CID appears twice in the broker
    // snapshot — but IBKR won't duplicate a conId, so we get at most
    // 4 legs covering 3 distinct roles via the orphan path.
    //
    // Simpler direct construction: leave back_call_conid null (legacy
    // row), register 4 broker legs including the now-orphan BC_CID,
    // and verify the group has 3 legs + complete=false (not 4 +
    // complete=true).
    const dc = dcFixture({ back_call_conid: null });
    const legs = [FP_CID, FC_CID, BP_CID, BC_CID].map((c) =>
      legFixture(c, c === FP_CID || c === FC_CID ? -30 : 30),
    );
    const { groups, unmatched } = groupBrokerLegs(legs, [dc]);
    // 3 legs routed to the group (front_put, front_call, back_put),
    // BC_CID is orphaned. Group is incomplete.
    expect(groups[0].legs).toHaveLength(3);
    expect(groups[0].complete).toBe(false);
    expect(unmatched.map((u) => u.contract.conId)).toEqual([BC_CID]);
  });

  it("ignores null / zero / negative conids on the daemon row", () => {
    const dcLegacy = dcFixture({
      id: 3,
      front_put_conid: null,
      front_call_conid: 0,
      back_put_conid: -1,
      back_call_conid: BC_CID,
    });
    const legs = [legFixture(BC_CID, 30), legFixture(FP_CID, -30)];
    const { groups, unmatched } = groupBrokerLegs(legs, [dcLegacy]);
    expect(groups[0].legs.map((l) => l.contract.conId)).toEqual([BC_CID]);
    expect(unmatched.map((u) => u.contract.conId)).toEqual([FP_CID]);
  });

  it("sorts groups deterministically by daemon id", () => {
    // Review N5: Map iteration order depends on broker-leg arrival
    // order. Enforce ascending daemon.id so rows don't reshuffle
    // between polls when the sidecar's leg order changes.
    const dcA = dcFixture({ id: 42, front_put_conid: 1001,
                            front_call_conid: 1002, back_put_conid: 1003,
                            back_call_conid: 1004 });
    const dcB = dcFixture({ id: 7, front_put_conid: 2001,
                            front_call_conid: 2002, back_put_conid: 2003,
                            back_call_conid: 2004 });
    // Broker sidecar order: dcA's legs first.
    const legs = [legFixture(1001, -30), legFixture(2001, -30)];
    // Re-map avg_cost for the synthetic conids (not in LIVE_AVG_COSTS).
    legs.forEach((l) => { l.avg_cost = 100; });
    const { groups } = groupBrokerLegs(legs, [dcA, dcB]);
    expect(groups.map((g) => g.daemon.id)).toEqual([7, 42]);
  });

  it("handles empty inputs gracefully", () => {
    expect(groupBrokerLegs([], [])).toEqual({
      groups: [], unmatched: [], collisions: [],
    });
    expect(groupBrokerLegs([legFixture(999, 5)], []).unmatched)
      .toHaveLength(1);
  });
});


// ---------------------------------------------------------------------------
// brokerDebitPerSpread — frozen regression pin against live 2026-04-21 data
// ---------------------------------------------------------------------------

describe("brokerDebitPerSpread", () => {
  it("reconstructs the spread debit from the four live avg_costs", () => {
    const dc = dcFixture();
    const legs = [FP_CID, FC_CID, BP_CID, BC_CID].map((c) =>
      legFixture(c, c === FP_CID || c === FC_CID ? -30 : 30),
    );
    const { groups } = groupBrokerLegs(legs, [dc]);
    const debit = brokerDebitPerSpread(groups[0]);
    expect(debit).not.toBeNull();
    // (2909.62 + 911.96) - (1756.04 + 300.38) = 1765.16 / 100 = 17.6516
    expect(debit!).toBeCloseTo(17.6516, 3);
  });

  it("returns null on partial groups (<4 legs)", () => {
    const dc = dcFixture();
    const legs = [legFixture(FP_CID, -30), legFixture(BP_CID, 30)];
    const { groups } = groupBrokerLegs(legs, [dc]);
    expect(brokerDebitPerSpread(groups[0])).toBeNull();
  });

  it("returns null when a daemon leg conid is unassigned", () => {
    const dc = dcFixture({ back_call_conid: null });
    const legs = [FP_CID, FC_CID, BP_CID].map((c) =>
      legFixture(c, c === FP_CID || c === FC_CID ? -30 : 30),
    );
    const { groups } = groupBrokerLegs(legs, [dc]);
    // Group is incomplete (only 3 legs matched), so null regardless.
    expect(brokerDebitPerSpread(groups[0])).toBeNull();
  });

  it("matches the backend formula exactly", () => {
    // Mirrors automated-dc-entry/api/app.py::_enrich_with_broker_debit
    // and test_debit_drift.py. Any change to one must be applied to
    // the other, or the grouped-table cell and the daemon-tracked
    // table's Broker Δ column will ship different numbers.
    const dc = dcFixture();
    const legs = [FP_CID, FC_CID, BP_CID, BC_CID].map((c) =>
      legFixture(c, c === FP_CID || c === FC_CID ? -30 : 30),
    );
    const { groups } = groupBrokerLegs(legs, [dc]);
    const debit = brokerDebitPerSpread(groups[0])!;
    const backendFormula =
      ((LIVE_AVG_COSTS[BP_CID] + LIVE_AVG_COSTS[BC_CID]) -
       (LIVE_AVG_COSTS[FP_CID] + LIVE_AVG_COSTS[FC_CID])) / 100;
    expect(debit).toBe(backendFormula);
  });
});
