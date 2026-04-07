/**
 * Shared signal badge for DC dashboard tabs.
 * Single source of truth for signal name → color mapping.
 */

const SIGNAL_COLORS: Record<string, string> = {
  GO_PLUS: "#10b981",   // green — strongest signal
  GO: "#3b82f6",        // blue — entry signal
  READY: "#f59e0b",     // amber — conditions met but not entry day
  SKIP: "#ef4444",      // red — no entry
};

export function SignalBadge({ signal }: { signal: string | null | undefined }) {
  if (!signal) return <span style={{ color: "#64748b" }}>—</span>;
  const color = SIGNAL_COLORS[signal] ?? "#64748b";
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color,
        background: color + "18",
        border: `1px solid ${color}40`,
        padding: "2px 8px",
        borderRadius: 8,
        fontFamily: "Inter, sans-serif",
        letterSpacing: 0.3,
      }}
    >
      {signal.replace("_", "+")}
    </span>
  );
}
