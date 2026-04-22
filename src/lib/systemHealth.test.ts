// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  BROKER_AGE_ERROR_SEC,
  BROKER_AGE_WARN_SEC,
  DRIFT_ERROR,
  DRIFT_WARN,
  computeBrokerHealth,
  computeDriftHealth,
  computeIVHealth,
  computeSystemHealth,
} from "./systemHealth";
import type {
  DCBrokerState,
  DCPosition,
  DCSignalsResponse,
  DCSignalStatus,
} from "../api/dcTypes";

// ---- IV source ------------------------------------------------------------

function sig(
  strategy_name: string,
  iv_source: DCSignalStatus["iv_source"],
): DCSignalStatus {
  return {
    strategy_name,
    signal: "READY",
    entry_days: [],
    next_entry_times: [],
    sl_ratio: null,
    sl_ratio_meets_min: null,
    legs: null,
    net_debit: null,
    entry_net_debit: null,
    snapshot: null,
    iv_source,
  };
}

function signalsResp(sigs: DCSignalStatus[]): DCSignalsResponse {
  return {
    signals: sigs,
    features: null,
    features_date: null,
    features_computed_at: null,
  } as unknown as DCSignalsResponse;
}

describe("computeIVHealth", () => {
  it("no signals payload → unknown", () => {
    const h = computeIVHealth(null);
    expect(h.level).toBe("unknown");
    expect(h.total).toBe(0);
  });

  it("all chain → ok", () => {
    const h = computeIVHealth(signalsResp([sig("a", "chain"), sig("b", "chain")]));
    expect(h.level).toBe("ok");
    expect(h.chain).toBe(2);
    expect(h.vix).toBe(0);
  });

  it("any vix → warn", () => {
    const h = computeIVHealth(
      signalsResp([sig("a", "chain"), sig("b", "vix"), sig("c", "chain")]),
    );
    expect(h.level).toBe("warn");
    expect(h.vix).toBe(1);
    expect(h.chain).toBe(2);
  });

  it("any default → error (even with mostly chain)", () => {
    const h = computeIVHealth(
      signalsResp([sig("a", "chain"), sig("b", "chain"), sig("c", "default")]),
    );
    expect(h.level).toBe("error");
    expect(h.default_).toBe(1);
  });

  it("default trumps vix", () => {
    const h = computeIVHealth(
      signalsResp([sig("a", "vix"), sig("b", "default")]),
    );
    expect(h.level).toBe("error");
  });

  it("only pending (null iv_source) → unknown, not ok", () => {
    // Pre-observability rows OR strategies that haven't resolved yet
    // shouldn't register as "everything's fine" — the strip should read
    // as "unknown" rather than falsely advertise green.
    const h = computeIVHealth(signalsResp([sig("a", null), sig("b", null)]));
    expect(h.level).toBe("unknown");
    expect(h.pending).toBe(2);
  });
});

// ---- Broker freshness / collisions / orphans ------------------------------

function pos(strategy_name: string, debit_drift: number | null = null): DCPosition {
  return {
    strategy_name,
    debit_drift,
    // Minimal — groupBrokerLegs only reads leg conId fields on DCPosition.
    // Supply zeroes (no conId match); callers who care about grouping
    // supply a proper DCPosition.
  } as unknown as DCPosition;
}

function brokerState(snapshot_at: string | null): DCBrokerState {
  return { snapshot_at, positions: [], open_orders: [] };
}

