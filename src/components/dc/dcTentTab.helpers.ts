/**
 * Pure filter helpers for the DCTentTab. Split out from the component
 * file so `react-refresh/only-export-components` doesn't trip on the
 * mixed-exports rule, AND so the tests can import them without
 * pulling JSX into the test bundle.
 */

import type { DCTrade } from "../../api/dcTypes";


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
