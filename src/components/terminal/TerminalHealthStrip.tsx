/**
 * Dashboard health-strip indicator (task #307).
 *
 * Renders nothing when the terminal-api reports a healthy state.
 * Flips to a slim persimmon-red band the moment EITHER live-stream
 * subscriptions OR historical-fetch slots enter the backend's
 * degraded state. The body lists the specific names so an operator
 * can triage without opening the journal.
 *
 * The per-chart CACHED badge (PR #191) is the chart-specific
 * indicator for the `intraday_eth` slot. This strip is the broader
 * "any data source is degraded" signal that catches stream failures
 * AND the daily / intraday_rth slots that the chart badge doesn't
 * surface.
 *
 * a11y: role=status + aria-live=polite so screen readers announce
 * "Feed degraded — Streams: …" when the band appears.
 */

import { useTerminalHealth } from "../../hooks/useTerminalHealth";
import { buildHealthBody } from "./terminalHealthStripHelpers";

export function TerminalHealthStrip() {
  const { data, anyDegraded } = useTerminalHealth();

  if (!anyDegraded) return null;

  const body = buildHealthBody(
    data?.degraded_streams ?? [],
    data?.historical_degraded ?? [],
  );
  if (body === null) return null;

  return (
    <div
      className="terminal-health-strip"
      role="status"
      aria-live="polite"
      aria-label={`Feed degraded. ${body}`}
    >
      <span className="terminal-health-strip-label">Feed Degraded</span>
      <span className="terminal-health-strip-body">{body}</span>
    </div>
  );
}
