/** Format a horizon (bar count) as human-readable time. Each bar = 5 minutes. */
export function formatHorizon(bars: number): string {
  const minutes = bars * 5;
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours === Math.floor(hours)) return `${hours}h`;
  return `${hours.toFixed(1)}h`;
}

/** Short label for horizon buttons. */
export function horizonLabel(bars: number): string {
  const minutes = bars * 5;
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours === Math.floor(hours)) return `${hours}h`;
  return `${hours.toFixed(1)}h`;
}
