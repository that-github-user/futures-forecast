/**
 * TrackRecord — hindcast accuracy panel with rolling stats,
 * per-prediction report cards, and path tracking detail.
 */

import { useMemo, useState } from "react";
import type { HindcastPrediction, RollingAccuracy } from "../../api/types";

interface Props {
  hindcast: HindcastPrediction[];
  rollingAccuracy: RollingAccuracy | null;
}

export function TrackRecord({ hindcast, rollingAccuracy }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  const scored = useMemo(
    () => hindcast.filter((h) => h.scoring != null),
    [hindcast],
  );

  if (!scored.length) {
    return (
      <div style={{ padding: 16, color: "#64748b", fontSize: 11, textAlign: "center" }}>
        Waiting for predictions to be evaluated...
      </div>
    );
  }

  const selected = scored[selectedIdx] ?? scored[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 4, height: "100%", overflow: "hidden" }}>
      <AccuracyStrip accuracy={rollingAccuracy} />
      <PredictionTimeline
        predictions={scored}
        selectedIdx={selectedIdx}
        onSelect={setSelectedIdx}
      />
      <PathTrackingDetail prediction={selected} />
    </div>
  );
}

/* ── Accuracy Strip ── */

function AccuracyStrip({ accuracy }: { accuracy: RollingAccuracy | null }) {
  if (!accuracy) return null;

  const covColor = accuracy.coverage_p10_p90 != null
    ? (accuracy.coverage_p10_p90 >= 0.70 && accuracy.coverage_p10_p90 <= 0.90 ? "#10b981"
      : accuracy.coverage_p10_p90 < 0.50 || accuracy.coverage_p10_p90 > 0.95 ? "#ef4444" : "#f59e0b")
    : "#64748b";

  const dirColor = accuracy.direction_hit_rate != null
    ? (accuracy.direction_hit_rate > 0.55 ? "#10b981"
      : accuracy.direction_hit_rate >= 0.50 ? "#f59e0b" : "#ef4444")
    : "#64748b";

  const trackColor = accuracy.mean_tracking_rmse_pts != null
    ? (accuracy.mean_tracking_rmse_pts < 2 ? "#10b981"
      : accuracy.mean_tracking_rmse_pts < 4 ? "#f59e0b" : "#ef4444")
    : "#64748b";

  return (
    <div style={{ display: "flex", justifyContent: "space-around", padding: "8px 4px", background: "#111827", borderRadius: 6, border: "1px solid #1e293b" }}>
      <MiniStat label="Coverage" value={accuracy.coverage_p10_p90 != null ? `${(accuracy.coverage_p10_p90 * 100).toFixed(0)}%` : "--"} color={covColor} sub="ideal ~80%" />
      <MiniStat label="Direction" value={accuracy.direction_hit_rate != null ? `${(accuracy.direction_hit_rate * 100).toFixed(0)}%` : "--"} color={dirColor} sub="vs coin flip" />
      <MiniStat label="Tracking" value={accuracy.mean_tracking_rmse_pts != null ? `${accuracy.mean_tracking_rmse_pts.toFixed(1)}` : "--"} color={trackColor} sub="best path RMSE" />
      <MiniStat label="n" value={`${accuracy.n_evaluated}`} color="#e2e8f0" sub="evaluated" />
    </div>
  );
}

function MiniStat({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 14, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 8, color: "#475569", marginTop: 1 }}>{sub}</div>
    </div>
  );
}

/* ── Prediction Timeline ── */

