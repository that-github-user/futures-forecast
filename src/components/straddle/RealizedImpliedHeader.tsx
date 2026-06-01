/**
 * RealizedImpliedHeader — top strip for the /straddle page.
 *
 * Horizontal grid of headline metrics. Each field renders an em-dash
 * placeholder when the underlying value is null (cold-start before the
 * first snapshot lands). The "REALIZED / IMPLIED" cell is color-coded
 * by the realized-vs-implied ratio:
 *   - <70%   → green (dealers winning, range compressed inside EM)
 *   - 70-110% → amber (running close to implied)
 *   - >110%  → red (realized blew past implied — pin candidates broken)
 *
 * The STATUS pill summarizes freshness:
 *   - FRESH (green) when `stale=false`
 *   - STALE (red) when `stale=true`, suffixed with a human-readable
 *     `data_age_seconds` if present.
 *
 * A small refresh button (↻) sits next to STATUS — fires `onRefresh`
 * and is disabled while `refreshing` is true so double-clicks don't
 * stack fetches.
 *
 * Active-continuous chip row (below the grid) surfaces JEPI/JEPQ
 * continuous-flow programs without screaming. They're ambient, not
 * actionable, but operators still want to see them.
 */

import { colors, fonts, withAlpha, withAlphaByte } from "../../styles/tokens";
import type {
  ProgramFlowEvent,
  ProgramFlowName,
  StraddleChainResponse,
} from "../../api/terminalTypes";
import {
  formatAge,
  formatInt,
  formatNumber,
  realizedVsImpliedColor,
} from "./realizedImpliedHelpers";

interface Props {
  data: StraddleChainResponse | null;
  /** Manual refresh trigger from useStraddleData. The refresh button
   *  is only enabled when this is provided. */
  onRefresh?: () => void | Promise<void>;
  /** True while a manual refresh is in flight — disables the button
   *  + shows a subtle in-flight cue. */
  refreshing?: boolean;
}

const CONTINUOUS_LABEL: Partial<Record<ProgramFlowName, string>> = {
  jepi_continuous: "JEPI",
  jepq_continuous: "JEPQ",
};

