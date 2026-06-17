/**
 * Pure helpers for the Markup Review pane — alert filtering, lightweight-charts
 * marker construction (clustered + MFE-encoded), the crosshair→alert index, and
 * the subset-stats rollup. No React / no chart lib state, so all unit-testable.
 */

import type { UTCTimestamp } from "lightweight-charts";
import type { MarkupReviewAlert } from "../../api/terminalTypes";

// ── ET session-date helpers ───────────────────────────────────────────

/** yyyymmdd for a Date in America/New_York (session_date is ET). */
export function etDateString(d: Date = new Date()): string {
  // en-CA → "YYYY-MM-DD"; strip the dashes.
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return s.replace(/-/g, "");
}

/** yyyymmdd ↔ the <input type="date"> value (YYYY-MM-DD). */
export const toInputDate = (yyyymmdd: string): string =>
  yyyymmdd.length === 8
    ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
    : yyyymmdd;
export const fromInputDate = (v: string): string => v.replace(/-/g, "");

// ── filters ────────────────────────────────────────────────────────────

export interface AlertFilters {
  direction: "all" | "up" | "down";
  /** σ floor — hide alerts below this spread_z. */
  minZ: number;
  /** |dist_from_atm| ceiling (null = no limit) — e.g. "ATM-only" = 0/5. */
  maxDist: number | null;
  /** Include pending/lost (NULL-outcome) alerts in the markers + stats. */
  includePending: boolean;
}

export const DEFAULT_FILTERS: AlertFilters = {
  direction: "all",
  minZ: 0,
  maxDist: null,
  includePending: false,
};

export function passesFilters(a: MarkupReviewAlert, f: AlertFilters): boolean {
  if (f.direction !== "all" && a.direction !== f.direction) return false;
  if (a.spread_z != null && a.spread_z < f.minZ) return false;
  if (
    f.maxDist != null &&
    a.dist_from_atm != null &&
    Math.abs(a.dist_from_atm) > f.maxDist
  )
    return false;
  if (!f.includePending && a.status !== "finalized") return false;
  return true;
}

export const filterAlerts = (
  alerts: MarkupReviewAlert[],
  f: AlertFilters,
): MarkupReviewAlert[] => alerts.filter((a) => passesFilters(a, f));

// ── markers ──────────────────────────────────────────────────────────

export const MARKER_COLORS = {
  up: "#3fb950",
  down: "#f85149",
  upDim: "#2b6b3f",
  downDim: "#7d342f",
} as const;

/** ISO (UTC-Z) → lightweight-charts UTCTimestamp (epoch seconds). */
export const isoToUtc = (iso: string): UTCTimestamp =>
  Math.floor(Date.parse(iso) / 1000) as UTCTimestamp;

/** MFE → marker size bucket (1 small … 4 large). NULL (pending) → 1, so a
 *  winner reads bigger than a dud at a glance. */
export function mfeSize(mfe: number | null): number {
  if (mfe == null) return 1;
  if (mfe >= 10) return 4;
  if (mfe >= 5) return 3;
  if (mfe >= 2) return 2;
  return 1;
}

export interface ReviewMarker {
  time: UTCTimestamp;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown";
  size: number;
  text: string;
}

function pushGroup(
  m: Map<string, MarkupReviewAlert[]>,
  key: string,
  a: MarkupReviewAlert,
): void {
  const arr = m.get(key);
  if (arr) arr.push(a);
  else m.set(key, [a]);
}

/** One marker per (bar, direction) cluster — same-direction alerts that floor
 *  to the same bar collapse to one arrow + count badge (×N), MFE-encoded by the
 *  cluster's best finalized excursion; an all-pending cluster renders dim. */
export function buildMarkers(alerts: MarkupReviewAlert[]): ReviewMarker[] {
  const groups = new Map<string, MarkupReviewAlert[]>();
  for (const a of alerts) pushGroup(groups, `${a.bar_time}|${a.direction}`, a);

  const out: ReviewMarker[] = [];
  for (const group of groups.values()) {
    const up = group[0].direction === "up";
    const anyFinal = group.some((g) => g.status === "finalized");
    const maxMfe = group.reduce((m, g) => Math.max(m, g.mfe ?? 0), 0);
    out.push({
      time: isoToUtc(group[0].bar_time),
      position: up ? "belowBar" : "aboveBar",
      color: anyFinal
        ? up
          ? MARKER_COLORS.up
          : MARKER_COLORS.down
        : up
          ? MARKER_COLORS.upDim
          : MARKER_COLORS.downDim,
      shape: up ? "arrowUp" : "arrowDown",
      size: mfeSize(anyFinal ? maxMfe : null),
      text: group.length > 1 ? `×${group.length}` : "",
    });
  }
  // lightweight-charts requires markers ascending (and effectively unique) by time.
  return out.sort((a, b) => (a.time as number) - (b.time as number));
}

/** Index alerts by floored bar-time epoch (seconds) so a crosshair at a bar
 *  returns the whole cluster for the tooltip. */
export function indexByBarTime(
  alerts: MarkupReviewAlert[],
): Map<number, MarkupReviewAlert[]> {
  const m = new Map<number, MarkupReviewAlert[]>();
  for (const a of alerts) {
    const t = isoToUtc(a.bar_time) as number;
    const arr = m.get(t);
    if (arr) arr.push(a);
    else m.set(t, [a]);
  }
  return m;
}

// ── subset stats ───────────────────────────────────────────────────────

export interface SubsetStats {
  n: number;
  finalized: number;
  mfeGe5: number | null;
  mfeGe10: number | null;
  medianMfe: number | null;
  medianMae: number | null;
  medianTMfe: number | null;
  dirHit: number | null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const nums = (xs: (number | null)[]): number[] =>
  xs.filter((x): x is number => x != null);

/** Rollup over the (already-filtered) alerts. Outcome rates are over FINALIZED
 *  alerts (mfe present); dirHit is over any alert with a realized move. */
export function subsetStats(alerts: MarkupReviewAlert[]): SubsetStats {
  const fin = alerts.filter((a) => a.mfe != null);
  const mfes = fin.map((a) => a.mfe as number);
  const n = fin.length;
  const real = nums(alerts.map((a) => a.realized_move));
  return {
    n: alerts.length,
    finalized: n,
    mfeGe5: n ? mfes.filter((m) => m >= 5).length / n : null,
    mfeGe10: n ? mfes.filter((m) => m >= 10).length / n : null,
    medianMfe: median(mfes),
    medianMae: median(nums(fin.map((a) => a.mae))),
    medianTMfe: median(nums(fin.map((a) => a.t_mfe_s))),
    dirHit: real.length ? real.filter((x) => x > 0).length / real.length : null,
  };
}
