/**
 * Shared signal badge for DC dashboard tabs.
 * Single source of truth for signal name → color mapping.
 */

import { colors, fonts } from "../../styles/tokens";

const SIGNAL_COLORS: Record<string, string> = {
  GO_PLUS: colors.accentGreen,   // strongest signal
  GO: colors.accentBlue,          // entry signal
  READY: colors.accentAmber,     // conditions met but not entry day
  SKIP: colors.accentRed,         // no entry
};

export function SignalBadge({ signal }: { signal: string | null | undefined }) {
  if (!signal) return <span style={{ color: colors.textMuted }}>—</span>;
  const color = SIGNAL_COLORS[signal] ?? colors.textMuted;
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
        fontFamily: fonts.sans,
        letterSpacing: 0.3,
      }}
    >
      {signal.replace("_", "+")}
    </span>
  );
}
