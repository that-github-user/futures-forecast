/**
 * MetricsBar: range accuracy from hindcast + directional PF/WR from history.
 */

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
}

export function MetricsBar({ pf, winRate, numTrades, historyError, rangeAccuracy }: Props) {
  const noTrades = numTrades === null || numTrades === 0;

  // Ideal calibration: P25-P75 should capture ~50%, P10-P90 should capture ~80%
  const innerColor = rangeAccuracy
    ? rangeAccuracy.innerPct >= 0.40 && rangeAccuracy.innerPct <= 0.65 ? "#10b981"
      : rangeAccuracy.innerPct < 0.25 || rangeAccuracy.innerPct > 0.80 ? "#ef4444"
      : "#f59e0b"
    : "#64748b";
  const outerColor = rangeAccuracy
    ? rangeAccuracy.outerPct >= 0.70 && rangeAccuracy.outerPct <= 0.92 ? "#10b981"
      : rangeAccuracy.outerPct < 0.50 || rangeAccuracy.outerPct > 0.97 ? "#ef4444"
      : "#f59e0b"
    : "#64748b";

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
            <div style={{ width: 1, background: "#1e293b" }} />
            <Metric
              label="Outer Band (P10-P90)"
              value={`${(rangeAccuracy.outerPct * 100).toFixed(0)}%`}
              color={outerColor}
              sub="ideal ~80%"
            />
            <div style={{ width: 1, background: "#1e293b" }} />
            <Metric
              label="Predictions"
              value={`${rangeAccuracy.numPredictions}`}
              color="#e2e8f0"
              sub={`${rangeAccuracy.totalPoints} pts`}
            />
          </div>
          <div style={{ height: 1, background: "#1e293b", margin: "0 -16px 8px" }} />
        </>
      )}
      {/* Directional metrics row */}
      <div style={{ display: "flex", justifyContent: "space-around" }}>
        <Metric
          label="Profit Factor"
          value={historyError ? "—" : noTrades ? "—" : pf !== null ? pf.toFixed(2) : "—"}
          color={historyError ? "#64748b" : pf !== null ? (pf >= 1 ? "#10b981" : "#ef4444") : "#64748b"}
        />
        <div style={{ width: 1, background: "#1e293b" }} />
        <Metric
          label="Win Rate"
          value={
            historyError ? "—"
              : noTrades ? "—"
              : winRate !== null ? `${(winRate * 100).toFixed(1)}%` : "—"
          }
          color={historyError ? "#64748b" : winRate !== null ? (winRate >= 0.5 ? "#10b981" : "#ef4444") : "#64748b"}
        />
        <div style={{ width: 1, background: "#1e293b" }} />
        <Metric
          label="Trades"
          value={historyError ? "—" : noTrades ? "—" : `${numTrades}`}
          color={historyError ? "#64748b" : "#e2e8f0"}
        />
      </div>
    </div>
  );
}

function Metric({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color: "#64748b", fontSize: 10, marginBottom: 4 }}>{label}</div>
      <div
        style={{
          color,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: value === "—" ? 14 : 18,
          fontWeight: 700,
        }}
      >
        {value}
      </div>
      {sub && <div style={{ color: "#475569", fontSize: 9, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
