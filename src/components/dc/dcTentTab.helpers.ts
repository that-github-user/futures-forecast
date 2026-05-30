/**
 * Pure filter helpers for the DCTentTab. Split out from the component
 * file so `react-refresh/only-export-components` doesn't trip on the
 * mixed-exports rule, AND so the tests can import them without
 * pulling JSX into the test bundle.
 */

import type { DCTrade } from "../../api/dcTypes";


/** ET "today" as a YYYYMMDD string — the same format the backend
 *  stores `front_exp` / `back_exp` in, so the two compare directly as
 *  sortable text. Anchored in America/New_York (NOT the runner's TZ) so
 *  a PT trader at 9pm (= midnight ET) sees the correct trading day. */
export function etTodayYYYYMMDD(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
    .format(now)
    .replace(/-/g, "");
}


export type TentLifecycle = "active" | "front_expired" | "settled";

/**
 * Classify a DC's lifecycle from its leg expiries vs ET-today. Drives
 * whether the Tent tab renders a position as a live two-tent, a
 * single-calendar "settling" shape, or a stale row that should already
 * be closed (the "14d in trade on a 6/7-DTE" symptom — a position whose
 * back leg settled days ago but still lingers `status='open'`).
 *
 *   - "active"        — front_exp >= today: both legs alive (two tents).
 *   - "front_expired" — front_exp < today <= back_exp: front settled,
 *                       back still alive; degenerates to one calendar.
 *   - "settled"       — back_exp < today: fully dead; should be closed.
 *
 * `>=` convention keeps a same-day expiry in scope until end-of-day —
 * mirrors `store.get_active_phantoms` and the SPXW curb-window rule
 * (expiry-day data is high-information, not stale).
 *
 * Fail-OPEN: missing or unparseable expiries → "active". A position is
 * never hidden/down-ranked on bad data — the operator must still see it
 * (a lingering open row may carry real broker risk).
 */
export function tentLifecycle(
  legs: { front_exp?: string | null; back_exp?: string | null },
  etToday: string = etTodayYYYYMMDD(),
): TentLifecycle {
  const valid = (s: string | null | undefined): s is string =>
    s != null && /^\d{8}$/.test(s);
  if (valid(legs.back_exp) && legs.back_exp < etToday) return "settled";
  if (valid(legs.front_exp) && legs.front_exp < etToday) return "front_expired";
  return "active";
}


/**
 * Whole days since a YYYYMMDD expiry, anchored in ET. Positive => the
 * expiry is in the past (e.g. 14 → "expired 14d ago"). Returns null on a
 * malformed expiry string so callers can fall back gracefully. UTC-
 * midnight pinning on both ends skirts DST entirely.
 */
export function daysSinceExpiry(
  yyyymmdd: string, now: Date = new Date(),
): number | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null;
  const exp = new Date(
    `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T00:00:00Z`,
  );
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(now);
  const today = new Date(`${todayIso}T00:00:00Z`);
  return Math.round((today.getTime() - exp.getTime()) / 86_400_000);
}


/**
 * Returns trades whose `close_date` is within the last `days` days
 * of `now`.
 *
 *   - `days <= 0` returns the full list ("All" option in the picker).
 *   - Trades with a null or unparseable `close_date` are EXCLUDED —
 *     we can't place them on the timeline.
 *   - Comparison is UTC-day-only so a trade closed on the boundary
 *     date isn't silently dropped due to the runner's timezone
 *     offset (e.g. close_date "2026-04-12" parses to 00:00 UTC; a
 *     local-time cutoff in ET would be 04:00 UTC and reject the
 *     boundary trade).
 */
export function filterTradesByDays(
  trades: DCTrade[], days: number, now: Date = new Date(),
): DCTrade[] {
  if (days <= 0) return trades;
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  cutoff.setUTCHours(0, 0, 0, 0);
  return trades.filter((t) => {
    if (t.close_date == null) return false;
    const closeDate = new Date(t.close_date);
    return Number.isFinite(closeDate.valueOf()) && closeDate >= cutoff;
  });
}


/**
 * A trade can render a through-expiry tent only when its strikes and
 * both leg expiries are present on the row. Legacy rows missing
 * those (pre-PR-2 trade_history) are excluded from the Tent tab's
 * closed-trade explorer.
 */
export function isTentRenderable(t: DCTrade): boolean {
  return (
    t.put_strike != null &&
    t.call_strike != null &&
    t.front_exp != null &&
    t.back_exp != null
  );
}
