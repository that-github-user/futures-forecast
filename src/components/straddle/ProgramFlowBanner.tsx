/**
 * ProgramFlowBanner — surfaces active windowed ETF program-flow events.
 *
 * Renders a horizontal strip with one chip per active windowed event
 * (XYLD monthly roll, JHEQX quarterly roll). Continuous programs
 * (JEPI/JEPQ daily call writing) are intentionally NOT rendered here —
 * they're ambient and lower-priority; the upcoming list in the right
 * column carries them when needed.
 *
 * Color per program family:
 *   - XYLD → indigo (cool, prominent)
 *   - JHEQX → magenta (warm, calendar-rare)
 *   - JEPI / JEPQ → muted slate (only used if we ever surface them
 *     here, which we don't today — defensive default for forward-
 *     compat with future ProgramFlowName additions).
 *
 * Banner returns null when the active_windowed array is empty so the
 * page layout doesn't reserve a blank row in the common no-flow case.
 */

import { colors, fonts, withAlpha, withAlphaByte } from "../../styles/tokens";
import type { ProgramFlowEvent, ProgramFlowName } from "../../api/terminalTypes";
import { formatWindowTime } from "./programFlowFormatters";

interface Props {
  events: ProgramFlowEvent[];
}

const PROGRAM_COLOR: Record<ProgramFlowName, string> = {
  // Indigo — derived from accentBlue but shifted purple-ward so it
  // doesn't conflict with the chart's call-side blue tint.
  xyld_monthly_roll: "#6366f1",
  // Magenta — quarter-end JHEQX rolls are rare and dramatic; warm
  // hue calls attention without burning the high-alert red slot.
  jheqx_quarterly_roll: "#d946ef",
  // Defensive fallbacks for continuous flows in case the banner is
  // ever re-purposed to render them. Still passed through here so
  // exhaustive `ProgramFlowName` coverage doesn't break tsc.
  jepi_continuous: colors.textMuted,
  jepq_continuous: colors.textMuted,
};

const PROGRAM_LABEL: Record<ProgramFlowName, string> = {
  xyld_monthly_roll: "XYLD monthly roll",
  jheqx_quarterly_roll: "JHEQX quarterly roll",
  jepi_continuous: "JEPI continuous",
  jepq_continuous: "JEPQ continuous",
};

export function ProgramFlowBanner({ events }: Props) {
  if (events.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        padding: "8px 14px",
        background: colors.bgPanel,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 6,
      }}
    >
      {events.map((event) => {
        const color = PROGRAM_COLOR[event.name];
        const label = PROGRAM_LABEL[event.name];
        return (
          <div
            key={`${event.name}-${event.window_start}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 12px",
              borderRadius: 16,
              fontFamily: fonts.sans,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.03em",
              color: color,
              background: withAlphaByte(color, 0x14),
              border: `1px solid ${withAlpha(color, 0.4)}`,
            }}
          >
            <span style={{ fontSize: 9, opacity: 0.8 }}>ACTIVE</span>
            <span>{label}</span>
            <span style={{ color: colors.textSecondary, fontFamily: fonts.mono, fontSize: 10 }}>
              {formatWindowTime(event.window_start)} – {formatWindowTime(event.window_end)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
