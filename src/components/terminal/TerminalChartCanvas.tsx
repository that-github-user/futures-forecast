/**
 * TerminalChartCanvas — replaces the placeholder div in the middle band.
 *
 * Polls /terminal/v1/bars/es-intraday every 30s and renders an ECharts
 * candlestick chart of the last ~48h of ES 1-min bars (RTH + ETH/Globex).
 * Renders horizontal markLine overlays for Session VWAP, anchored
 * VWAPs, POC/VAH/VAL, prior-day HLC, opening range — driven by the
 * caller-supplied `overlays` toggle state.
 *
 * Pan/zoom preservation: the option object is built without dataZoom
 * config on subsequent updates, and `notMerge: false` is set so the
 * user's pan/zoom state survives bar-data refreshes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { CandlestickChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { fetchTerminalIntradayBars, type TerminalIntradayBar } from "../../api/terminalClient";
import type { TerminalSnapshot } from "../../api/terminalTypes";

echarts.use([
  CandlestickChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);

const POLL_INTERVAL_MS = 30_000;

// ── Overlay state shape ─────────────────────────────────────────────

export type OverlayState = {
  sessionVwap: boolean;
  avwaps: boolean;
  pocVa: boolean;
  priorHlc: boolean;
  openingRange: boolean;
};

export const DEFAULT_OVERLAYS: OverlayState = {
  sessionVwap: true,
  avwaps: true,
  pocVa: true,
  priorHlc: true,
  openingRange: true,
};

// ── LUMEN palette resolution ────────────────────────────────────────

function resolveLumenPalette() {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  const cs = root ? getComputedStyle(root) : null;
  const tok = (name: string, fallback: string): string => {
    const v = cs?.getPropertyValue(name).trim();
    return v && v.length > 0 ? v : fallback;
  };
  return {
    posCream: tok("--pos-cream", "#d6c79a"),
    negPersimmon: tok("--neg-persimmon", "#b8746a"),
    paperDeep: tok("--paper-deep", "#08070a"),
    ink100: tok("--ink-100", "#f5efe2"),
    ink80: tok("--ink-80", "#c9c3b6"),
    ink60: tok("--ink-60", "#8c877c"),
    ink40: tok("--ink-40", "#5a564f"),
    ink20: tok("--ink-20", "#2a2823"),
  };
}

type LumenPalette = ReturnType<typeof resolveLumenPalette>;

// ── Component ───────────────────────────────────────────────────────

interface Props {
  snapshot: TerminalSnapshot | null;
  overlays: OverlayState;
}

export function TerminalChartCanvas({ snapshot, overlays }: Props) {
  const [bars, setBars] = useState<TerminalIntradayBar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const palette = useMemo(() => resolveLumenPalette(), []);
  const initialMountRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await fetchTerminalIntradayBars();
        if (!cancelled) {
          setBars(data.bars);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to fetch bars");
        }
      }
    };
    tick();
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Build the option. On the FIRST emission (with bars present), include
  // dataZoom defaults so the chart lands on the recent ~25%. On
  // subsequent emissions, omit dataZoom so the user's pan/zoom state
  // survives merge updates.
  //
  // Reading `initialMountRef.current` during render is fine; the mutation
  // (flip to false) happens post-commit in the useEffect below. This
  // avoids the StrictMode-double-render bug where useMemo's factory runs
  // twice and the second run sees a stale `false` if we mutated inline.
  const option = useMemo(() => {
    if (!bars || bars.length === 0) return null;
    const opt = buildEChartsOption(bars, snapshot, overlays, palette);
    if (initialMountRef.current) {
      opt.dataZoom = [
        {
          type: "inside",
          // Default view: rightmost ~25% of the buffer = ~12h of 1-min
          // bars. User lands on most-recent action and can scroll back.
          start: 75,
          end: 100,
        },
      ];
    }
    return opt;
  }, [bars, snapshot, overlays, palette]);

  // Flip the first-mount flag after the chart has actually mounted with
  // bars present. Subsequent option builds will omit dataZoom config so
  // the user's pan/zoom state isn't reset on each 30s poll.
  useEffect(() => {
    if (bars && bars.length > 0 && initialMountRef.current) {
      initialMountRef.current = false;
    }
  }, [bars]);

  if (error && !bars) {
    return (
      <div className="terminal-chart-canvas">
        <span className="empty">Chart unavailable: {error}</span>
      </div>
    );
  }
  if (!bars) {
    return (
      <div className="terminal-chart-canvas">
        <span className="empty">Loading ES bars…</span>
      </div>
    );
  }
  if (bars.length === 0) {
    return (
      <div className="terminal-chart-canvas">
        <span className="empty">No bars available — IBKR may be reconnecting.</span>
      </div>
    );
  }

  return (
    <div className="terminal-chart-canvas">
      <ReactEChartsCore
        echarts={echarts}
        option={option!}
        style={{ width: "100%", height: "100%" }}
        opts={{ renderer: "canvas" }}
        // notMerge: false → ECharts merges new option into existing
        // chart state. Pan/zoom in the (omitted-from-update) dataZoom
        // config survives bar-data refreshes. Series, xAxis labels,
        // and markLine update normally.
        notMerge={false}
        lazyUpdate={true}
      />
    </div>
  );
}

// ── ECharts option builder ──────────────────────────────────────────

type EChartsOption = Record<string, unknown>;

function buildEChartsOption(
  bars: TerminalIntradayBar[],
  snapshot: TerminalSnapshot | null,
  overlays: OverlayState,
  palette: LumenPalette,
): EChartsOption {
  // ECharts candlestick expects [open, close, low, high]
  const data = bars.map((b) => [b.open, b.close, b.low, b.high]);
  const times = bars.map((b) => formatBarTime(b.time));
  const overlayLines = buildOverlayLines(snapshot, overlays, palette);
  const orBand = buildOpeningRangeBand(snapshot, overlays);
  // Cumulative VWAP series — anchored at the most recent week-start
  // bar (Sunday 6pm ET Globex open / Monday RTH open / after-break).
  // Bars predating the anchor get null so the line doesn't render
  // there; bars at-or-after the anchor get the running VWAP value.
  const sessionVwapSeries = overlays.sessionVwap
    ? buildWeeklyVwapSeries(bars)
    : null;

  return {
    backgroundColor: "transparent",
    animation: false,
    grid: {
      left: 8,
      right: 56,
      top: 6,
      bottom: 28,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: times,
      axisLine: { lineStyle: { color: palette.ink40 } },
      axisLabel: {
        color: palette.ink60,
        fontSize: 10,
        fontFamily: "var(--font-mono, monospace)",
        hideOverlap: true,
      },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      position: "right",
      scale: true,
      axisLine: { show: false },
      axisLabel: {
        color: palette.ink60,
        fontSize: 10,
        fontFamily: "var(--font-mono, monospace)",
      },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: palette.ink20 } },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", lineStyle: { color: palette.ink40 } },
      backgroundColor: palette.paperDeep,
      borderColor: palette.ink40,
      textStyle: {
        color: palette.ink100,
        fontFamily: "var(--font-mono, monospace)",
        fontSize: 11,
      },
      formatter: (params: unknown) => {
        const arr = params as Array<{
          seriesType: string;
          dataIndex: number;
          data: number[] | number | null;
        }>;
        const candle = arr.find((p) => p.seriesType === "candlestick");
        if (!candle) return "";
        const i = candle.dataIndex;
        const b = bars[i];
        if (!b) return "";
        const fmt = (n: number) => n.toFixed(2);
        const lines = [
          `<div style="opacity:0.6;font-size:10px;letter-spacing:0.08em">${formatBarTime(b.time, true)}</div>`,
          `O ${fmt(b.open)}  H ${fmt(b.high)}`,
          `L ${fmt(b.low)}  C ${fmt(b.close)}`,
          `<div style="opacity:0.55;font-size:10px;margin-top:2px">vol ${b.volume.toFixed(0)}</div>`,
        ];
        // Append VWAP value at this bar if the series is rendered.
        const lineSeries = arr.find(
          (p) => p.seriesType === "line" && typeof p.data === "number",
        );
        if (lineSeries && typeof lineSeries.data === "number") {
          lines.push(
            `<div style="margin-top:2px;opacity:0.85">VWAP ${fmt(lineSeries.data)}</div>`,
          );
        }
        return lines.join("<br/>");
      },
    },
    series: [
      {
        type: "candlestick",
        data,
        itemStyle: {
          // FT-style hollow-up / filled-down convention. Tokens
          // resolved from CSS vars at component mount.
          color: "rgba(0,0,0,0)",
          color0: palette.negPersimmon,
          borderColor: palette.posCream,
          borderColor0: palette.negPersimmon,
          borderWidth: 1,
        },
        markLine: {
          // silent: true → markLines don't capture mouse events, so
          // the candlestick tooltip still fires on hover.
          silent: true,
          symbol: "none",
          // Spec §4.2: "Annotations never sit on the candles." Inline
          // labels (the ECharts default) are explicitly rejected. The
          // proper home is a 100px right gutter with hairline leaders;
          // implementing that needs custom rendering and is scoped as
          // a follow-up. For now, lines render without labels — the
          // user identifies them via the toggle pills above the chart.
          label: { show: false },
          // ECharts merges arrays as a unit, so passing the full list
          // each time is safe — toggling overlays off removes their
          // line from the data array.
          data: overlayLines.map((line) => ({
            yAxis: line.value,
            lineStyle: {
              color: line.color,
              type: line.style,
              width: line.width,
            },
          })),
        },
        // Opening range — spec §4.2 calls for a shaded band at 5%
        // ink-100 opacity, not two dashed lines. ECharts markArea
        // renders a horizontal band between the [low, high] pair.
        markArea: {
          silent: true,
          itemStyle: {
            color: hexToRgba(palette.ink100, 0.05),
            borderWidth: 0,
          },
          data: orBand
            ? [[{ yAxis: orBand.low }, { yAxis: orBand.high }]]
            : [],
        },
      },
      // Session VWAP as a cumulative time-varying line, anchored at the
      // current week's Globex open. Spec §4.2: ink-100, 1.5px solid.
      // ECharts merges series by index — when overlay toggles off,
      // pushing an empty data array hides the line. We always include
      // the series so the index stays stable across renders.
      {
        type: "line",
        data: sessionVwapSeries ?? [],
        showSymbol: false,
        sampling: "lttb",
        smooth: false,
        connectNulls: false,
        lineStyle: {
          color: palette.ink100,
          width: 1.5,
        },
        z: 5,
        silent: true,
      },
    ],
  };
}

// ── Overlay builder — derives lines from snapshot + toggle state ────

// Overlay weights/colors/styles follow spec §4.2 (lines 484-494). The
// "single accent each" restraint is the rule: every overlay uses one of
// {ink-100, ink-80, ink-60} with explicit width and dash pattern.
// `--lumen` is forbidden (§2.1); persimmon is reserved for negative
// signals only.
type OverlayLine = {
  value: number;
  color: string;
  style: "solid" | "dashed" | "dotted";
  width: number;
};

function buildOverlayLines(
  snapshot: TerminalSnapshot | null,
  overlays: OverlayState,
  palette: LumenPalette,
): OverlayLine[] {
  if (!snapshot) return [];
  const lines: OverlayLine[] = [];
  const v = snapshot.vwap;
  const lv = snapshot.levels;

  // Note: Session VWAP is rendered as a separate cumulative line
  // series (see `buildWeeklyVwapSeries` and the `series[1]` line in
  // the option builder), NOT as a static markLine. A flat horizontal
  // line at the current VWAP value would be wrong — VWAP evolves
  // through the session.

  // Spec §4.2: AVWAPs → ink-80, 1px dashed.
  if (overlays.avwaps) {
    for (const a of v.anchored) {
      if (a.value != null) {
        lines.push({ value: a.value, color: palette.ink80, style: "dashed", width: 1 });
      }
    }
  }

  // Spec §4.2: POC → ink-80, 1.5px solid; VAH/VAL → ink-60, 1px dashed.
  if (overlays.pocVa) {
    if (lv.poc != null) {
      lines.push({ value: lv.poc, color: palette.ink80, style: "solid", width: 1.5 });
    }
    if (lv.vah != null) {
      lines.push({ value: lv.vah, color: palette.ink60, style: "dashed", width: 1 });
    }
    if (lv.val != null) {
      lines.push({ value: lv.val, color: palette.ink60, style: "dashed", width: 1 });
    }
  }

  // Spec §4.2: Prior-day HLC → ink-60, 1px DOTTED (all three).
  if (overlays.priorHlc) {
    if (lv.pd_high != null) {
      lines.push({ value: lv.pd_high, color: palette.ink60, style: "dotted", width: 1 });
    }
    if (lv.pd_close != null) {
      lines.push({ value: lv.pd_close, color: palette.ink60, style: "dotted", width: 1 });
    }
    if (lv.pd_low != null) {
      lines.push({ value: lv.pd_low, color: palette.ink60, style: "dotted", width: 1 });
    }
  }

  return lines;
}

// Opening range is rendered as a SHADED BAND, not lines — spec §4.2
// "shaded band at 5% --ink-100 opacity." Returns the [low, high] pair
// or null if either bound is missing.
function buildOpeningRangeBand(
  snapshot: TerminalSnapshot | null,
  overlays: OverlayState,
): { low: number; high: number } | null {
  if (!snapshot || !overlays.openingRange) return null;
  const lv = snapshot.levels;
  if (lv.or_low == null || lv.or_high == null) return null;
  return { low: lv.or_low, high: lv.or_high };
}

// ── Cumulative weekly-anchored VWAP ────────────────────────────────

/**
 * Compute the running VWAP series anchored at the most recent week
 * boundary. Ports the TradingView ta.vwap() formula 1:1:
 *   typical = (high + low + close) / 3
 *   VWAP[i] = cumsum(typical × vol) / cumsum(vol), reset at week start
 *
 * Returns an array aligned 1:1 with `bars`. Bars predating the current
 * week's anchor get `null` so ECharts doesn't render the line there
 * (with `connectNulls: false`); bars at-or-after the anchor get the
 * running VWAP value.
 *
 * Anchor detection: the most-recent ≥36h gap between consecutive bars
 * (= the weekend halt: Friday 5pm ET → Sunday 6pm ET). Falls back to
 * the first bar if no such gap exists in the buffer.
 */
