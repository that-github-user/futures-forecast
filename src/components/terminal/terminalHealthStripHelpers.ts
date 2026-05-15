/**
 * Pure helpers for `TerminalHealthStrip`. Kept in their own module so
 * the component file exports only React components (the
 * `react-refresh/only-export-components` rule wants this split for
 * Vite HMR fast-refresh to work cleanly).
 */

/** Stream names that should render uppercased — the existing terminal
 *  vocabulary uses VIX / HYG / LQD / TICK / TRIN as proper-noun
 *  tickers everywhere else (RegimeCard label, formatRegime, etc.).
 *  Lowercasing them in the health-strip body would read as
 *  inconsistent with the rest of the dashboard. Other stream names
 *  (e.g. "spx", "es") pass through unchanged — `humanizeStream`
 *  uppercases when in the allow-list and otherwise returns the
 *  name verbatim. */
const TICKER_STREAMS = new Set(["vix", "vix_3m", "hyg", "lqd", "tick", "trin", "spx", "es"]);

/** Slot-name → human-readable label. Backend uses snake_case
 *  ("intraday_eth"); the operator-facing label uses parentheses for
 *  the session marker so it reads as English ("intraday (ETH)") rather
 *  than a Python identifier. */
const HISTORICAL_SLOT_LABELS: Record<string, string> = {
  daily: "daily",
  intraday_rth: "intraday (RTH)",
  intraday_eth: "intraday (ETH)",
};

function humanizeStream(name: string): string {
  if (TICKER_STREAMS.has(name)) {
    // VIX_3M → "VIX3M" reads cleaner than "VIX_3M" or "VIX 3M".
    return name.replace(/_/g, "").toUpperCase();
  }
  return name;
}

function humanizeHistoricalSlot(name: string): string {
  return HISTORICAL_SLOT_LABELS[name] ?? name;
}

/** Build the strip's body text from the two degraded lists. Returns
 *  `null` when both lists are empty so the caller can use it as a
 *  render gate. Pure: easy to unit-test without the polling hook.
 *
 *  Ticker stream names (VIX, HYG, etc.) are uppercased to match the
 *  vocabulary used elsewhere in the dashboard. Historical slot names
 *  ("intraday_eth") are humanized to "intraday (ETH)" so the body
 *  reads as English rather than backend snake_case. */
export function buildHealthBody(
  degradedStreams: string[],
  historicalDegraded: string[],
): string | null {
  const parts: string[] = [];
  if (degradedStreams.length > 0) {
    parts.push(`Streams: ${degradedStreams.map(humanizeStream).join(", ")}`);
  }
  if (historicalDegraded.length > 0) {
    parts.push(
      `Historical: ${historicalDegraded.map(humanizeHistoricalSlot).join(", ")}`,
    );
  }
  return parts.length === 0 ? null : parts.join(" · ");
}
