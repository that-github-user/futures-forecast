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
