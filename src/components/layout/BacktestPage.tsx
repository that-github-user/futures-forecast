/**
 * Backtest page: displays walk-forward cross-validation results.
 * Probabilistic evaluation (calibration, CRPS) + trading signal results.
 */

import { useEffect, useState } from "react";
import {
  BacktestResults,
  type BacktestData,
  type TradingSummary,
} from "../charts/BacktestResults";

export function BacktestPage() {
  const [data, setData] = useState<BacktestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(import.meta.env.BASE_URL + "backtest-results.json")
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((raw: BacktestData | TradingSummary[]) => {
        // Support both new format {trading, probabilistic} and legacy array format
        if (Array.isArray(raw)) {
          setData({ trading: raw, probabilistic: null as never });
        } else {
          setData(raw);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const totalFolds = data?.probabilistic?.total_folds || data?.trading?.[0]?.aggregate?.total_folds || 0;

  return (
    <div className="backtest-container">
      <div className="backtest-inner">
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            fontFamily: "Inter, sans-serif",
            marginBottom: 4,
          }}
        >
          Walk-Forward Validation
        </h1>
        <p
          style={{
            fontSize: 12,
            color: "#64748b",
            marginBottom: 24,
            fontFamily: "Inter, sans-serif",
            lineHeight: 1.6,
          }}
        >
          Probabilistic forecast evaluation across {totalFolds || 8} non-overlapping annual test
          periods (~7.5 years OOS). Each fold trains from scratch on 3 years, validates on 6
          months, tests on the next year. The model generates 30-sample ensemble trajectory
          forecasts evaluated by calibration, CRPS skill, and signal-based trading performance.
        </p>

        {loading && (
          <div style={{ textAlign: "center", padding: 48, color: "#64748b" }}>
            <div
              style={{
                width: 24,
                height: 24,
                border: "2px solid #1e293b",
                borderTopColor: "#3b82f6",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
                margin: "0 auto 12px",
              }}
            />
            Loading results...
          </div>
        )}

        {error && (
          <div
            className="panel"
            style={{ padding: 32, textAlign: "center", color: "#64748b" }}
          >
            No backtest results available yet. Results will appear here once
            walk-forward validation completes.
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Trading summary table */}
            {data.trading.length > 0 && (
              <div className="panel fade-in" style={{ marginBottom: 20, padding: 16 }}>
                <div className="panel-header">
                  <span className="panel-title">Trading Signal Comparison</span>
                  <span style={{ fontSize: 10, color: "#64748b" }}>
                    {totalFolds} folds | 0.50pt round-trip cost | D'Alembert sizing
                  </span>
                </div>
                <table className="summary-table">
                  <thead>
                    <tr>
                      <th>Config</th>
                      <th>Profit Factor</th>
                      <th>95% CI</th>
                      <th>Win Rate</th>
                      <th>Trades</th>
                      <th>Total PnL</th>
                      <th>Folds &gt; 1.0</th>
                      <th>p-value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trading
                      .sort((a, b) => b.aggregate.profit_factor - a.aggregate.profit_factor)
                      .map((r) => {
                        const a = r.aggregate;
                        const pfClass =
                          a.profit_factor >= 1.15
                            ? "pf-good"
                            : a.profit_factor >= 1.0
                              ? "pf-ok"
                              : "pf-bad";
                        const sig =
                          a.ttest_p < 0.01
                            ? "**"
                            : a.ttest_p < 0.05
                              ? "*"
                              : "";
                        return (
                          <tr key={r.config_label}>
                            <td style={{ fontWeight: 600 }}>{r.config_label}</td>
                            <td className={pfClass} style={{ fontWeight: 700, fontSize: 14 }}>
                              {a.profit_factor.toFixed(2)}
                            </td>
                            <td style={{ color: "#94a3b8" }}>
                              [{a.bootstrap_pf_95ci[0].toFixed(2)},{" "}
                              {a.bootstrap_pf_95ci[1].toFixed(2)}]
                            </td>
                            <td>{(a.win_rate * 100).toFixed(1)}%</td>
                            <td>{a.total_trades}</td>
                            <td
                              style={{
                                color: a.total_pnl >= 0 ? "#10b981" : "#ef4444",
                              }}
                            >
                              {a.total_pnl >= 0 ? "+" : ""}
                              {a.total_pnl.toFixed(0)}
                            </td>
                            <td>
                              {a.folds_profitable}/{a.total_folds}
                            </td>
                            <td
                              style={{
                                color: a.ttest_p < 0.05 ? "#10b981" : "#64748b",
                              }}
                            >
                              {a.ttest_p.toFixed(4)} {sig}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Main results */}
            <BacktestResults data={data} />
          </>
        )}
      </div>
    </div>
  );
}
