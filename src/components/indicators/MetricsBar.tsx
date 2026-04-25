/**
 * MetricsBar: range accuracy from hindcast + directional PF/WR from history.
 */

import { colors, fonts } from "../../styles/tokens";

interface RangeAccuracy {
  innerPct: number;  // fraction in P25-P75
  outerPct: number;  // fraction in P10-P90
  totalPoints: number;
  numPredictions: number;
}

interface Props {
  pf: number | null;
  winRate: number | null;
  numTrades: number | null;
  historyError?: boolean;
  rangeAccuracy?: RangeAccuracy | null;
  regimeLabel?: string | null;
}

export function MetricsBar({ pf, winRate, numTrades, historyError, rangeAccuracy, regimeLabel }: Props) {
  const noTrades = numTrades === null || numTrades === 0;

  // Ideal calibration: P25-P75 should capture ~50%, P10-P90 should capture ~80%
  const innerColor = rangeAccuracy
    ? rangeAccuracy.innerPct >= 0.40 && rangeAccuracy.innerPct <= 0.65 ? colors.accentGreen
      : rangeAccuracy.innerPct < 0.25 || rangeAccuracy.innerPct > 0.80 ? colors.accentRed
      : colors.accentAmber
    : colors.textMuted;
  const outerColor = rangeAccuracy
    ? rangeAccuracy.outerPct >= 0.70 && rangeAccuracy.outerPct <= 0.92 ? colors.accentGreen
      : rangeAccuracy.outerPct < 0.50 || rangeAccuracy.outerPct > 0.97 ? colors.accentRed
      : colors.accentAmber
    : colors.textMuted;

  return (
    <div className="panel" style={{ padding: "10px 16px" }}>
      {/* Range accuracy row — primary metrics for range predictor */}
      {rangeAccuracy && (
        <>
          <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 8 }}>
            <Metric
              label="Inner Band (P25-P75)"
              value={`${(rangeAccuracy.innerPct * 100).toFixed(0)}%`}
              color={innerColor}
              sub="ideal ~50%"
            />
            <div style={{ width: 1, background: colors.borderDim }} />
            <Metric
              label="Outer Band (P10-P90)"
              value={`${(rangeAccuracy.outerPct * 100).toFixed(0)}%`}
              color={outerColor}
              sub="ideal ~80%"
            />
            <div style={{ width: 1, background: colors.borderDim }} />
            <Metric
              label="Predictions"
              value={`${rangeAccuracy.numPredictions}`}
              color={colors.textPrimary}
              sub={`${rangeAccuracy.totalPoints} pts`}
            />
          </div>
          <div style={{ height: 1, background: colors.borderDim, margin: "0 -16px 8px" }} />
        </>
      )}
      {/* Directional metrics row */}
      <div style={{ display: "flex", justifyContent: "space-around" }}>
        <Metric
          label="Profit Factor"
          value={historyError ? "—" : noTrades ? "—" : pf !== null ? pf.toFixed(2) : "—"}
          color={historyError ? colors.textMuted : pf !== null ? (pf >= 1 ? colors.accentGreen : colors.accentRed) : colors.textMuted}
          sub={regimeLabel ? `in ${regimeLabel.replace("_", "-")}` : undefined}
        />
        <div style={{ width: 1, background: colors.borderDim }} />
        <Metric
          label="Win Rate"
          value={
            historyError ? "—"
              : noTrades ? "—"
              : winRate !== null ? `${(winRate * 100).toFixed(1)}%` : "—"
          }
          color={historyError ? colors.textMuted : winRate !== null ? (winRate >= 0.5 ? colors.accentGreen : colors.accentRed) : colors.textMuted}
        />
        <div style={{ width: 1, background: colors.borderDim }} />
        <Metric
          label="Trades"
          value={historyError ? "—" : noTrades ? "—" : `${numTrades}`}
          color={historyError ? colors.textMuted : colors.textPrimary}
        />
      </div>
    </div>
  );
}

function Metric({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color: colors.textMuted, fontSize: 10, marginBottom: 4 }}>{label}</div>
      <div
        style={{
          color,
          fontFamily: fonts.mono,
          fontSize: value === "—" ? 14 : 18,
          fontWeight: 700,
        }}
      >
        {value}
      </div>
      {sub && <div style={{ color: colors.textDim, fontSize: 9, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
