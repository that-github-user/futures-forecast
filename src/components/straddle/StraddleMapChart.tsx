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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import type { StraddleChainResponse } from "../../api/terminalTypes";
import {
  buildReferenceLineIndices,
  buildStraddleMapOption,
  STRADDLE_MAP_GRID,
} from "./straddleMapHelpers";
import "./StraddleMapChart.css";

interface Props {
  data: StraddleChainResponse | null;
  height?: number;
}

export function StraddleMapChart({ data, height = 540 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  // Hold the most recent data on a ref so the ResizeObserver callback
  // can re-apply reference lines after a resize without rebuilding
  // the whole option object.
  const dataRef = useRef<StraddleChainResponse | null>(null);

  // ── Init once ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => {
      chart.resize();
      // Resize invalidates the grid pixel positions used to place
      // the spot/EM lines — recompute against the current data.
      applyReferenceLines(chart, dataRef.current);
    });
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
    dataRef.current = data;
    applyReferenceLines(chartRef.current, data);
  }, [option, data]);

  const hasStrikes = !!data && data.strikes.length > 0;

  // Info popover state (#333). Mirrors the velocity-panel pattern.
  // Callbacks stabilized via useCallback so the HelpPopover's
  // document-listener useEffect doesn't re-bind on every parent
  // render (polling tick re-renders the chart prop chain).
  const [helpOpen, setHelpOpen] = useState(false);
  const onToggleHelp = useCallback(() => setHelpOpen((v) => !v), []);
  const onCloseHelp = useCallback(() => setHelpOpen(false), []);

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
        <InfoButton open={helpOpen} onToggle={onToggleHelp} />
      </div>
      {helpOpen && <HelpPopover onClose={onCloseHelp} />}
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

function InfoButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`smc-info-btn${open ? " active" : ""}`}
      aria-label="How to read the strike positioning chart"
      aria-expanded={open}
      onClick={onToggle}
    >
      ⓘ
    </button>
  );
}

function HelpPopover({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Mirrors the velocity-panel pattern: outside mousedown OR Escape
  // dismisses. Document-mousedown skips clicks on the ⓘ button so
  // the button's own onClick handles the single-state-transition
  // toggle (otherwise mousedown closes + click reopens — racy).
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      const target = e.target as Element | null;
      if (target?.closest(".smc-info-btn")) return;
      onClose();
    }
    function onDocKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="smc-help-popover"
      role="dialog"
      aria-label="How to read the strike positioning chart"
    >
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
    </div>
  );
}

/** Overlay the spot + EM reference lines using ECharts `graphic`
 *  elements positioned by computed pixel y-coordinates. This is the
 *  fix for #321 — `markLine` with a fractional `yAxis` on a
 *  category axis silently rounded to the nearest integer band via
 *  `OrdinalScale.parse`, which mis-aligned the operator's reference
 *  lines by up to ±half a strike interval.
 *
 *  Strategy: `chart.convertToPixel({yAxisIndex: 0}, integerIdx)`
 *  works correctly on category axes — it returns the band-CENTER
 *  pixel for an integer data index. We query two adjacent integer
 *  indices and linearly interpolate to get the pixel position for
 *  any fractional index. Then we draw a line via the `graphic`
 *  component, which lives in pixel-space and bypasses the data-axis
 *  pipeline entirely.
 *
 *  Called from:
 *    - the data-update effect, after every `setOption` call;
 *    - the ResizeObserver, after `chart.resize()` invalidates the
 *      previous grid layout.
 */
