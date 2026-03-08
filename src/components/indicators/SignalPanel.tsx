/**
 * Signal panel: LONG/SHORT/FLAT with confidence bar + composite score.
 */

import type { SignalResponse } from "../../api/types";

interface Props {
  signal: SignalResponse;
  lastClose: number;
}

export function SignalPanel({ signal, lastClose }: Props) {
  const { direction, composite_score, confidence, expected_return, p10_return, p90_return, long_frac, ensemble_sharpe } = signal;

  const color =
    direction === "LONG"
      ? "#10b981"
      : direction === "SHORT"
        ? "#ef4444"
        : "#3b82f6";

  const bgGlow =
    direction === "LONG"
      ? "rgba(16, 185, 129, 0.08)"
      : direction === "SHORT"
        ? "rgba(239, 68, 68, 0.08)"
        : "rgba(59, 130, 246, 0.05)";

  return (
    <div
      className="panel"
      style={{
        background: bgGlow,
        borderColor: color,
        borderWidth: 1,
        borderStyle: "solid",
      }}
    >
      <div className="panel-header">
        <span className="panel-title">Signal</span>
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

      {/* Direction badge */}
      <div style={{ textAlign: "center", margin: "12px 0 8px" }}>
        <span
          style={{
            fontSize: 28,
            fontWeight: 700,
            color,
            fontFamily: "Inter, sans-serif",
            letterSpacing: 2,
          }}
        >
          {direction}
        </span>
      </div>

      {/* Confidence bar */}
      <div style={{ margin: "0 0 12px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: "#94a3b8",
            marginBottom: 4,
          }}
        >
          <span>Confidence</span>
          <span style={{ fontFamily: "JetBrains Mono, monospace" }}>
            {(confidence * 100).toFixed(1)}%
          </span>
        </div>
        <div
          style={{
            height: 6,
            background: "#1e293b",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.min(confidence * 100, 100)}%`,
              height: "100%",
              background: color,
              borderRadius: 3,
              transition: "width 0.5s ease",
            }}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px 16px",
          fontSize: 11,
        }}
      >
        <StatItem label="Composite" value={composite_score.toFixed(3)} color={color} />
        <StatItem label="Sharpe" value={ensemble_sharpe.toFixed(2)} />
        <StatItem
          label="E[Return]"
          value={`${(expected_return * 100).toFixed(3)}%`}
          color={expected_return > 0 ? "#10b981" : "#ef4444"}
        />
        <StatItem label="Long Frac" value={`${(long_frac * 100).toFixed(0)}%`} />
        <StatItem
          label="P10 (down)"
          value={`${(p10_return * 100).toFixed(3)}%`}
          color="#ef4444"
        />
        <StatItem
          label="P90 (up)"
          value={`${(p90_return * 100).toFixed(3)}%`}
          color="#10b981"
        />
      </div>
    </div>
  );
}

function StatItem({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
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
    </div>
  );
}
