/**
 * Pure helpers for `TerminalHealthStrip`. Kept in their own module so
 * the component file exports only React components (the
 * `react-refresh/only-export-components` rule wants this split for
 * Vite HMR fast-refresh to work cleanly).
 */

/** Build the strip's body text from the two degraded lists. Returns
 *  `null` when both lists are empty so the caller can use it as a
 *  render gate. Pure: easy to unit-test without the polling hook. */
export function buildHealthBody(
  degradedStreams: string[],
  historicalDegraded: string[],
): string | null {
  const parts: string[] = [];
  if (degradedStreams.length > 0) {
    parts.push(`Streams: ${degradedStreams.join(", ")}`);
  }
  if (historicalDegraded.length > 0) {
    parts.push(`Historical: ${historicalDegraded.join(", ")}`);
  }
  return parts.length === 0 ? null : parts.join(" · ");
}
