/**
 * AnalyticsCards — compact strip of 5 analytics engine metrics.
 * Top row: Regime Badge, Exhaustion Gauge, Ensemble Agreement
 * Bottom row: Signal Percentile, Invalidation Level
 */

import type { InvalidationInfo, RegimeInfo, RegimePerformance } from "../../api/types";

interface Props {
  regime: RegimeInfo | null;
  exhaustionScore: number | null;
  ensembleAgreement: number | null;
  signalPercentile: number | null;
  invalidation: InvalidationInfo | null;
  regimePerformance: RegimePerformance | null;
  lastClose: number;
  direction: string;
}

const REGIME_COLORS: Record<string, string> = {
  trending: "#3b82f6",
  "mean-reverting": "#f59e0b",
  mean_reverting: "#f59e0b",
  volatile: "#ef4444",
  quiet: "#64748b",
};

export function AnalyticsCards({
  regime,
  exhaustionScore,
  ensembleAgreement,
  signalPercentile,
  invalidation,
  regimePerformance,
  direction,
}: Props) {
  const regimeColor = regime ? (REGIME_COLORS[regime.label] ?? "#64748b") : "#64748b";
  const regimeLabel = regime?.label?.replace("_", "-") ?? "--";

  // Exhaustion color ramp
  const exhVal = exhaustionScore ?? 0;
  const exhColor = exhVal > 2 ? "#ef4444" : exhVal > 1 ? "#f59e0b" : "#10b981";
  const exhPct = Math.min(exhVal / 3, 1) * 100;
  const exhAlert = exhVal > 2;

  // Agreement color
  const agrVal = ensembleAgreement ?? 0;
  const agrColor = agrVal > 0.8 ? "#10b981" : agrVal > 0.5 ? "#f59e0b" : "#ef4444";

  // Signal percentile color
  const pctVal = signalPercentile ?? 0;
  const pctColor = pctVal > 75 ? "#10b981" : pctVal < 25 ? "#ef4444" : "#94a3b8";

  // Invalidation arrow
  const invDir = invalidation?.price_direction;
  const invArrow = invDir === "below" ? "\u2193" : invDir === "above" ? "\u2191" : "\u2194";
  const invColor = direction === "LONG" ? "#ef4444" : direction === "SHORT" ? "#ef4444" : "#94a3b8";

  return (
    <div className="analytics-cards-wrap">
      <div className="analytics-cards">
        {/* Row 1: Regime, Exhaustion, Agreement */}
        <div className={`analytics-card`}>
          <div className="card-label">Regime</div>
          <div
            className="card-value"
            style={{
              color: regimeColor,
              fontSize: 13,
              textTransform: "capitalize",
            }}
          >
            {regimeLabel}
          </div>
          {regimePerformance && (
            <div className="card-sub">
              WR: {(regimePerformance.win_rate * 100).toFixed(0)}% | PF:{" "}
              {regimePerformance.profit_factor.toFixed(2)} (n=
              {regimePerformance.n_trades})
            </div>
          )}
        </div>

        <div className={`analytics-card${exhAlert ? " exhaustion-alert" : ""}`}>
          <div className="card-label">Exhaustion</div>
          <div className="card-value" style={{ color: exhColor, fontSize: 16 }}>
            {exhaustionScore != null ? exhaustionScore.toFixed(1) : "--"}
          </div>
          <div
            style={{
              height: 4,
              background: "#1e293b",
              borderRadius: 2,
              marginTop: 4,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${exhPct}%`,
                height: "100%",
                background: exhColor,
                borderRadius: 2,
                transition: "width 0.3s",
              }}
            />
          </div>
        </div>

        <div className="analytics-card">
          <div className="card-label">Agreement</div>
          <div className="card-value" style={{ color: agrColor, fontSize: 16 }}>
            {ensembleAgreement != null
              ? `${(ensembleAgreement * 100).toFixed(0)}%`
              : "--"}
          </div>
          <div className="card-sub">sub-ensemble consensus</div>
        </div>
      </div>

      <div className="analytics-cards" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* Row 2: Signal Percentile, Invalidation */}
        <div className="analytics-card">
          <div className="card-label">Signal Rank</div>
          <div className="card-value" style={{ color: pctColor, fontSize: 16 }}>
            {signalPercentile != null ? `${signalPercentile}` : "--"}
          </div>
          <div className="card-sub">vs. last 500 signals</div>
        </div>

        <div className="analytics-card">
          <div className="card-label">Invalidation</div>
          <div className="card-value" style={{ color: invColor, fontSize: 14 }}>
            {invalidation ? (
              <>
                <span style={{ marginRight: 4 }}>{invArrow}</span>
                {invalidation.price_level.toFixed(2)}
              </>
            ) : (
              "--"
            )}
          </div>
          {invalidation && (
            <div className="card-sub">{invalidation.description}</div>
          )}
        </div>
      </div>
    </div>
  );
}
