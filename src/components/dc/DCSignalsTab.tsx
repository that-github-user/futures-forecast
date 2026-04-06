import type { DCSignalsResponse } from "../../api/dcTypes";

interface Props {
  signals: DCSignalsResponse | null;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export function DCSignalsTab({ signals }: Props) {
  if (!signals) {
    return (
      <div className="fade-in" style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: 40 }}>
        Signal data unavailable
      </div>
    );
  }

  const { features, features_stale, signals: signalList } = signals;

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Features grid */}
      <div className="panel" style={{ padding: 12 }}>
        <div className="panel-header" style={{ marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
          <span className="panel-title">Market Features</span>
          {features?.feature_date && (
            <span style={{
              fontSize: 11, fontFamily: "JetBrains Mono, monospace",
              color: features_stale ? "#f59e0b" : "#64748b",
            }}>
              {features_stale ? "STALE " : ""}{features.feature_date}
            </span>
          )}
        </div>
        {features ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
            <FeatureCard label="ATR %" value={features.atr_pct != null ? `${(features.atr_pct * 100).toFixed(2)}%` : "—"} />
            <FeatureCard label="Gap %" value={features.gap_pct != null ? `${(features.gap_pct * 100).toFixed(2)}%` : "—"} />
            <FeatureCard label="BB Position" value={features.bb_position != null ? features.bb_position.toFixed(3) : "—"} />
            <FeatureCard label="RSI 14" value={features.rsi_14 != null ? features.rsi_14.toFixed(1) : "—"} />
            <FeatureCard label="Return 5D" value={features.return_5d != null ? `${(features.return_5d * 100).toFixed(2)}%` : "—"} />
            <FeatureCard label="VIX" value={features.vix_close != null ? features.vix_close.toFixed(2) : "—"} />
            <FeatureCard label="VIX %ile" value={features.vix_pctile != null ? `${(features.vix_pctile * 100).toFixed(0)}%` : "—"} />
            <FeatureCard label="Vol Regime" value={features.vol_regime != null ? `R${features.vol_regime}` : "—"} />
          </div>
        ) : (
          <div style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: 16 }}>
            No features available — daemon may be offline
          </div>
        )}
      </div>

      {/* Signal status table */}
      <div className="panel" style={{ padding: 12 }}>
        <div className="panel-header" style={{ marginBottom: 8 }}>
          <span className="panel-title">Strategy Signals ({signalList.length})</span>
        </div>
        {signalList.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: 16 }}>
            No signals computed
          </div>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Strategy</th>
                <th style={thStyle}>Signal</th>
                <th style={thStyle}>Entry Days</th>
                <th style={thStyle}>Entry Times (ET)</th>
              </tr>
            </thead>
            <tbody>
              {signalList.map((s) => (
                <tr key={s.strategy_name}>
                  <td style={tdStyle}>{s.strategy_name}</td>
                  <td style={tdStyle}><SignalBadge signal={s.signal} /></td>
                  <td style={tdStyle}>
                    {s.entry_days.map((d) => DAY_NAMES[d] ?? d).join(", ")}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "JetBrains Mono, monospace" }}>
                    {s.next_entry_times.join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FeatureCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: "#111827", border: "1px solid #1e293b", borderRadius: 6, padding: "8px 10px",
    }}>
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: "Inter, sans-serif", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "JetBrains Mono, monospace", color: "#e2e8f0", marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function SignalBadge({ signal }: { signal: string }) {
  const colors: Record<string, string> = {
    GO_PLUS: "#10b981", GO: "#3b82f6", READY: "#f59e0b", SKIP: "#ef4444",
  };
  const c = colors[signal] ?? "#64748b";
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, color: c, background: c + "18",
      border: `1px solid ${c}40`, padding: "2px 8px", borderRadius: 8,
      fontFamily: "Inter, sans-serif", letterSpacing: 0.3,
    }}>
      {signal.replace("_", "+")}
    </span>
  );
}

const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "6px 8px", color: "#64748b", fontSize: 10,
  fontFamily: "Inter, sans-serif", textTransform: "uppercase", letterSpacing: 0.5,
  borderBottom: "1px solid #1e293b",
};
const tdStyle: React.CSSProperties = {
  padding: "6px 8px", color: "#e2e8f0", fontSize: 12,
  fontFamily: "Inter, sans-serif", borderBottom: "1px solid #111827",
};