function PredictionTimeline({
  predictions,
  selectedIdx,
  onSelect,
}: {
  predictions: HindcastPrediction[];
  selectedIdx: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3, minHeight: 0 }}>
      {predictions.map((pred, i) => {
        const s = pred.scoring!;
        const time = new Date(pred.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
        const dir = s.signal_direction ?? "?";
        const verdictColor = s.verdict === "PASS" ? "#10b981" : s.verdict === "PARTIAL" ? "#f59e0b" : "#ef4444";
        const verdictIcon = s.verdict === "PASS" ? "\u2713" : s.verdict === "PARTIAL" ? "~" : "\u2717";
        const bestPath = s.best_paths?.[0];
        const isSelected = i === selectedIdx;

        return (
          <div
            key={pred.timestamp}
            onClick={() => onSelect(i)}
            style={{
              padding: "6px 10px",
              background: isSelected ? "#0f172a" : "#111827",
              border: `1px solid ${isSelected ? "#334155" : "#1e293b"}`,
              borderRadius: 6,
              cursor: "pointer",
              transition: "border-color 0.15s",
            }}
          >
            {/* Row 1: Time, direction, predicted vs realized */}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
              <span style={{ color: "#94a3b8" }}>{time}</span>
              <span style={{ color: dir === "LONG" ? "#10b981" : dir === "SHORT" ? "#ef4444" : "#94a3b8", fontWeight: 600 }}>
                {dir}
              </span>
              <span style={{ fontFamily: "JetBrains Mono, monospace", color: "#94a3b8", fontSize: 10 }}>
                {s.expected_return_pts != null ? `${s.expected_return_pts >= 0 ? "+" : ""}${s.expected_return_pts.toFixed(1)}` : "?"} pred
                {" / "}
                {s.realized_return_pts != null ? `${s.realized_return_pts >= 0 ? "+" : ""}${s.realized_return_pts.toFixed(1)}` : "?"} real
              </span>
            </div>

            {/* Row 2: Coverage bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <div style={{ flex: 1, height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  width: `${(s.coverage_p10_p90 ?? 0) * 100}%`,
                  height: "100%",
                  background: verdictColor,
                  borderRadius: 2,
                  transition: "width 0.3s",
                }} />
              </div>
              <span style={{ fontSize: 9, color: "#94a3b8", fontFamily: "JetBrains Mono, monospace", minWidth: 32 }}>
                {s.coverage_p10_p90 != null ? `${(s.coverage_p10_p90 * 100).toFixed(0)}%` : "--"}
              </span>
            </div>

            {/* Row 3: Best path + verdict */}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9 }}>
              <span style={{ color: "#64748b" }}>
                {bestPath
                  ? `Path #${bestPath.path_index} tracked ${bestPath.rmse_pts.toFixed(1)}pts for ${bestPath.tracking_duration_bars * 5}min`
                  : "No path data"}
              </span>
              <span style={{ color: verdictColor, fontWeight: 700 }}>
                {verdictIcon} {s.verdict ?? "?"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Path Tracking Detail ── */

function PathTrackingDetail({ prediction }: { prediction: HindcastPrediction }) {
  const scoring = prediction.scoring;
  if (!scoring?.best_paths?.length) {
    return (
      <div style={{ padding: 8, color: "#64748b", fontSize: 10, textAlign: "center" }}>
        Select a prediction to see path tracking detail
      </div>
    );
  }

  const bestPath = scoring.best_paths[0];
  const realized = prediction.realized_prices.filter((v): v is number => v != null);

  if (!realized.length || !bestPath.path_values.length) return null;

  // Build data for the mini-chart: realized + best path values at matching indices
  const realizedIndices = prediction.realized_prices
    .map((v, i) => (v != null ? i : -1))
    .filter((i) => i >= 0);

  const pathAtRealized = realizedIndices
    .map((i) => (i < bestPath.path_values.length ? bestPath.path_values[i] : null))
    .filter((v): v is number => v != null);

  // Compute bounds for zoomed y-axis
  const allVals = [...realized, ...pathAtRealized];
  if (!allVals.length) return null;
  const yMin = Math.min(...allVals);
  const yMax = Math.max(...allVals);
  const yRange = yMax - yMin || 1;
  const yPad = yRange * 0.15;

  const w = 320;
  const h = 80;
  const padX = 4;
  const padY = 4;

  const toX = (i: number) => padX + (i / Math.max(realized.length - 1, 1)) * (w - 2 * padX);
  const toY = (v: number) => h - padY - ((v - (yMin - yPad)) / (yRange + 2 * yPad)) * (h - 2 * padY);

  const realizedPoints = realized.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
  const pathPoints = pathAtRealized.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");

  // Second and third best paths (if available)
  const path2 = scoring.best_paths.length > 1 ? scoring.best_paths[1] : null;
  const path3 = scoring.best_paths.length > 2 ? scoring.best_paths[2] : null;
  const getPathPoints = (pi: typeof path2) => {
    if (!pi) return "";
    return realizedIndices
      .map((idx) => (idx < pi.path_values.length ? pi.path_values[idx] : null))
      .filter((v): v is number => v != null)
      .map((v, i) => `${toX(i)},${toY(v)}`)
      .join(" ");
  };

  const refY = toY(prediction.last_close);

  return (
    <div style={{ padding: "4px 8px" }}>
      <div style={{ fontSize: 9, color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 }}>
        Path Tracking
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
        {/* Reference line at last_close */}
        <line x1={padX} y1={refY} x2={w - padX} y2={refY} stroke="#334155" strokeWidth={0.5} strokeDasharray="2,2" />
        {/* 3rd best path */}
        {path3 && <polyline points={getPathPoints(path3)} fill="none" stroke="#06b6d4" strokeWidth={1} opacity={0.2} strokeLinejoin="round" />}
        {/* 2nd best path */}
        {path2 && <polyline points={getPathPoints(path2)} fill="none" stroke="#06b6d4" strokeWidth={1} opacity={0.35} strokeLinejoin="round" />}
        {/* Best path */}
        <polyline points={pathPoints} fill="none" stroke="#06b6d4" strokeWidth={1.5} opacity={0.8} strokeLinejoin="round" />
        {/* Realized */}
        <polyline points={realizedPoints} fill="none" stroke="#e2e8f0" strokeWidth={2} strokeLinejoin="round" />
      </svg>
      <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
        Path #{bestPath.path_index}: within +/-{bestPath.tracking_threshold_pts}pts for {bestPath.tracking_duration_bars}/{realized.length} bars.
        {" "}RMSE: {bestPath.rmse_pts.toFixed(1)} pts
      </div>
    </div>
  );
}
