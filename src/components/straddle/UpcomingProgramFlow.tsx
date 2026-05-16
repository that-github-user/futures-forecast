/**
 * UpcomingProgramFlow — next-14-days windowed program-flow events.
 *
 * Filtered to windowed events only (XYLD monthly rolls, JHEQX
 * quarterly rolls) — JEPI/JEPQ continuous flows appear daily and would
 * clutter the list (~20 items per 14 days). Continuous flows are
 * surfaced inline via the active banner when relevant.
 *
 * Each row: program label · date (Mon DD) · window time range.
 */

import { colors, fonts } from "../../styles/tokens";
import type { ProgramFlowEvent, ProgramFlowName } from "../../api/terminalTypes";
import {
  filterWindowed,
  formatWindowDate,
  formatWindowTime,
} from "./programFlowFormatters";

interface Props {
  upcoming: ProgramFlowEvent[];
}

const PROGRAM_LABEL: Record<ProgramFlowName, string> = {
  xyld_monthly_roll: "XYLD",
  jheqx_quarterly_roll: "JHEQX",
  jepi_continuous: "JEPI",
  jepq_continuous: "JEPQ",
};

export function UpcomingProgramFlow({ upcoming }: Props) {
  const filtered = filterWindowed(upcoming);
  return (
    <div
      style={{
        background: colors.bgPanel,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 6,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          fontFamily: fonts.sans,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: colors.textMuted,
          textTransform: "uppercase",
        }}
      >
        Upcoming Program Flow
      </div>
      {filtered.length === 0 ? (
        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: 12,
            color: colors.textMuted,
            padding: "6px 0",
          }}
        >
          No windowed events in the next 14 days
        </div>
      ) : (
        filtered.map((event) => (
          <div
            key={`${event.name}-${event.window_start}`}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              alignItems: "center",
              gap: 8,
              padding: "4px 0",
              borderTop: `1px solid ${colors.borderDim}`,
              fontFamily: fonts.mono,
              fontSize: 11,
            }}
          >
            <span style={{ color: colors.textBright, fontWeight: 600 }}>
              {PROGRAM_LABEL[event.name]}
            </span>
            <span style={{ color: colors.textSecondary }}>
              {formatWindowDate(event.window_start)}
            </span>
            <span style={{ color: colors.textMuted }}>
              {formatWindowTime(event.window_start)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
