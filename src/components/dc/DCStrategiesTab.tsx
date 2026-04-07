import type { DCStrategyStats } from "../../api/dcTypes";

interface Props {
  strategies: DCStrategyStats[];
}

export function DCStrategiesTab({ strategies }: Props) {
  if (strategies.length === 0) {
    return (
      <div className="fade-in" style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: 40 }}>
        No strategy data yet
      </div>
    );
  }

  return (
    <div className="fade-in" style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10,
    }}>
      {strategies.map((s) => (
        <div
          key={s.strategy_name}
          style={{
            background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", fontFamily: "Inter, sans-serif" }}>
              {s.strategy_name}
            </span>
            <span style={{
              fontSize: 11, fontFamily: "JetBrains Mono, monospace",
              color: s.total_pnl >= 0 ? "#10b981" : "#ef4444",
            }}>
              ${s.total_pnl >= 0 ? "+" : ""}{s.total_pnl.toFixed(0)}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12 }}>
            <StatLine label="Trades" value={`${s.total_trades}`} />
            <StatLine label="Win Rate" value={s.win_rate != null ? `${(s.win_rate * 100).toFixed(1)}%` : "—"} />
            <StatLine label="Avg P&L" value={s.avg_pnl != null ? `$${s.avg_pnl.toFixed(2)}` : "—"} />
            <StatLine label="D'Alembert" value={`${s.current_mult.toFixed(1)}x`} />
            <StatLine label="Wins" value={`${s.total_wins}`} color="#10b981" />
            <StatLine label="Losses" value={`${s.total_losses}`} color="#ef4444" />
          </div>

          {/* Streak indicator */}
          {(s.consecutive_wins > 0 || s.consecutive_losses > 0) && (
            <div style={{ marginTop: 8, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
              {s.consecutive_wins > 0 && (
                <span style={{ color: "#10b981" }}>{s.consecutive_wins}W streak</span>
              )}
              {s.consecutive_losses > 0 && (
                <span style={{ color: "#ef4444" }}>{s.consecutive_losses}L streak</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StatLine({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "#64748b", fontFamily: "Inter, sans-serif", fontSize: 11 }}>{label}</span>
      <span style={{ color: color ?? "#e2e8f0", fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>{value}</span>
    </div>
  );
}
