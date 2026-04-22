/**
 * Pure helpers for the Broker Reality panel's DC grouping.
 *
 * Extracted so the reconciliation math is unit-testable without
 * mounting React. The frontend `brokerDebitPerSpread` formula is
 * the mirror of the backend's `api/app.py::_enrich_with_broker_debit`
 * — any change to one must be applied to the other, or a single
 * DC position will show two different drift numbers (cell value
 * from the frontend, tooltip from the backend-precomputed field).
 */

import type { DCBrokerPosition, DCPosition } from "../api/dcTypes";

type LegRole = "front_put" | "front_call" | "back_put" | "back_call";

export interface BrokerDcGroup {
  daemon: DCPosition;
  legs: DCBrokerPosition[];       // 1-4 elements
  complete: boolean;              // all 4 legs present
}

export interface GroupedBrokerLegs {
  groups: BrokerDcGroup[];
  unmatched: DCBrokerPosition[];
  /** conIds claimed by more than one open daemon row. Never empty
   *  except as a bug signal: two positions sharing a leg means the
   *  deconflict logic failed, or the daemon double-booked. Caller
   *  should surface this visibly. */
  collisions: number[];
}

/** Partition broker legs into DC groups (matched to an open daemon
 *  position by conId) + orphan legs (no daemon claims them) +
 *  collisions (a conId claimed by more than one daemon row).
 *
 *  Single-account invariant: the daemon connects to exactly one IBKR
 *  account, so conId alone is a sufficient match key. Multi-account
 *  rollouts need `(account, conId)` tuple keys.
 *
 *  Collision policy: if two daemon rows claim the same conId, the
 *  FIRST one wins (stable — do not switch to last-wins). Losing
 *  daemon rows still appear as groups (possibly with <4 legs). The
 *  collided conId is reported in `collisions` for the UI to warn on. */
export function groupBrokerLegs(
  brokerLegs: DCBrokerPosition[],
  daemonPositions: DCPosition[],
): GroupedBrokerLegs {
  const legLookup = new Map<number, { dc: DCPosition; role: LegRole }>();
  const collisionsSet = new Set<number>();
  for (const dc of daemonPositions) {
    const entries: Array<[number | null, LegRole]> = [
      [dc.front_put_conid, "front_put"],
      [dc.front_call_conid, "front_call"],
      [dc.back_put_conid, "back_put"],
      [dc.back_call_conid, "back_call"],
    ];
    for (const [conid, role] of entries) {
      if (conid == null || conid <= 0) continue;
      if (legLookup.has(conid)) {
        // First-claimer wins. Remember the collision for the UI.
        collisionsSet.add(conid);
        continue;
      }
      legLookup.set(conid, { dc, role });
    }
  }

  const groupsByDcId = new Map<number, BrokerDcGroup>();
  const rolesByDcId = new Map<number, Set<LegRole>>();
  const unmatched: DCBrokerPosition[] = [];
  for (const bl of brokerLegs) {
    const link = legLookup.get(bl.contract.conId);
    if (!link) {
      unmatched.push(bl);
      continue;
    }
    const g = groupsByDcId.get(link.dc.id) ?? {
      daemon: link.dc, legs: [], complete: false,
    };
    g.legs.push(bl);
    groupsByDcId.set(link.dc.id, g);
    const roles = rolesByDcId.get(link.dc.id) ?? new Set<LegRole>();
    roles.add(link.role);
    rolesByDcId.set(link.dc.id, roles);
  }
  // "complete" = all four DC roles (front_put, front_call, back_put,
  // back_call) are covered — stricter than `legs.length === 4`. Given
  // legLookup's first-claimer collision rule, a group with 4 legs
  // already has 4 distinct conids → 4 distinct roles, so this is
  // defensive / explicit; it pins the invariant in one place so
  // future refactors of the collision rule don't silently weaken it.
  for (const g of groupsByDcId.values()) {
    const roles = rolesByDcId.get(g.daemon.id);
    g.complete = roles !== undefined && roles.size === 4;
  }
  // Deterministic ordering: by daemon id ascending. Matters because
  // the sidecar's leg-array order isn't a stable contract and Map
  // iteration preserves whatever insertion order arose from it.
  const groups = [...groupsByDcId.values()].sort(
    (a, b) => a.daemon.id - b.daemon.id,
  );
  return { groups, unmatched, collisions: [...collisionsSet] };
}


/** Broker-side net debit per spread, reconstructed from the four
 *  leg avg_costs on `group`. Mirrors
 *  `api/app.py::_enrich_with_broker_debit`.
 *
 *  Returns null when the group is incomplete (fewer than 4 legs, or
 *  any daemon conid unassigned) — can't build a spread cost basis
 *  out of partial data, and fabricating one would mislead.
 */
export function brokerDebitPerSpread(group: BrokerDcGroup): number | null {
  if (!group.complete) return null;
  const byConid = new Map<number, number>();
  for (const l of group.legs) byConid.set(l.contract.conId, l.avg_cost);
  const fp = group.daemon.front_put_conid;
  const fc = group.daemon.front_call_conid;
  const bp = group.daemon.back_put_conid;
  const bc = group.daemon.back_call_conid;
  if (fp == null || fc == null || bp == null || bc == null) return null;
  const fpCost = byConid.get(fp);
  const fcCost = byConid.get(fc);
  const bpCost = byConid.get(bp);
  const bcCost = byConid.get(bc);
  if (fpCost == null || fcCost == null || bpCost == null || bcCost == null) {
    return null;
  }
  // SPX multiplier — per-leg avg_cost is per-contract; we want per-spread.
  return ((bpCost + bcCost) - (fpCost + fcCost)) / 100;
}
