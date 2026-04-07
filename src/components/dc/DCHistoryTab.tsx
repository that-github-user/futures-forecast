import type { DCTrade } from "../../api/dcTypes";
import { SignalBadge } from "./SignalBadge";

interface Props {
  trades: DCTrade[];
}

export function DCHistoryTab({ trades }: Props) {
  const wins = trades.filter((t) => t.result === "win").length;
  const losses = trades.filter((t) => t.result === "loss").length;
  const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossProfit = trades.reduce((s, t) => s + (t.pnl && t.pnl > 0 ? t.pnl : 0), 0);
  const grossLoss = trades.reduce((s, t) => s + (t.pnl && t.pnl < 0 ? Math.abs(t.pnl) : 0), 0);
  const pf = grossLoss > 0 ? grossProfit / grossLoss : null;

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
        <StatCard label="Total Trades" value={`${trades.length}`} />
        <StatCard label="Win Rate" value={trades.length > 0 ? `${((wins / trades.length) * 100).toFixed(1)}%` : "—"} />
        <StatCard label="Wins / Losses" value={`${wins}W / ${losses}L`} />
        <StatCard
          label="Total P&L"
          value={`$${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(0)}`}
          color={totalPnl >= 0 ? "#10b981" : "#ef4444"}
        />
        <StatCard label="Profit Factor" value={pf ? pf.toFixed(2) : "—"} />
      </div>

      {/* Trade table */}
      <div className="panel" style={{ padding: 12 }}>
        <div className="panel-header" style={{ marginBottom: 8 }}>
          <span className="panel-title">Trade History ({trades.length})</span>
        </div>
        {trades.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: 24 }}>
            No trades recorded yet
          </div>
        ) : (
          <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 250px)", overflowY: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Strategy</th>
                  <th style={thStyle}>Signal</th>
                  <th style={thStyle}>Debit</th>
                  <th style={thStyle}>P&L</th>
                  <th style={thStyle}>Result</th>
                  <th style={thStyle}>Exit Reason</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>Strikes</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id}>
                    <td style={tdStyle}>{t.close_date?.slice(0, 10) ?? t.entry_date ?? "—"}</td>
                    <td style={tdStyle}>{t.strategy_name}</td>
                    <td style={tdStyle}><SignalBadge signal={t.signal} /></td>
                    <td style={tdMono}>${t.entry_debit?.toFixed(2) ?? "—"}</td>
                    <td style={{
                      ...tdMono,
                      color: t.pnl != null ? (t.pnl >= 0 ? "#10b981" : "#ef4444") : "#64748b",
                    }}>
                      {t.pnl != null ? `$${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : "—"}
                    </td>
                    <td style={tdStyle}>
                      {t.result && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8,
                          color: t.result === "win" ? "#10b981" : "#ef4444",
                          background: (t.result === "win" ? "#10b981" : "#ef4444") + "18",
                        }}>
                          {t.result.toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>{t.close_reason ?? "—"}</td>
                    <td style={tdMono}>{t.quantity ?? "—"}</td>
                    <td style={tdMono}>
                      {t.put_strike && t.call_strike ? `${t.put_strike}P / ${t.call_strike}C` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      background: "#111827", border: "1px solid #1e293b", borderRadius: 6, padding: "10px 12px",
    }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: "Inter, sans-serif", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{
        fontSize: 16, fontWeight: 700, fontFamily: "JetBrains Mono, monospace",
        color: color ?? "#e2e8f0", marginTop: 2,
      }}>
        {value}
      </div>
    </div>
  );
}

const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "6px 8px", color: "#64748b", fontSize: 10,
  fontFamily: "Inter, sans-serif", textTransform: "uppercase", letterSpacing: 0.5,
  borderBottom: "1px solid #1e293b", position: "sticky", top: 0, background: "#0f1520",
};
const tdStyle: React.CSSProperties = {
  padding: "6px 8px", color: "#e2e8f0", fontSize: 12,
  fontFamily: "Inter, sans-serif", borderBottom: "1px solid #111827",
};
const tdMono: React.CSSProperties = { ...tdStyle, fontFamily: "JetBrains Mono, monospace" };
