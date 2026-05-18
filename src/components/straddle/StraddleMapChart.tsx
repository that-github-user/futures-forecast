/**
 * StraddleMapChart — horizontal-bar diverging chart for the
 * `/straddle` page. Strikes on the vertical (category) y-axis, bars
 * emanating left/right from the central x=0 baseline (the y-axis
 * line itself).
 *
 * Layout (per spec):
 *   - x-axis is signed NET OI (call_oi - put_oi), symmetric range
 *     derived from `max(|net|)` padded ~10%. One bar per strike,
 *     extending RIGHT when calls dominate, LEFT when puts dominate.
 *   - y-axis is the strike price as a CATEGORY axis (strings), sorted
 *     descending with `inverse: true` so the highest strike sits at
 *     the TOP of the chart — matching how operators read option
 *     chains (calls/upside above, puts/downside below the ATM line).
 *   - Spot + EM reference lines are drawn as ECharts `graphic`
 *     overlays in pixel space (see `applyReferenceLines`). They were
 *     previously `markLine` entries with fractional `yAxis` values,
 *     but ECharts 6.x's `OrdinalScale.parse` rounds those via
 *     `Math.round`, mis-aligning the lines by up to ±half a strike
 *     interval (#321). The graphic overlay bypasses the data-axis
 *     coord pipeline by computing pixel positions via
 *     `chart.convertToPixel` between integer category indices and
 *     interpolating fractionally.
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
import { applyReferenceLines } from "./applyReferenceLines";
import { InfoPopover } from "../common/InfoPopover";
import "./StraddleMapChart.css";

interface Props {
  data: StraddleChainResponse | null;
  height?: number;
}

export function StraddleMapChart({ data, height = 540 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  // Hold the most recent data on a ref so the chart's `finished`
  // event handler (and the ResizeObserver) can re-apply reference
  // lines against the LATEST data, not the data captured by the
  // closure at the time the handler was registered. Solves R1+R2's
  // "stale-data closure" finding.
  const dataRef = useRef<StraddleChainResponse | null>(null);
  // Cache key of the last successfully applied reference-line
  // graphics. Breaks the `finished` → setOption({graphic}) →
  // `finished` re-fire loop the same way TentChart does (#347).
  const lastAppliedRef = useRef<string>("");

  // ── Init once ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;

    // ECharts fires 'finished' deterministically after every layout
    // completes (initial paint, setOption, resize). Hooking the
    // reference-line application here means we never have to guess
    // whether `convertToPixel` is ready — it always is by the time
    // 'finished' fires. Replaces the prior rAF-poll workaround which
    // R1+R2 flagged for disposed-chart access and stale-closure bugs.
    const onFinished = () => {
      // Read the latest data via the ref, not via closure — a new
      // data poll between setOption and the 'finished' event would
      // otherwise apply stale EM positions.
      applyReferenceLines(chart, dataRef.current, lastAppliedRef);
    };
    try {
      chart.on("finished", onFinished);
    } catch {
      // chart was disposed between init and event registration — no-op
    }

    const ro = new ResizeObserver(() => {
      try {
        chart.resize();
      } catch {
        // chart disposed mid-resize — no-op
      }
      // With `animation: false` in the chart option, ECharts' 'finished'
      // event doesn't reliably fire after resize() either. Apply the
      // reference lines explicitly so a window resize redraws them at
      // the new plot-area width. The cache key includes xRight so this
      // call DOES write fresh graphics when width changed (and short-
      // circuits when nothing did).
      applyReferenceLines(chart, dataRef.current, lastAppliedRef);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      try {
        chart.off("finished", onFinished);
      } catch {
        // already disposed — no-op
      }
      chart.dispose();
      chartRef.current = null;
      // Reset cache so a remount doesn't think it already applied.
      lastAppliedRef.current = "";
    };
  }, []);

  // ── Re-bind options whenever data changes ────────────────────────
  const option = useMemo(() => buildStraddleMapOption(data), [data]);
  useEffect(() => {
    if (!chartRef.current) return;
    if (!option) {
      // Cold-start transition (populated → null/empty). buildStraddle-
      // MapOption returns null when data is null or strikes is empty.
      // We can't call setOption(null, …) — that would throw. But we
      // STILL need to wipe stale reference lines that were drawn on
      // the previous frame's chart, otherwise EM/spot lines ghost
      // over the empty placeholder (R2 blocker on round 1 of #226).
      // Update dataRef so the next 'finished' (if one fires from a
      // resize) sees null and bails, and call applyReferenceLines
      // directly to perform the clear right now.
      dataRef.current = data;
      applyReferenceLines(chartRef.current, data, lastAppliedRef);
      return;
    }
    // notMerge so removing a series (e.g. strikes shrink) actually
    // clears prior data; clearing on every setOption is overkill.
    try {
      chartRef.current.setOption(option, { notMerge: true });
    } catch {
      // chart disposed between option-build and setOption — bail
      return;
    }
    dataRef.current = data;
    // notMerge wipes graphics; the cache key must be reset so the
    // next applyReferenceLines call writes a fresh set.
    lastAppliedRef.current = "";
    // Explicit kick: don't rely solely on ECharts' 'finished' event
    // — with `animation: false` in the chart option, 'finished' is
    // not reliably emitted in ECharts 6.x (operator-confirmed
    // production symptom: bars rendered, EM lines didn't). Matches
    // TentChart's pattern (#347) which calls updateGraphic()
    // explicitly after init AND registers the 'finished' listener
    // for subsequent resizes. setOption updates layout synchronously
    // for non-animated charts, so convertToPixel is safe to call
    // here. If layout ISN'T ready (NaN pixels), applyReferenceLines
    // bails without writing and the 'finished' listener provides
    // defense in depth.
    applyReferenceLines(chartRef.current, data, lastAppliedRef);
  }, [option, data]);

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
      <div className="smc-info-anchor">
        <InfoPopover label="How to read the strike positioning chart">
          <ul>
            <li>
              <b>Each row</b> is one strike, highest strike at the top.
            </li>
            <li>
              <b>Bars</b> extend right for call-dominant strikes
              (<span className="swatch call" /> blue) and left for put-dominant
              (<span className="swatch put" /> amber); length = |NET OI|.
            </li>
            <li>
              <span className="glyph up">▲</span> on a bar = significant net
              opening flow; <span className="glyph dn">▼</span> = net closing.
              Threshold-gated so quiet strikes stay quiet.
            </li>
            <li>
              <b>Dashed amber lines</b> = expected-move (EM) upper/lower bounds.
              <b> Solid white line</b> = current spot. Both interpolate between
              strike rows to land at the exact price.
            </li>
            <li>
              Hover any bar for the full call/put split — OI, volume, IV, Δ,
              fresh-flow — plus spot proximity and an <b>EM</b> badge when the
              strike is inside today's expected move.
            </li>
          </ul>
        </InfoPopover>
      </div>
      <div
        ref={containerRef}
        role="img"
        aria-label={
          "Net open interest per strike. Bar right = calls dominant, " +
          "left = puts dominant. EM band drawn as dashed horizontal " +
          "lines. Triangle glyphs mark strikes with significant net " +
          "opening (up) or closing (down) flow."
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

