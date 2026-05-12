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
  // Phase 3 of live-tick-pre-entry. When the daemon has an active
  // streaming subscription for this strategy (T-60s → T-0 window),
  // the S/L ratio shown above is from a live tick rather than a
  // 2-min-stale snapshot. The "LIVE · {age}ms" badge surfaces this
  // so operators trust the gate fidelity at decision time.
  // "live_stream_stale" (PR #274): the pre-entry stream just ended;
  // the values shown are the last live snapshot held in the daemon's
  // afterglow buffer (up to ~2 min). Dashboard dims values + shows
  // "RECENT" instead of "LIVE" so the operator knows they're seeing
  // last-known-good, not current.
  slRatioSource: "live_stream" | "live_stream_stale" | "snapshot" | null;
  lastTickAgeMs: number | null;
  preEntryWindowActive: boolean;
  // Phase 4 follow-up: ISO timestamp of when the API computed the
  // response carrying `lastTickAgeMs`. The LIVE badge uses
  // `(Date.now() - Date.parse(responseComputedAt)) + lastTickAgeMs`
  // to age naturally between 30s (or 5s) dashboard polls, instead
  // of showing a static server-computed value. Null when the
  // daemon is older than the computed_at envelope (PR #152) — the
  // badge falls back to displaying lastTickAgeMs as-is.
  responseComputedAt: string | null;
  // 'debit' (DCs — we pay premium, profit when mark rises) or 'credit'
  // (SPY short puts/straddles — we collect premium, profit when mark
  // decays). Flips post-entry net-mark coloring and the TP math.
  entryDirection: "debit" | "credit";
}
