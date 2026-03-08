/**
 * Backtest page: displays walk-forward cross-validation results.
 * Fetches from /backtest-results.json (static file in public/).
 */

import { useEffect, useState } from "react";
import {
  BacktestResults,
  type BacktestSummary,
} from "../charts/BacktestResults";

export function BacktestPage() {
  const [results, setResults] = useState<BacktestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(import.meta.env.BASE_URL + "backtest-results.json")
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data: BacktestSummary[]) => {
        setResults(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0e17",
        color: "#e2e8f0",
        padding: "20px",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            fontFamily: "Inter, sans-serif",
            marginBottom: 4,
          }}
        >
          Walk-Forward Backtest
        </h1>
        <p
          style={{
            fontSize: 12,
            color: "#64748b",
            marginBottom: 24,
            fontFamily: "Inter, sans-serif",
          }}
        >
          Out-of-sample results across 8 non-overlapping annual test periods
          (2018-2026). Each fold trains from scratch on 3 years, validates on 6
          months, tests on the next year. No lookahead, no selection bias.
        </p>

        {loading && (
          <div style={{ textAlign: "center", padding: 48, color: "#64748b" }}>
            Loading results...
          </div>
        )}

        {error && (
          <div
            className="panel"
            style={{ padding: 24, textAlign: "center", color: "#64748b" }}
          >
            No backtest results available yet. Results will appear here once
            walk-forward validation completes.
          </div>
        )}

        {!loading && !error && <BacktestResults results={results} />}
      </div>
    </div>
  );
}
