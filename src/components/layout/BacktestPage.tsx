/**
 * Backtest page: displays walk-forward cross-validation results.
 * Probabilistic forecast evaluation — calibration, CRPS skill, sharpness.
 */

import { useEffect, useState } from "react";
import {
  BacktestResults,
  type BacktestData,
  type TradingSummary,
} from "../charts/BacktestResults";
import { formatHorizon } from "../../api/format";

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

  const totalFolds =
    data?.probabilistic?.total_folds ||
    data?.trading?.[0]?.aggregate?.total_folds ||
    0;

  const prob = data?.probabilistic;

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
          Probabilistic forecast evaluation across {totalFolds || 8}{" "}
          non-overlapping annual test periods (~7.5 years OOS). Each fold trains
          from scratch on 3 years, validates on 6 months, tests on the next
          year. The model generates 30-sample ensemble trajectory forecasts
          evaluated by distribution calibration and CRPS skill score.
        </p>

        {loading && (
          <div
            style={{ textAlign: "center", padding: 48, color: "#64748b" }}
          >
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
            {/* Forecast quality by horizon table */}
            {prob && (
              <div
                className="panel fade-in"
                style={{ marginBottom: 20, padding: 16 }}
              >
                <div className="panel-header">
                  <span className="panel-title">
                    Forecast Quality by Horizon
                  </span>
                  <span style={{ fontSize: 10, color: "#64748b" }}>
                    {prob.total_windows.toLocaleString()} windows |{" "}
                    {prob.total_folds} folds | vs random walk baseline
                  </span>
                </div>
                <div className="table-scroll">
                <table className="summary-table">
                  <thead>
                    <tr>
                      <th>Horizon</th>
                      <th>CRPS Skill</th>
                      <th>P10-P90 Coverage</th>
                      <th>P10-P90 Width</th>
                      <th>P25-P75 Coverage</th>
                      <th>P25-P75 Width</th>
                      {prob.calibration?.["P10-P90"]?.by_horizon?.[
                        String(prob.horizons[0])
                      ] &&
                        "coverage_recal" in
                          (prob.calibration["P10-P90"].by_horizon[
                            String(prob.horizons[0])
                          ] as Record<string, unknown>) && (
                          <th>Recalibrated</th>
                        )}
                    </tr>
                  </thead>
                  <tbody>
                    {prob.horizons.map((h) => {
                      const hk = String(h);
                      const skill = prob.crps_skill[hk] || 0;
                      const p1090 =
                        prob.calibration?.["P10-P90"]?.by_horizon?.[hk];
                      const p2575 =
                        prob.calibration?.["P25-P75"]?.by_horizon?.[hk];
                      const p1090Any = p1090 as
                        | Record<string, number>
                        | undefined;
                      const hasRecal =
                        p1090Any && "coverage_recal" in p1090Any;
                      const cov1090 = (p1090?.coverage || 0) * 100;
                      const cov2575 = (p2575?.coverage || 0) * 100;
                      const covRecal = hasRecal
                        ? (p1090Any.coverage_recal || 0) * 100
                        : null;

                      const covClass = (
                        actual: number,
                        target: number,
                      ) =>
                        Math.abs(actual - target) < 5
                          ? "pf-good"
                          : actual < target
                            ? "pf-bad"
                            : "pf-ok";

                      return (
                        <tr key={h}>
                          <td style={{ fontWeight: 600 }}>
                            {formatHorizon(h)}
                          </td>
                          <td
                            style={{
                              fontWeight: 700,
                              fontSize: 14,
                              color: "#3b82f6",
                            }}
                          >
                            +{(skill * 100).toFixed(1)}%
                          </td>
                          <td className={covClass(cov1090, 80)}>
                            {cov1090.toFixed(1)}%
                            <span
                              style={{
                                color: "#64748b",
                                fontSize: 10,
                                marginLeft: 4,
                              }}
                            >
                              /80%
                            </span>
                          </td>
                          <td style={{ color: "#94a3b8" }}>
                            {(p1090?.width_pts || 0).toFixed(1)} pts
                          </td>
                          <td className={covClass(cov2575, 50)}>
                            {cov2575.toFixed(1)}%
                            <span
                              style={{
                                color: "#64748b",
                                fontSize: 10,
                                marginLeft: 4,
                              }}
                            >
                              /50%
                            </span>
                          </td>
                          <td style={{ color: "#94a3b8" }}>
                            {(p2575?.width_pts || 0).toFixed(1)} pts
                          </td>
                          {hasRecal && (
                            <td
                              className={covClass(covRecal!, 80)}
                              style={{ fontWeight: 600 }}
                            >
                              {covRecal!.toFixed(1)}%
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            )}

            {/* Charts + detailed results */}
            <BacktestResults data={data} />
          </>
        )}
      </div>
    </div>
  );
}
