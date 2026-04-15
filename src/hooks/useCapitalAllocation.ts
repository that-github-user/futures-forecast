/**
 * useCapitalAllocation — per-browser capital allocation preferences.
 *
 * Stores the user's portfolio size, selected allocation policy, and preferred
 * Copeland signal mode in localStorage. Used by:
 *   - DCSignalsTab header (portfolio + policy selectors)
 *   - StrategyMonitorCard "Suggested contracts" row
 *   - CapitalAllocationTab (Panel A picker, Panel B sizing grid, Panel D chart)
 *
 * No accounts, no server sync — each device tracks its own state. The Capital
 * research content (policies, EV ranking, curves) lives on the backend; this
 * hook only stores the user's *choice* of portfolio size + policy.
 *
 * Values are validated on read: portfolioSize is clamped to a sane range
 * [1_000, 100_000_000], policyKey falls back to 'rec_60_10' if unknown.
 */

import { useCallback, useEffect, useState } from "react";

import type { CopelandMode, PolicyKey } from "../api/dcTypes";

const STORAGE_KEY = "dc.capitalAllocation";

const DEFAULT_PORTFOLIO_SIZE = 25_000;
const DEFAULT_POLICY: PolicyKey = "rec_60_10";
const DEFAULT_SIGNAL_MODE: CopelandMode = "aggressive";

const MIN_PORTFOLIO_SIZE = 1_000;
const MAX_PORTFOLIO_SIZE = 100_000_000;

const VALID_POLICIES: readonly PolicyKey[] = [
  "take_all",
  "rec_60_10",
  "cons_40_8",
  "cop_cons_60_10",
];

interface StoredState {
  portfolioSize: number;
  policyKey: PolicyKey;
  signalMode: CopelandMode;
}

function clampPortfolio(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : DEFAULT_PORTFOLIO_SIZE;
  return Math.max(MIN_PORTFOLIO_SIZE, Math.min(MAX_PORTFOLIO_SIZE, n));
}

function coercePolicy(v: unknown): PolicyKey {
  return VALID_POLICIES.includes(v as PolicyKey) ? (v as PolicyKey) : DEFAULT_POLICY;
}

function coerceMode(v: unknown): CopelandMode {
  return v === "conservative" || v === "aggressive" ? v : DEFAULT_SIGNAL_MODE;
}

function load(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { portfolioSize: DEFAULT_PORTFOLIO_SIZE, policyKey: DEFAULT_POLICY, signalMode: DEFAULT_SIGNAL_MODE };
    const parsed = JSON.parse(raw);
    return {
      portfolioSize: clampPortfolio(parsed?.portfolioSize),
      policyKey: coercePolicy(parsed?.policyKey),
      signalMode: coerceMode(parsed?.signalMode),
    };
  } catch {
    return {
      portfolioSize: DEFAULT_PORTFOLIO_SIZE,
      policyKey: DEFAULT_POLICY,
      signalMode: DEFAULT_SIGNAL_MODE,
    };
  }
}

function persist(state: StoredState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota / disabled storage.
  }
}

export interface CapitalAllocationApi {
  portfolioSize: number;
  policyKey: PolicyKey;
  signalMode: CopelandMode;
  setPortfolioSize: (v: number) => void;
  setPolicy: (k: PolicyKey) => void;
  setSignalMode: (m: CopelandMode) => void;
}

export function useCapitalAllocation(): CapitalAllocationApi {
  const [state, setState] = useState<StoredState>(() => load());

  // Cross-tab sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setState(load());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPortfolioSize = useCallback((v: number) => {
    setState((prev) => {
      const next = { ...prev, portfolioSize: clampPortfolio(v) };
      persist(next);
      return next;
    });
  }, []);

  const setPolicy = useCallback((k: PolicyKey) => {
    setState((prev) => {
      const next = { ...prev, policyKey: coercePolicy(k) };
      persist(next);
      return next;
    });
  }, []);

  const setSignalMode = useCallback((m: CopelandMode) => {
    setState((prev) => {
      const next = { ...prev, signalMode: coerceMode(m) };
      persist(next);
      return next;
    });
  }, []);

  return {
    ...state,
    setPortfolioSize,
    setPolicy,
    setSignalMode,
  };
}