function applyReferenceLines(
  chart: echarts.ECharts,
  data: StraddleChainResponse | null,
): void {
  const indices = buildReferenceLineIndices(data);
  if (!data || data.strikes.length === 0) {
    // Clear any leftover graphic elements (e.g. when transitioning
    // from a live snapshot to cold-start).
    chart.setOption({ graphic: [] });
    return;
  }
  const N = data.strikes.length;
  if (N < 2) {
    // Need at least two strikes to interpolate. Single-strike case
    // is degenerate enough to just skip the reference lines.
    chart.setOption({ graphic: [] });
    return;
  }
  // Linear interpolation anchors: pixel y of strike index 0 (top)
  // and strike index N-1 (bottom). `convertToPixel` returns
  // [x, y]; we want the y.
  const topPx = chart.convertToPixel({ yAxisIndex: 0 }, 0);
  const botPx = chart.convertToPixel({ yAxisIndex: 0 }, N - 1);
  if (!Array.isArray(topPx) || !Array.isArray(botPx)) {
    // Chart not laid out yet (race between resize and next layout
    // frame, or pre-first-paint). Clear any stale graphics so a
    // previous-frame overlay doesn't ghost at the wrong pixel y
    // after a resize; the next setOption/resize cycle will retry
    // and re-render the lines at the correct position (#321 R2 nit).
    chart.setOption({ graphic: [] }, { replaceMerge: ["graphic"] });
    return;
  }
  const yTop = topPx[1];
  const yBot = botPx[1];
  // x-extent of the plot area sourced from the same STRADDLE_MAP_GRID
  // constant that buildStraddleMapOption applies to the chart's grid
  // config. Changing one side without the other would render the
  // overlay lines outside the data area.
  const width = chart.getWidth();
  const xLeft = STRADDLE_MAP_GRID.left;
  const xRight = width - STRADDLE_MAP_GRID.right;

  function pxForIndex(idx: number | null): number | null {
    if (idx == null) return null;
    // N >= 2 enforced by the early-return above, so the linear
    // interpolation is safe.
    const frac = idx / (N - 1);
    return yTop + frac * (yBot - yTop);
  }

  type GraphicEl = {
    type: "line" | "text";
    z?: number;
    silent?: boolean;
    shape?: { x1: number; y1: number; x2: number; y2: number };
    style?: Record<string, unknown>;
    position?: [number, number];
  };
  const graphics: GraphicEl[] = [];
  function pushLine(
    y: number,
    cls: "em-upper" | "em-lower" | "spot",
    labelText: string,
  ) {
    const isSpot = cls === "spot";
    graphics.push({
      type: "line",
      z: 50,
      silent: true,
      shape: { x1: xLeft, y1: y, x2: xRight, y2: y },
      style: {
        stroke: isSpot ? colors.textBright : colors.accentAmber,
        lineWidth: isSpot ? 1.6 : 1.2,
        lineDash: isSpot ? undefined : [4, 3],
      },
    });
    graphics.push({
      type: "text",
      z: 51,
      silent: true,
      position: [xRight - 6, y + (cls === "em-lower" ? 4 : -14)],
      style: {
        text: labelText,
        fill: isSpot ? colors.textBright : colors.accentAmber,
        font: `${isSpot ? "bold " : ""}${isSpot ? 11 : 10}px ${fonts.mono}`,
        textAlign: "right",
      },
    });
  }

  const yUp = pxForIndex(indices.emUpper);
  const yLow = pxForIndex(indices.emLower);
  const ySpot = pxForIndex(indices.spot);
  if (yUp != null && data.em_upper != null) {
    pushLine(yUp, "em-upper", `EM+ ${data.em_upper.toFixed(0)}`);
  }
  if (yLow != null && data.em_lower != null) {
    pushLine(yLow, "em-lower", `EM- ${data.em_lower.toFixed(0)}`);
  }
  if (ySpot != null && data.spot != null) {
    pushLine(ySpot, "spot", `SPOT ${data.spot.toFixed(2)}`);
  }
  // `replaceMerge: ["graphic"]` ensures the RESIZE path (which doesn't
  // do a notMerge setOption) replaces the previous frame's graphics
  // rather than merging on top. The data-update path's preceding
  // `setOption(option, { notMerge: true })` already wipes graphics
  // before this runs, so the merge mode there is harmless.
  chart.setOption(
    { graphic: graphics },
    { replaceMerge: ["graphic"] },
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

