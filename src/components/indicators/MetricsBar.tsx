/**
 * MetricsBar: live PF, win rate, trade count from prediction history.
 */

interface Props {
  pf: number | null;
  winRate: number | null;
  numTrades: number | null;
}

export function MetricsBar({ pf, winRate, numTrades }: Props) {
  return (
    <div className="panel" style={{ display: "flex", justifyContent: "space-around", padding: "12px 16px" }}>
      <Metric
        label="Profit Factor"
        value={pf !== null ? pf.toFixed(2) : "---"}
        color={pf !== null ? (pf >= 1 ? "#10b981" : "#ef4444") : "#64748b"}
      />
      <div style={{ width: 1, background: "#1e293b" }} />
      <Metric
        label="Win Rate"
        value={winRate !== null ? `${(winRate * 100).toFixed(1)}%` : "---"}
        color={winRate !== null ? (winRate >= 0.5 ? "#10b981" : "#ef4444") : "#64748b"}
      />
      <div style={{ width: 1, background: "#1e293b" }} />
      <Metric
        label="Trades"
        value={numTrades !== null ? `${numTrades}` : "---"}
        color="#e2e8f0"
      />
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color: "#64748b", fontSize: 10, marginBottom: 4 }}>{label}</div>
      <div
        style={{
          color,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 18,
          fontWeight: 700,
        }}
      >
        {value}
      </div>
    </div>
  );
}
