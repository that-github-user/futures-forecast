/**
 * StraddleMapChart — vertical-strikes ECharts bar chart for the
 * `/straddle` page.
 *
 * Layout (per spec):
 *   - x-axis is signed NET OI (call_oi - put_oi), symmetric range
 *     derived from `max(|net|)` padded ~10%. One bar per strike,
 *     extending right when calls dominate, left when puts dominate.
 *   - y-axis is the strike price. Range derived from rendered strikes,
 *     padded to ensure both EM bounds and spot are visible.
 *   - Dashed yAxis `markLine`s at em_upper / em_lower.
 *   - Solid yAxis `markLine` at spot.
 *   - Bar color follows hemisphere convention: call-dominant
 *     (right) → accentBlue, put-dominant (left) → accentAmber.
 *   - Net fresh-flow glyph (▲ green opening / ▼ red closing) overlaid
 *     on bars whose |net fresh flow| exceeds a visibility threshold.
 *
 * Chart-lifecycle rules:
 *   - Init once with `[]` dep — the chart instance is held in a ref.
 *   - `setOption(...)` runs in a separate effect with `[data]` so a
 *     polling refresh just updates series; the chart isn't torn down.
 *   - `ResizeObserver` on the container calls `chart.resize()`.
 *   - On unmount we dispose the chart explicitly (echarts holds onto
 *     the canvas otherwise — memory leak in long-running terminals).
 */

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import type { StraddleChainResponse } from "../../api/terminalTypes";
import { buildStraddleMapOption } from "./straddleMapHelpers";

interface Props {
  data: StraddleChainResponse | null;
  height?: number;
}

export function StraddleMapChart({ data, height = 540 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  // ── Init once ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // ── Re-bind options whenever data changes ────────────────────────
  const option = useMemo(() => buildStraddleMapOption(data), [data]);
  useEffect(() => {
    if (!chartRef.current || !option) return;
    // notMerge so removing a series (e.g. strikes shrink) actually
    // clears prior data; clearing on every setOption is overkill.
    chartRef.current.setOption(option, { notMerge: true });
  }, [option]);

  const hasStrikes = !!data && data.strikes.length > 0;

  return (
    <div
      style={{
        position: "relative",
        background: colors.bgPanel,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 6,
        padding: 8,
        height,
        width: "100%",
      }}
    >
      <StraddleMapLegend />
      <div
        ref={containerRef}
        role="img"
        aria-label={
          "Net open interest per strike. Bar right = calls dominant, " +
          "left = puts dominant. EM band drawn as dashed horizontal lines."
        }
        style={{ width: "100%", height: "100%" }}
      />
      {!hasStrikes && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            fontFamily: fonts.sans,
            color: colors.textMuted,
            fontSize: 13,
            letterSpacing: "0.04em",
            background: withAlpha(colors.bgPanel, 0.7),
          }}
        >
          No 0DTE chain data yet
        </div>
      )}
    </div>
  );
}

/** Compact single-row legend overlaid in the chart's top-left corner.
 *  Covers the four symbols the chart uses under the single-bar net-OI
 *  layout:
 *    - Calls dominant (blue square) — bar extends right
 *    - Puts dominant (amber square) — bar extends left
 *    - Net opening flow (▲ green glyph)
 *    - Net closing flow (▼ red glyph)
 *  Positioned absolutely so it doesn't push the chart canvas down. */
function StraddleMapLegend() {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 14,
        zIndex: 2,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        fontFamily: fonts.sans,
        fontSize: 10,
        letterSpacing: "0.04em",
        color: colors.textSecondary,
        pointerEvents: "none",
      }}
    >
      <LegendSwatch
        color={withAlpha(colors.accentBlue, 0.55)}
        label="Calls dominant"
      />
      <LegendSwatch
        color={withAlpha(colors.accentAmber, 0.55)}
        label="Puts dominant"
      />
      <LegendGlyph
        glyph="▲"
        color={colors.accentGreen}
        label="Net opening flow"
      />
      <LegendGlyph
        glyph="▼"
        color={withAlpha(colors.accentRed, 0.85)}
        label="Net closing flow"
      />
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          background: color,
          borderRadius: 2,
        }}
      />
      <span>{label}</span>
    </span>
  );
}

function LegendGlyph({
  glyph,
  color,
  label,
}: {
  glyph: string;
  color: string;
  label: string;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color,
          lineHeight: 1,
        }}
        aria-hidden
      >
        {glyph}
      </span>
      <span>{label}</span>
    </span>
  );
}