function buildWeeklyVwapSeries(bars: TerminalIntradayBar[]): (number | null)[] {
  if (bars.length === 0) return [];

  // Find the most-recent week anchor index by scanning backward for
  // a ≥36h gap between consecutive bars.
  const ANCHOR_GAP_MS = 36 * 60 * 60 * 1000;
  let anchorIdx = 0;
  for (let i = bars.length - 1; i > 0; i--) {
    const t = Date.parse(bars[i].time);
    const tPrev = Date.parse(bars[i - 1].time);
    if (Number.isFinite(t) && Number.isFinite(tPrev) && t - tPrev >= ANCHOR_GAP_MS) {
      anchorIdx = i;
      break;
    }
  }

  const out: (number | null)[] = new Array(bars.length).fill(null);
  let cumTpVol = 0;
  let cumVol = 0;
  for (let i = anchorIdx; i < bars.length; i++) {
    const b = bars[i];
    const typical = (b.high + b.low + b.close) / 3;
    const vol = b.volume > 0 ? b.volume : 1;
    cumTpVol += typical * vol;
    cumVol += vol;
    out[i] = cumVol > 0 ? cumTpVol / cumVol : null;
  }
  return out;
}

// Convert "#rrggbb" or "#rgb" → "rgba(r,g,b,a)" so we can apply the
// spec's 5% opacity tone for the OR band without losing the LUMEN
// token. Falls back to returning the raw input on a parse miss.
function hexToRgba(hex: string, alpha: number): string {
  let s = hex.replace("#", "");
  // Expand shorthand "#rgb" → "#rrggbb" before parsing.
  if (s.length === 3) {
    s = s.split("").map((c) => c + c).join("");
  }
  const m = s.match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Time formatting ─────────────────────────────────────────────────

function formatBarTime(iso: string, withSeconds: boolean = false): string {
  // Input: "2026-04-26T22:01:00Z" → display "22:01" UTC
  // (UTC labels for now; ET-localized labels are a follow-up NIT.)
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  const time = `${hh}:${mm}${withSeconds ? `:${d.getUTCSeconds().toString().padStart(2, "0")}` : ""}`;
  return time;
}
