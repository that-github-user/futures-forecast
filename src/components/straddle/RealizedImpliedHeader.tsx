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
 */

import { colors, fonts, withAlpha, withAlphaByte } from "../../styles/tokens";
import type { StraddleChainResponse } from "../../api/terminalTypes";
import {
  formatAge,
  formatInt,
  formatNumber,
  realizedVsImpliedColor,
} from "./realizedImpliedHelpers";

interface Props {
  data: StraddleChainResponse | null;
}

export function RealizedImpliedHeader({ data }: Props) {
  const stale = data?.stale ?? true;
  const statusColor = stale ? colors.accentRed : colors.accentGreen;
  const statusLabel = stale ? "STALE" : "FRESH";
  const age = formatAge(data?.data_age_seconds ?? null);
  const realizedVsImpliedPct = data?.realized_vs_implied_pct ?? null;
  const ratioColor = realizedVsImpliedColor(realizedVsImpliedPct);

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
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr) auto",
        gap: 8,
        padding: "12px 14px",
        background: colors.bgPanel,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 6,
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
      </div>
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