export function RealizedImpliedHeader({ data, onRefresh, refreshing }: Props) {
  const stale = data?.stale ?? true;
  const statusColor = stale ? colors.accentRed : colors.accentGreen;
  const statusLabel = stale ? "STALE" : "FRESH";
  const age = formatAge(data?.data_age_seconds ?? null);
  const realizedVsImpliedPct = data?.realized_vs_implied_pct ?? null;
  const ratioColor = realizedVsImpliedColor(realizedVsImpliedPct);
  const activeContinuous = data?.program_flow.active_continuous ?? [];

  const cells = [
    { label: "SPX SPOT", value: formatNumber(data?.spot ?? null, 2) },
    { label: "ATM", value: formatInt(data?.atm_strike ?? null) },
    {
      label: "STRADDLE",
      value:
        data?.atm_straddle_mid != null
          ? `$${formatNumber(data.atm_straddle_mid, 2)}`
          : "—",
    },
    {
      label: "EM BAND",
      value:
        data?.em_lower != null && data?.em_upper != null
          ? `${formatNumber(data.em_lower, 0)} … ${formatNumber(data.em_upper, 0)}`
          : "—",
    },
    {
      label: "REALIZED",
      value:
        data?.realized_range_pts != null
          ? `${formatNumber(data.realized_range_pts, 1)} pts`
          : "—",
    },
    {
      label: "REALIZED / IMPLIED",
      value:
        realizedVsImpliedPct != null
          ? `${formatNumber(realizedVsImpliedPct, 1)}%`
          : "—",
      color: ratioColor,
    },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 14px",
        background: colors.bgPanel,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 6,
      }}
    >
      <div
        style={{
          display: "grid",
          // auto-fit + minmax lets the grid reflow when the viewport
          // narrows — cells wrap onto a new row at a width that keeps
          // mono numbers readable rather than silently truncating.
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 8,
          alignItems: "start",
        }}
      >
        {cells.map((cell) => (
          <div key={cell.label} style={cellStyle}>
            <span style={labelStyle}>{cell.label}</span>
            <span style={{ ...valueStyle, color: cell.color ?? colors.textBright }}>
              {cell.value}
            </span>
          </div>
        ))}
        <div
          style={{
            ...cellStyle,
            alignItems: "flex-end",
            minWidth: 90,
          }}
        >
          <span style={labelStyle}>STATUS</span>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 9px",
                borderRadius: 10,
                fontFamily: fonts.sans,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.06em",
                color: statusColor,
                background: withAlphaByte(statusColor, 0x18),
                border: `1px solid ${withAlpha(statusColor, 0.25)}`,
              }}
            >
              {statusLabel}
              {age && stale && (
                <span style={{ color: colors.textMuted, fontWeight: 500 }}>
                  · {age}
                </span>
              )}
            </span>
            {onRefresh && (
              <button
                type="button"
                onClick={() => {
                  void onRefresh();
                }}
                disabled={refreshing}
                aria-label="Refresh straddle snapshot"
                title="Refresh"
                style={{
                  // Tight icon-button — matches the STATUS pill's
                  // visual weight without overpowering it.
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 22,
                  padding: 0,
                  borderRadius: 6,
                  background: withAlphaByte(colors.textPrimary, 0x10),
                  border: `1px solid ${colors.borderDim}`,
                  color: refreshing
                    ? colors.textMuted
                    : colors.textPrimary,
                  cursor: refreshing ? "default" : "pointer",
                  fontFamily: fonts.sans,
                  fontSize: 13,
                  lineHeight: 1,
                  transition: "color 120ms ease, transform 600ms linear",
                  transform: refreshing ? "rotate(360deg)" : "rotate(0deg)",
                }}
              >
                {/* U+21BB clockwise open circle arrow — semantic refresh glyph */}
                {"↻"}
              </button>
            )}
          </div>
        </div>
      </div>

      {activeContinuous.length > 0 && (
        <ActiveContinuousChips
          events={activeContinuous}
          previewMode={data?.preview_mode ?? false}
        />
      )}
    </div>
  );
}

/** Ambient chip row: continuous-flow programs currently active.
 *  Muted, single-line, ignored unless populated.
 *
 *  Under `previewMode` the backend has re-based program_flow to the
 *  imminent NEXT session (post-close rollover preview), so these programs
 *  are NOT active right now — they're tomorrow's. Relabel "ACTIVE" →
 *  "NEXT SESSION" and tint amber to match the chart's preview banner,
 *  rather than asserting a literally-false "ACTIVE" after hours. */
function ActiveContinuousChips({
  events,
  previewMode,
}: {
  events: ProgramFlowEvent[];
  previewMode: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        alignItems: "center",
        fontFamily: fonts.sans,
        fontSize: 10,
        color: colors.textMuted,
        letterSpacing: "0.04em",
      }}
    >
      <span
        style={{
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: previewMode ? colors.accentAmber : undefined,
        }}
      >
        {previewMode ? "NEXT SESSION" : "ACTIVE"}
      </span>
      {events.map((event) => (
        <span
          key={`${event.name}-${event.window_start}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "2px 8px",
            borderRadius: 10,
            background: withAlphaByte(colors.textPrimary, 0x0a),
            border: `1px solid ${colors.borderDim}`,
            color: colors.textSecondary,
            fontSize: 10,
          }}
        >
          {CONTINUOUS_LABEL[event.name] ?? event.name} continuous
        </span>
      ))}
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  minWidth: 0,
};

const labelStyle: React.CSSProperties = {
  fontFamily: fonts.sans,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: colors.textMuted,
  textTransform: "uppercase",
};

const valueStyle: React.CSSProperties = {
  fontFamily: fonts.mono,
  fontSize: 16,
  fontWeight: 600,
  color: colors.textBright,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
