/**
 * Pure formatters for program-flow event timestamps, extracted from
 * the React component files so the `react-refresh/only-export-components`
 * lint rule stays happy (component files should ONLY export components).
 *
 * The backend emits ISO8601 timestamps with an ET offset baked in
 * (-04:00 / -05:00 depending on DST). We slice the time and date
 * portions directly rather than going through Date+TZ math so the
 * display always matches the operator's mental "ET wall-clock" model
 * regardless of where the user is sitting.
 */

import type { ProgramFlowEvent, ProgramFlowName } from "../../api/terminalTypes";

/** Format an ISO timestamp as "HH:MM ET". Malformed inputs pass
 *  through untouched so a backend contract drift surfaces visibly. */
export function formatWindowTime(iso: string): string {
  const tIndex = iso.indexOf("T");
  if (tIndex < 0) return iso;
  const hhmm = iso.slice(tIndex + 1, tIndex + 6);
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return iso;
  return `${hhmm} ET`;
}

/** Format the date portion of an ISO timestamp as "Mon DD".
 *  Uses Date.UTC to avoid local-tz shifting the day for west-coast
 *  viewers (the backend already anchored these to ET). */
export function formatWindowDate(iso: string): string {
  const tIndex = iso.indexOf("T");
  const datePart = tIndex < 0 ? iso : iso.slice(0, tIndex);
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = date.getUTCDate();
  return `${month} ${String(day).padStart(2, "0")}`;
}

/** Set of windowed program-flow names — the discrete-time-window
 *  events operators care about (XYLD monthly, JHEQX quarterly).
 *  Continuous flows (JEPI/JEPQ daily) are filtered OUT of the
 *  upcoming list to avoid clutter (~20 entries per 14 days). */
export const WINDOWED_PROGRAMS: ReadonlySet<ProgramFlowName> = new Set([
  "xyld_monthly_roll",
  "jheqx_quarterly_roll",
]);

/** Filter to only windowed program flows, used by the upcoming list.
 *  Pure so tests can assert that JEPI/JEPQ never leak in. */
export function filterWindowed(events: ProgramFlowEvent[]): ProgramFlowEvent[] {
  return events.filter((e) => WINDOWED_PROGRAMS.has(e.name));
}

/** Pull the next session's date from the upcoming list. `upcoming` is
 *  sorted ascending by window_start by the backend, so the first entry
 *  is always the next trading day. Returns the yyyy-mm-dd portion or
 *  null when the list is empty. Used by the cold-start "next session
 *  preview" path so the operator sees a useful date even when the
 *  snapshotter is idle (weekend, holiday, post-RTH-close). */
export function nextSessionDate(upcoming: ProgramFlowEvent[]): string | null {
  if (upcoming.length === 0) return null;
  const first = upcoming[0].window_start;
  const tIndex = first.indexOf("T");
  return tIndex < 0 ? first : first.slice(0, tIndex);
}

/** Format a yyyy-mm-dd date as "Mon, May 18". Used by the cold-start
 *  banner to surface the next-session date in operator-friendly form.
 *  Mirrors formatWindowDate's UTC-anchored handling so west-coast
 *  viewers see the same day the backend anchored. */
export function formatNextSessionLabel(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  if (!y || !m || !d) return yyyymmdd;
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.toLocaleString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${weekday}, ${month} ${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** Restrict an upcoming list to events on a specific yyyy-mm-dd date.
 *  Used in cold-start mode to show ONLY the next trading day's events
 *  (including JEPI/JEPQ continuous, which the live-mode filter strips).
 *  Operator anticipating Monday wants to see "JEPI/JEPQ continuous
 *  active 09:30 ET" even though it's noisy in normal live-mode browsing. */
export function eventsOnDate(
  events: ProgramFlowEvent[],
  yyyymmdd: string,
): ProgramFlowEvent[] {
  return events.filter((e) => e.window_start.startsWith(yyyymmdd));
}
