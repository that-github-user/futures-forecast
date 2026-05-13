import { useState } from "react";
import type { DCTrade } from "../../api/dcTypes";
import { colors, fonts, withAlpha, withAlphaByte } from "../../styles/tokens";
import { SignalBadge } from "./SignalBadge";
import {
  tableStyle,
  thStickyStyle as thStyle,
  tdStyle,
  tdMono,
} from "./tableStyles";
import { TentChartModal } from "./TentChartModal";

interface Props {
  trades: DCTrade[];
}

export function DCHistoryTab({ trades }: Props) {
  // Modal target for the per-trade through-expiry tent. Closing
  // sets back to null.
  const [tentTrade, setTentTrade] = useState<DCTrade | null>(null);

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
          color={totalPnl >= 0 ? colors.accentGreen : colors.accentRed}
        />
        <StatCard label="Profit Factor" value={pf ? pf.toFixed(2) : "—"} />
      </div>

      {/* Trade table */}
      <div className="panel" style={{ padding: 12 }}>
        <div className="panel-header" style={{ marginBottom: 8 }}>
          <span className="panel-title">Trade History ({trades.length})</span>
        </div>
        {trades.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: 13, textAlign: "center", padding: 24 }}>
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
                  <th style={thStyle} aria-label="Tent chart action"></th>
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
                      color: t.pnl != null ? (t.pnl >= 0 ? colors.accentGreen : colors.accentRed) : colors.textMuted,
                    }}>
                      {t.pnl != null ? `$${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : "—"}
                    </td>
                    <td style={tdStyle}>
                      {t.result && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8,
                          color: t.result === "win" ? colors.accentGreen : colors.accentRed,
                          background: withAlphaByte(t.result === "win" ? colors.accentGreen : colors.accentRed, 0x18),
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
                    <td style={tdStyle}>
                      {/* Tent button — disabled when strikes are
                          missing (legacy rows without the full
                          schema). Strikes are required for the
                          through-expiry tent. */}
                      {t.put_strike != null && t.call_strike != null && (
                        <button
                          onClick={() => setTentTrade(t)}
                          aria-label={`Show through-expiry tent for ${t.strategy_name} closed ${t.close_date ?? ""}`}
                          style={{
                            fontSize: 10,
                            padding: "2px 8px",
                            background: withAlpha(colors.accentBlue, 0.1),
                            color: colors.accentBlue,
                            border: `1px solid ${withAlpha(colors.accentBlue, 0.4)}`,
                            borderRadius: 3,
                            cursor: "pointer",
                            fontFamily: fonts.sans,
                          }}
                        >
                          ▲
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tentTrade != null && (
              <TentChartModal
                target={{ kind: "trade", tradeId: tentTrade.id }}
                title={`${tentTrade.strategy_name} (closed ${tentTrade.close_date?.slice(0, 10) ?? "?"})`}
                onClose={() => setTentTrade(null)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      background: colors.bgPanel, border: `1px solid ${colors.borderDim}`, borderRadius: 6, padding: "10px 12px",
    }}>
      <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.sans, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{
        fontSize: 16, fontWeight: 700, fontFamily: fonts.mono,
        color: color ?? colors.textPrimary, marginTop: 2,
      }}>
        {value}
      </div>
    </div>
  );
}

