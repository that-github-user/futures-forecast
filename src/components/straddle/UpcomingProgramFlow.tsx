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
  eventsOnDate,
  filterWindowed,
  formatUpcomingTime,
  formatWindowDate,
  nextSessionDate,
} from "./programFlowFormatters";

interface Props {
  upcoming: ProgramFlowEvent[];
  /** When true, the page is in cold-start mode (snapshotter idle —
   *  weekend, holiday, or pre-first-snapshot). The panel pivots from
   *  "next-14-days windowed-only" to "the next trading day's full
   *  schedule including continuous flows" so a Saturday viewer sees
   *  Monday's anticipated activity instead of an empty list. */
  coldStart?: boolean;
}

const PROGRAM_LABEL: Record<ProgramFlowName, string> = {
  xyld_monthly_roll: "XYLD",
  jheqx_quarterly_roll: "JHEQX",
  jepi_continuous: "JEPI",
  jepq_continuous: "JEPQ",
};

export function UpcomingProgramFlow({ upcoming, coldStart = false }: Props) {
  const nextDate = coldStart ? nextSessionDate(upcoming) : null;
  // Cold-start: surface the FULL next-session schedule (continuous
  // included) so an idle-day viewer has something actionable to read.
  // Live mode: keep the long horizon but filter continuous out — the
  // 20+ JEPI/JEPQ entries per 14 days would otherwise drown XYLD/JHEQX.
  const filtered = nextDate
    ? eventsOnDate(upcoming, nextDate)
    : filterWindowed(upcoming);
  const heading = nextDate ? "Next Session Preview" : "Upcoming Program Flow";
  const emptyMessage = nextDate
    ? "No program-flow events on the next trading day"
    : "No windowed events in the next 14 days";
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
        {heading}
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
          {emptyMessage}
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
              {/* JHEQX rolls have no intraday window — see
                  `formatUpcomingTime` for the carve-out rationale. */}
              {formatUpcomingTime(event)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
