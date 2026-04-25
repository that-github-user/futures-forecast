/**
 * Forecast summary panel: shows distribution statistics from the ensemble.
 * Replaces the trading signal (LONG/SHORT) with probabilistic framing —
 * the model produces calibrated spreads, not directional signals.
 */

import { formatHorizon } from "../../api/format";
import type { RegimeInfo, SignalResponse } from "../../api/types";
import { colors, fonts, withAlpha } from "../../styles/tokens";

interface Props {
  signal: SignalResponse;
  lastClose: number;
  regime?: RegimeInfo | null;
}

export function SignalPanel({ signal, lastClose, regime }: Props) {
  const {
    expected_return,
    p10_return,
    p90_return,
    long_frac,
    ensemble_sharpe,
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
      ? colors.accentGreen
      : bias === "BEARISH"
        ? colors.accentRed
        : colors.accentBlue;

  const bgGlow =
    bias === "BULLISH"
      ? withAlpha(colors.accentGreen, 0.06)
      : bias === "BEARISH"
        ? withAlpha(colors.accentRed, 0.06)
        : withAlpha(colors.accentBlue, 0.04);

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
            fontFamily: fonts.mono,
            fontSize: 12,
            color: colors.textSecondary,
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
            fontFamily: fonts.sans,
            letterSpacing: 2,
          }}
        >
          {bias}
        </span>
        <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
          median ensemble bias
        </div>
        {regime && (
          <div style={{ fontSize: 10, color: colors.textSecondary, marginTop: 4 }}>
            {regime.label.replace("_", "-")} regime ({(regime.confidence * 100).toFixed(0)}% conf)
          </div>
        )}
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
            borderTop: `1px solid ${colors.borderDim}`,
            borderBottom: `1px solid ${colors.borderDim}`,
          }}
        >
          {Object.entries(horizon_signals).map(([h, hs]) => {
            const dirColor =
              hs.direction === "LONG" ? colors.accentGreen : hs.direction === "SHORT" ? colors.accentRed : colors.textSecondary;
            const arrow = hs.direction === "LONG" ? "\u2191" : hs.direction === "SHORT" ? "\u2193" : "\u2192";
            const expectedPts = hs.expected_return * lastClose;
            return (
              <div key={h} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 9, color: colors.textMuted, marginBottom: 2 }}>
                  {formatHorizon(Number(h))}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: dirColor }}>
                  {arrow}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: dirColor,
                    fontFamily: fonts.mono,
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
            color: colors.textSecondary,
            marginBottom: 4,
          }}
        >
          <span>P10-P90 Spread</span>
          <span style={{ fontFamily: fonts.mono }}>
            {spreadPts.toFixed(1)} pts
          </span>
        </div>
        <div
          style={{
            height: 8,
            background: colors.borderDim,
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
              background: `linear-gradient(90deg, ${withAlpha(colors.accentRed, 0.38)}, ${withAlpha(color, 0.25)}, ${withAlpha(colors.accentGreen, 0.38)})`,
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
            color: colors.textMuted,
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
          borderTop: `1px solid ${colors.borderDim}`,
          paddingTop: 10,
        }}
      >
        <StatItem
          label="Median Move"
          value={`${medianPts >= 0 ? "+" : ""}${medianPts.toFixed(1)} pts`}
          color={medianPts > 0 ? colors.accentGreen : medianPts < 0 ? colors.accentRed : colors.textSecondary}
        />
        <StatItem
          label="Paths Up"
          value={`${(long_frac * 100).toFixed(0)}%`}
          subtitle="% of paths ending higher"
          color={long_frac > 0.55 ? colors.accentGreen : long_frac < 0.45 ? colors.accentRed : colors.textSecondary}
        />
        <StatItem
          label="Downside Risk (P10)"
          value={`${p10Pts >= 0 ? "+" : ""}${p10Pts.toFixed(1)} pts`}
          color={colors.accentRed}
        />
        <StatItem
          label="Upside (P90)"
          value={`${p90Pts >= 0 ? "+" : ""}${p90Pts.toFixed(1)} pts`}
          color={colors.accentGreen}
        />
        <StatItem
          label="Signal Sharpe"
          value={ensemble_sharpe.toFixed(2)}
          subtitle="mean/std of returns"
        />
        <StatItem
          label="Risk/Reward"
          value={(() => {
            const absP10 = Math.abs(p10Pts);
            const absP90 = Math.abs(p90Pts);
            if (absP10 < 0.01) return "--";
            const rr = absP90 / absP10;
            return `${rr.toFixed(1)}:1`;
          })()}
          subtitle="P90/P10 asymmetry"
          color={(() => {
            const absP10 = Math.abs(p10Pts);
            const absP90 = Math.abs(p90Pts);
            if (absP10 < 0.01) return colors.textSecondary;
            return absP90 / absP10 > 1.2 ? colors.accentGreen : colors.accentRed;
          })()}
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
      <div style={{ color: colors.textMuted, fontSize: 10 }}>{label}</div>
      <div
        style={{
          color: color ?? colors.textPrimary,
          fontFamily: fonts.mono,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {value}
      </div>
      {subtitle && (
        <div style={{ color: colors.textDim, fontSize: 9, marginTop: 1 }}>{subtitle}</div>
      )}
    </div>
  );
}
