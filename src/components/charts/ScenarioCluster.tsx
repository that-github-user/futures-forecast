/**
 * ScenarioCluster — groups sample paths into meaningful scenario clusters.
 * Each cluster gets a card with label, count, inline SVG sparkline, and terminal return.
 */

import { useMemo, useState } from "react";
import type { PredictionResponse } from "../../api/types";

interface Cluster {
  label: string;
  indices: number[];
  meanReturn: number;
  meanPath: number[];
  color: string;
}

interface Props {
  samplePaths: number[][] | null;
  horizons: number[];
  lastClose: number;
  percentiles: PredictionResponse["percentiles"];
  onClusterHighlight?: (indices: number[] | null) => void;
}

export function ScenarioCluster({
  samplePaths,
  horizons,
  lastClose,
  onClusterHighlight,
}: Props) {
  const [activeCluster, setActiveCluster] = useState<number | null>(null);

  const clusters = useMemo(() => {
    if (!samplePaths?.length || !horizons.length) return [];

    const lastIdx = horizons.length - 1;
    const midIdx = Math.floor(lastIdx / 2);

    // Classify each path
    const classified: { label: string; index: number; termRet: number }[] = [];
    for (let i = 0; i < samplePaths.length; i++) {
      const path = samplePaths[i];
      const termRet = ((path[lastIdx] - lastClose) / lastClose) * 100;
      const midRet = ((path[midIdx] - lastClose) / lastClose) * 100;

      // Check monotonicity
      let rising = true, falling = true;
      for (let j = 1; j < path.length; j++) {
        if (path[j] < path[j - 1]) rising = false;
        if (path[j] > path[j - 1]) falling = false;
      }

      let label: string;
      if (termRet > 0.3 && rising) label = "Bullish Breakout";
      else if (termRet < -0.3 && falling) label = "Bearish Breakdown";
      else if (termRet > -0.15 && termRet < 0.15) label = "Range Bound";
      else if (midRet > 0 && termRet < midRet * 0.3) label = "Bullish Fade";
      else if (midRet < 0 && termRet > midRet * 0.3) label = "Bearish Fade";
      else if (termRet > 0) label = "Up Drift";
      else label = "Down Drift";

      classified.push({ label, index: i, termRet });
    }

    // Group by label
    const groups = new Map<string, typeof classified>();
    for (const c of classified) {
      const arr = groups.get(c.label) ?? [];
      arr.push(c);
      groups.set(c.label, arr);
    }

    // Merge singletons into nearest cluster
    const merged = new Map<string, typeof classified>();
    for (const [label, members] of groups) {
      if (members.length >= 2) {
        merged.set(label, members);
      } else {
        // Find nearest cluster by terminal return
        let bestLabel = "";
        let bestDist = Infinity;
        for (const [l2, m2] of groups) {
          if (l2 === label || m2.length < 2) continue;
          const avgRet = m2.reduce((s, m) => s + m.termRet, 0) / m2.length;
          const dist = Math.abs(members[0].termRet - avgRet);
          if (dist < bestDist) { bestDist = dist; bestLabel = l2; }
        }
        if (bestLabel) {
          const target = merged.get(bestLabel) ?? groups.get(bestLabel) ?? [];
          target.push(...members);
          merged.set(bestLabel, target);
        }
      }
    }

    // Build cluster objects
    const result: Cluster[] = [];
    const colors: Record<string, string> = {
      "Bullish Breakout": "#10b981",
      "Bearish Breakdown": "#ef4444",
      "Range Bound": "#3b82f6",
      "Bullish Fade": "#a3e635",
      "Bearish Fade": "#f97316",
      "Up Drift": "#34d399",
      "Down Drift": "#fb7185",
    };

    for (const [label, members] of merged) {
      const indices = members.map((m) => m.index);
      const meanReturn = members.reduce((s, m) => s + m.termRet, 0) / members.length;

      // Compute mean path
      const meanPath: number[] = [];
      for (let h = 0; h < horizons.length; h++) {
        let sum = 0;
        for (const m of members) sum += samplePaths[m.index][h];
        meanPath.push(sum / members.length);
      }

      result.push({
        label,
        indices,
        meanReturn,
        meanPath,
        color: colors[label] ?? "#94a3b8",
      });
    }

    // Sort by count descending
    result.sort((a, b) => b.indices.length - a.indices.length);
    return result;
  }, [samplePaths, horizons, lastClose]);

  const handleClick = (idx: number) => {
    if (activeCluster === idx) {
      setActiveCluster(null);
      onClusterHighlight?.(null);
    } else {
      setActiveCluster(idx);
      onClusterHighlight?.(clusters[idx].indices);
    }
  };

  if (!clusters.length) {
    return (
      <div className="scenario-cluster" style={{ color: "#64748b", fontSize: 12, padding: 16, textAlign: "center" }}>
        No sample paths available
      </div>
    );
  }

  const totalPaths = samplePaths?.length ?? 0;

  return (
    <div className="scenario-cluster">
      {clusters.map((c, i) => (
        <div
          key={c.label}
          className={`scenario-card${activeCluster === i ? " active" : ""}`}
          onClick={() => handleClick(i)}
          onMouseEnter={() => { if (activeCluster === null) onClusterHighlight?.(c.indices); }}
          onMouseLeave={() => { if (activeCluster === null) onClusterHighlight?.(null); }}
        >
          <div className="scenario-label" style={{ color: c.color }}>{c.label}</div>
          <div className="scenario-count">
            {c.indices.length}/{totalPaths}
          </div>
          <div className="scenario-sparkline">
            <Sparkline path={c.meanPath} color={c.color} lastClose={lastClose} />
          </div>
          <div
            className="scenario-return"
            style={{ color: c.meanReturn >= 0 ? "#10b981" : "#ef4444" }}
          >
            {c.meanReturn >= 0 ? "+" : ""}
            {(c.meanReturn * lastClose / 100).toFixed(1)} pts
          </div>
        </div>
      ))}
    </div>
  );
}

function Sparkline({ path, color, lastClose }: { path: number[]; color: string; lastClose: number }) {
  if (!path.length) return null;
  const w = 100, h = 24;
  const allVals = [...path, lastClose];
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;
  const pad = 2;

  const points = path.map((v, i) => {
    const x = (i / Math.max(path.length - 1, 1)) * (w - pad * 2) + pad;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });

  // Reference line at lastClose
  const refY = h - pad - ((lastClose - min) / range) * (h - pad * 2);

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <line x1={pad} y1={refY} x2={w - pad} y2={refY} stroke="#334155" strokeWidth={0.5} strokeDasharray="2,2" />
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
