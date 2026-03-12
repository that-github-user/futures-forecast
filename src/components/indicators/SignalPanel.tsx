/**
 * Forecast summary panel: shows distribution statistics from the ensemble.
 * Replaces the trading signal (LONG/SHORT) with probabilistic framing —
 * the model produces calibrated spreads, not directional signals.
 */

import { formatHorizon } from "../../api/format";
import type { SignalResponse } from "../../api/types";

interface Props {
  signal: SignalResponse;
  lastClose: number;
}

export function SignalPanel({ signal, lastClose }: Props) {
  const {
    expected_return,
    p10_return,
    p90_return,
    long_frac,
    ensemble_sharpe,
    confidence,
    horizon_signals,
  } = signal;

  // Derive bias from expected return direction
  const bias =
    expected_return > 0.0001
      ? "BULLISH"
      : expected_return < -0.0001
        ? "BEARISH"
        : "NEUTRAL";

  const color =
    bias === "BULLISH"
      ? "#10b981"
      : bias === "BEARISH"
        ? "#ef4444"
        : "#3b82f6";

  const bgGlow =
    bias === "BULLISH"
      ? "rgba(16, 185, 129, 0.06)"
      : bias === "BEARISH"
        ? "rgba(239, 68, 68, 0.06)"
        : "rgba(59, 130, 246, 0.04)";

  // Convert returns to points
  const medianPts = expected_return * lastClose;
  const p10Pts = p10_return * lastClose;
  const p90Pts = p90_return * lastClose;
  const spreadPts = p90Pts - p10Pts;

  return (
    <div
      className="panel"
      style={{
        background: bgGlow,
        borderColor: color + "40",
        borderWidth: 1,
        borderStyle: "solid",
      }}
    >
      <div className="panel-header">
        <span className="panel-title">Forecast Summary</span>
        <span
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 12,
            color: "#94a3b8",
          }}
        >
          {lastClose.toFixed(2)}
        </span>
      </div>

      {/* Median bias badge */}
      <div style={{ textAlign: "center", margin: "10px 0 6px" }}>
        <span
          style={{
            fontSize: 22,
            fontWeight: 700,
            color,
            fontFamily: "Inter, sans-serif",
            letterSpacing: 2,
          }}
        >
          {bias}
        </span>
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
          median ensemble bias
        </div>
      </div>

      {/* Horizon breakdown row */}
      {horizon_signals && Object.keys(horizon_signals).length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Object.keys(horizon_signals).length}, 1fr)`,
            gap: 4,
            margin: "8px 0",
            padding: "8px 0",
            borderTop: "1px solid #1e293b",
            borderBottom: "1px solid #1e293b",
          }}
        >
          {Object.entries(horizon_signals).map(([h, hs]) => {
            const dirColor =
              hs.direction === "LONG" ? "#10b981" : hs.direction === "SHORT" ? "#ef4444" : "#94a3b8";
            const arrow = hs.direction === "LONG" ? "\u2191" : hs.direction === "SHORT" ? "\u2193" : "\u2192";
            const expectedPts = hs.expected_return * lastClose;
            return (
              <div key={h} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2 }}>
                  {formatHorizon(Number(h))}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: dirColor }}>
                  {arrow}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: dirColor,
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  {expectedPts >= 0 ? "+" : ""}{expectedPts.toFixed(1)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Spread visualization — P10 to P90 bar */}
      <div style={{ margin: "8px 0 12px", padding: "0 4px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: "#94a3b8",
            marginBottom: 4,
          }}
        >
          <span>P10-P90 Spread</span>
          <span style={{ fontFamily: "JetBrains Mono, monospace" }}>
            {spreadPts.toFixed(1)} pts
          </span>
        </div>
        <div
          style={{
            height: 8,
            background: "#1e293b",
            borderRadius: 4,
            overflow: "hidden",
            position: "relative",
          }}
        >
          {/* P10-P90 range bar */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              background: `linear-gradient(90deg, #ef444460, ${color}40, #10b98160)`,
              borderRadius: 4,
            }}
          />
          {/* Median marker */}
          <div
            style={{
              position: "absolute",
              left: `${Math.max(5, Math.min(95, long_frac * 100))}%`,
              top: 0,
              bottom: 0,
              width: 2,
              background: color,
              borderRadius: 1,
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 9,
            color: "#64748b",
            marginTop: 2,
          }}
        >
          <span>{p10Pts >= 0 ? "+" : ""}{p10Pts.toFixed(1)}</span>
          <span>median</span>
          <span>{p90Pts >= 0 ? "+" : ""}{p90Pts.toFixed(1)}</span>
        </div>
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px 16px",
          fontSize: 11,
          borderTop: "1px solid #1e293b",
          paddingTop: 10,
        }}
      >
        <StatItem
          label="Median Move"
          value={`${medianPts >= 0 ? "+" : ""}${medianPts.toFixed(1)} pts`}
          color={medianPts > 0 ? "#10b981" : medianPts < 0 ? "#ef4444" : "#94a3b8"}
        />
        <StatItem
          label="Paths Up"
          value={`${(long_frac * 100).toFixed(0)}%`}
          subtitle="% of paths ending higher"
          color={long_frac > 0.55 ? "#10b981" : long_frac < 0.45 ? "#ef4444" : "#94a3b8"}
        />
        <StatItem
          label="Downside Risk (P10)"
          value={`${p10Pts >= 0 ? "+" : ""}${p10Pts.toFixed(1)} pts`}
          color="#ef4444"
        />
        <StatItem
          label="Upside (P90)"
          value={`${p90Pts >= 0 ? "+" : ""}${p90Pts.toFixed(1)} pts`}
          color="#10b981"
        />
        <StatItem
          label="Signal Sharpe"
          value={ensemble_sharpe.toFixed(2)}
          subtitle="mean/std of returns"
        />
        <StatItem
          label="Strength"
          value={`${(confidence * 100).toFixed(0)}%`}
          subtitle="signal conviction"
          color={confidence > 0.6 ? "#10b981" : "#94a3b8"}
        />
      </div>
    </div>
  );
}

function StatItem({
  label,
  value,
  color,
  subtitle,
}: {
  label: string;
  value: string;
  color?: string;
  subtitle?: string;
}) {
  return (
    <div>
      <div style={{ color: "#64748b", fontSize: 10 }}>{label}</div>
      <div
        style={{
          color: color ?? "#e2e8f0",
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {value}
      </div>
      {subtitle && (
        <div style={{ color: "#475569", fontSize: 9, marginTop: 1 }}>{subtitle}</div>
      )}
    </div>
  );
}