describe("computeBrokerHealth", () => {
  const NOW = new Date("2026-04-21T15:00:00Z");

  it("no brokerState → unknown", () => {
    const h = computeBrokerHealth(null, [], NOW);
    expect(h.level).toBe("unknown");
    expect(h.ageSec).toBeNull();
  });

  it("fresh snapshot (<10min) → ok", () => {
    const snap = new Date(NOW.getTime() - 60_000).toISOString(); // 1min ago
    const h = computeBrokerHealth(brokerState(snap), [], NOW);
    expect(h.level).toBe("ok");
    expect(h.ageSec).toBe(60);
  });

  it("10-30min old → warn", () => {
    const snap = new Date(NOW.getTime() - (BROKER_AGE_WARN_SEC + 60) * 1000).toISOString();
    const h = computeBrokerHealth(brokerState(snap), [], NOW);
    expect(h.level).toBe("warn");
  });

  it(">30min old → error", () => {
    const snap = new Date(NOW.getTime() - (BROKER_AGE_ERROR_SEC + 60) * 1000).toISOString();
    const h = computeBrokerHealth(brokerState(snap), [], NOW);
    expect(h.level).toBe("error");
  });

  it("null snapshot_at → unknown (not error)", () => {
    // A brokerState object with null snapshot_at means the sidecar file
    // was present but empty/malformed. The daemon hasn't reported, which
    // is ambiguous, not necessarily stale.
    const h = computeBrokerHealth(brokerState(null), [], NOW);
    expect(h.level).toBe("unknown");
    expect(h.ageSec).toBeNull();
  });

  it("malformed snapshot_at → ageSec stays null", () => {
    const h = computeBrokerHealth(brokerState("not-an-iso-string"), [], NOW);
    expect(h.ageSec).toBeNull();
    expect(h.level).toBe("unknown");
  });

  it("collision with fresh snap → error (collision trumps age-ok)", () => {
    // Two daemon positions claim the same conId 101 → collision.
    // Sidecar is fresh (1min old) so age alone would be "ok"; the
    // collision has to promote level to error independently.
    const snap = new Date(NOW.getTime() - 60_000).toISOString();
    const dcPos = (id: number, conid: number): DCPosition =>
      ({
        id,
        front_put_conid: conid,
        front_call_conid: 0,
        back_put_conid: 0,
        back_call_conid: 0,
      }) as unknown as DCPosition;
    const h = computeBrokerHealth(
      { snapshot_at: snap, positions: [], open_orders: [] },
      [dcPos(1, 101), dcPos(2, 101)],
      NOW,
    );
    expect(h.level).toBe("error");
    expect(h.collisions).toBe(1);
  });

  it("orphan-only with fresh snap → still ok (orphans don't escalate)", () => {
    // Broker has a leg the daemon never claimed (unmatched / orphan).
    // No collisions. Sidecar fresh. Level stays "ok" — the orphan count
    // is surfaced as copy, not as a severity lever.
    const snap = new Date(NOW.getTime() - 60_000).toISOString();
    const brokerLeg = {
      account: "U123",
      contract: {
        conId: 999, symbol: "SPXW", secType: "OPT", expiry: "20260425",
        strike: 6900, right: "P", tradingClass: "SPXW", multiplier: "100",
        currency: "USD",
      },
      position: -1, avg_cost: 0.50,
    };
    const h = computeBrokerHealth(
      { snapshot_at: snap, positions: [brokerLeg], open_orders: [] },
      [],
      NOW,
    );
    expect(h.level).toBe("ok");
    expect(h.orphans).toBe(1);
    expect(h.collisions).toBe(0);
  });
});

// ---- Drift ----------------------------------------------------------------

describe("computeDriftHealth", () => {
  it("no positions → unknown", () => {
    const h = computeDriftHealth([]);
    expect(h.level).toBe("unknown");
    expect(h.maxAbsDrift).toBeNull();
  });

  it("all drift values null → unknown", () => {
    const h = computeDriftHealth([pos("a", null), pos("b", null)]);
    expect(h.level).toBe("unknown");
  });

  it("all within commission noise → ok", () => {
    const h = computeDriftHealth([pos("a", 0.02), pos("b", -0.03)]);
    expect(h.level).toBe("ok");
    expect(h.maxAbsDrift).toBeCloseTo(0.03);
    expect(h.worstStrategy).toBe("b");
  });

  it("any in warn band → warn (and surface the worst)", () => {
    const h = computeDriftHealth([
      pos("a", 0.02),
      pos("b", 0.08),
      pos("c", -0.06),
    ]);
    expect(h.level).toBe("warn");
    expect(h.worstStrategy).toBe("b");
    expect(h.maxAbsDrift).toBeCloseTo(0.08);
  });

  it("any in error band → error", () => {
    const h = computeDriftHealth([
      pos("a", 0.08),
      pos("b", -0.18),
    ]);
    expect(h.level).toBe("error");
    expect(h.worstStrategy).toBe("b");
  });

  it("null drifts don't displace a worst candidate", () => {
    const h = computeDriftHealth([pos("a", 0.08), pos("b", null), pos("c", 0.01)]);
    expect(h.worstStrategy).toBe("a");
  });

  it("threshold boundaries — inclusive of threshold on bad side", () => {
    // Exactly DRIFT_WARN → warn (not ok). Exactly DRIFT_ERROR → error.
    expect(computeDriftHealth([pos("a", DRIFT_WARN)]).level).toBe("warn");
    expect(computeDriftHealth([pos("a", DRIFT_ERROR)]).level).toBe("error");
  });
});

// ---- Overall roll-up -------------------------------------------------------

describe("computeSystemHealth overall", () => {
  const NOW = new Date("2026-04-21T15:00:00Z");

  it("all three unknown → overall unknown", () => {
    const h = computeSystemHealth(null, null, [], NOW);
    expect(h.overall).toBe("unknown");
  });

  it("one component ok, others unknown → overall ok (unknown doesn't suppress)", () => {
    const h = computeSystemHealth(
      signalsResp([sig("a", "chain")]),
      null,
      [],
      NOW,
    );
    expect(h.overall).toBe("ok");
  });

  it("error anywhere → overall error", () => {
    const snap = new Date(NOW.getTime() - 60_000).toISOString();
    const h = computeSystemHealth(
      signalsResp([sig("a", "chain")]),
      brokerState(snap),
      [pos("a", 0.20)],
      NOW,
    );
    expect(h.overall).toBe("error");
  });

  it("warn without error → overall warn", () => {
    const snap = new Date(NOW.getTime() - 60_000).toISOString();
    const h = computeSystemHealth(
      signalsResp([sig("a", "chain"), sig("b", "vix")]),
      brokerState(snap),
      [pos("a", 0.02)],
      NOW,
    );
    expect(h.overall).toBe("warn");
  });
});
