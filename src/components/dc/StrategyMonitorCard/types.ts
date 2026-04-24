/**
 * Shared types for the StrategyMonitorCard subtree.
 *
 * Lives in its own file so sibling files (BodyContent, LegDetailBlock,
 * SuggestedRow) can import without pointing `up` to ./index — flattening
 * the dependency graph and avoiding the sibling-to-root import shape
 * that invites accidental "cycle-fix" refactors.
 */

import type {
  DCLegDetail,
  DCSnapshotInfo,
  LegName,
} from "../../../api/dcTypes";

export interface LegData {
  slRatio: number | null;
  slRatioMeetsMin: boolean | null;
  legs: Record<LegName, DCLegDetail> | null;
  netDebit: number | null;
  entryNetDebit: number | null;
  snapshot: DCSnapshotInfo | null;
  profitTargetPct: number;  // from strategy spec — used to compute $ TP from net debit
  usesSlRatio: boolean;     // true if the daemon gates entry or exit on S/L — hides ratio display when false
  // Which IV anchor the daemon's last resolve used. Badge surfaces
  // near the Net Debit header so a silent fallback to VIX (the
  // pre-fix path that caused the 21/28 strike incident) is visible
  // without digging through logs. Null when no resolve has happened.
  ivSource: "chain" | "vix" | "default" | null;
  // 'debit' (DCs — we pay premium, profit when mark rises) or 'credit'
  // (SPY short puts/straddles — we collect premium, profit when mark
  // decays). Flips post-entry net-mark coloring and the TP math.
  entryDirection: "debit" | "credit";
}
