import type { DCPosition, DCRiskStatus } from "../../api/dcTypes";
import { SignalBadge } from "./SignalBadge";

interface Props {
  positions: DCPosition[];
  risk: DCRiskStatus | null;
}

export function DCPositionsTab({ positions, risk }: Props) {
  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Risk status cards */}
      {risk && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
          <RiskCard
            label="Daily P&L"
            value={`$${risk.daily_pnl >= 0 ? "+" : ""}${risk.daily_pnl.toFixed(0)}`}
            color={risk.daily_pnl >= 0 ? "#10b981" : "#ef4444"}
          />
          <RiskCard label="Trades Today" value={`${risk.daily_trades}`} />
          <RiskCard label="Wins / Losses" value={`${risk.daily_wins}W / ${risk.daily_losses}L`} />
          <RiskCard
            label="Status"
            value={risk.paused ? "PAUSED" : "ACTIVE"}
            color={risk.paused ? "#f59e0b" : "#10b981"}
          />
        </div>
      )}

      {/* Open positions table */}
      <div className="panel" style={{ padding: 12 }}>
        <div className="panel-header" style={{ marginBottom: 8 }}>
          <span className="panel-title">Open Positions ({positions.length})</span>
        </div>
        {positions.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: 24 }}>
            No open positions
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Strategy</th>
                  <th style={thStyle}>Signal</th>
                  <th style={thStyle}>Entry</th>
                  <th style={thStyle}>Put K</th>
                  <th style={thStyle}>Call K</th>
                  <th style={thStyle}>Front Exp</th>
                  <th style={thStyle}>Back Exp</th>
                  <th style={thStyle}>Debit</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>SPX@Entry</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.id}>
                    <td style={tdStyle}>{p.strategy_name}</td>
                    <td style={tdStyle}><SignalBadge signal={p.signal} /></td>
                    <td style={tdStyle}>{formatTime(p.entry_time)}</td>
                    <td style={tdMono}>{p.put_strike}</td>
                    <td style={tdMono}>{p.call_strike}</td>
                    <td style={tdStyle}>{p.front_exp}</td>
                    <td style={tdStyle}>{p.back_exp}</td>
                    <td style={tdMono}>${p.entry_debit.toFixed(2)}</td>
                    <td style={tdMono}>{p.quantity}</td>
                    <td style={tdMono}>{p.spx_at_entry?.toFixed(2) ?? "—"}</td>
                    <td style={tdStyle}>{p.status}</td>
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

function RiskCard({ label, value, color }: { label: string; value: string; color?: string }) {
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

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return iso; }
}

const tableStyle: React.CSSProperties = {
  width: "100%", borderCollapse: "collapse", fontSize: 12,
};
const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "6px 8px", color: "#64748b", fontSize: 10,
  fontFamily: "Inter, sans-serif", textTransform: "uppercase", letterSpacing: 0.5,
  borderBottom: "1px solid #1e293b",
};
const tdStyle: React.CSSProperties = {
  padding: "6px 8px", color: "#e2e8f0", fontSize: 12,
  fontFamily: "Inter, sans-serif", borderBottom: "1px solid #111827",
};
const tdMono: React.CSSProperties = {
  ...tdStyle, fontFamily: "JetBrains Mono, monospace",
};
