/**
 * TerminalChartCanvas — replaces the placeholder div in the middle band.
 *
 * Polls /terminal/v1/bars/es-intraday every 30s and renders an ECharts
 * candlestick chart of the last ~48h of ES bars (RTH + ETH/Globex). The
 * AVWAP system supports three independent anchors {Week, Daily Globex,
 * RTH} × three rendering options {VWAP line, ±1σ band, ±2σ band}. Static
 * markLine overlays for POC/VAH/VAL, prior-day HLC, opening range are
 * driven by the caller-supplied `overlays` toggle state.
 *
 * Pan/zoom preservation: the option object is built without dataZoom
 * config on subsequent updates, and `notMerge: false` is set so the
 * user's pan/zoom state survives bar-data refreshes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// ── AVWAP anchor configuration ─────────────────────────────────────

export type VwapAnchorKey = "week" | "daily" | "rth";

export type VwapAnchorState = {
  vwap: boolean;
  band1: boolean;
  band2: boolean;
};

export type VwapOverlayState = Record<VwapAnchorKey, VwapAnchorState>;

export const VWAP_ANCHORS: { key: VwapAnchorKey; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "daily", label: "Daily" },
  { key: "rth", label: "RTH" },
];

// ── Overlay state shape ─────────────────────────────────────────────

export type OverlayState = {
  vwap: VwapOverlayState;
  pocVa: boolean;
  priorHlc: boolean;
  openingRange: boolean;
};

export const DEFAULT_OVERLAYS: OverlayState = {
  vwap: {
    week: { vwap: true, band1: false, band2: false },
    daily: { vwap: false, band1: false, band2: false },
    rth: { vwap: false, band1: false, band2: false },
  },
  pocVa: true,
  priorHlc: true,
  openingRange: true,
};

// ── Timeframe ──────────────────────────────────────────────────────

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h";

export const DEFAULT_TIMEFRAME: Timeframe = "5m";

const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
};

/**
 * Bin 1-min bars into N-minute aggregated bars using UTC-clock-aligned
 * bucket boundaries (e.g. 5m → 09:30, 09:35, 09:40 …). Across-session
 * gaps don't span buckets because the session-open timestamp lands in
 * its own bucket. Each bar's bucket is the floor of `time / N` × N.
 *
 * `time` of the aggregated bar is the bucket-start ISO; OHLC follows
 * the standard convention (open = first bar's open, high/low =
 * extrema, close = last bar's close, volume = sum).
 *
 * Caveat for 4h: UTC-aligned 4h buckets (00/04/08/12/16/20 UTC) don't
 * line up with ET RTH-open at 13:30 UTC — RTH open lands mid-bucket
 * inside the 12:00-15:59 UTC bar. Acceptable for "structure read"
 * use of 4h; if RTH-open precision matters we'd need ET-anchored
 * bucketing for 4h only. Tracked as a follow-up.
 */
function aggregateBars(
  bars: TerminalIntradayBar[],
  minutes: number,
): TerminalIntradayBar[] {
  if (minutes <= 1 || bars.length === 0) return bars;
  const intervalMs = minutes * 60_000;
  const buckets = new Map<number, TerminalIntradayBar[]>();
  for (const b of bars) {
    const t = Date.parse(b.time);
    if (!Number.isFinite(t)) continue;
    const key = Math.floor(t / intervalMs) * intervalMs;
    let group = buckets.get(key);
    if (!group) {
      group = [];
      buckets.set(key, group);
    }
    group.push(b);
  }
  const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);
  const out: TerminalIntradayBar[] = [];
  for (const key of sortedKeys) {
    const group = buckets.get(key)!;
    if (group.length === 0) continue;
    const time = new Date(key).toISOString().replace(/\.\d{3}Z$/, "Z");
    let high = group[0].high;
    let low = group[0].low;
    let volume = 0;
    for (const b of group) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      volume += b.volume;
    }
    out.push({
      time,
      open: group[0].open,
      high,
      low,
      close: group[group.length - 1].close,
      volume,
    });
  }
  return out;
}

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
  timeframe: Timeframe;
  // Bar-time formatter from the parent's useTimezone hook. Threaded
  // through as a prop (not called per-component) so a single hook
  // instance owns the storage-key state and the parent's selector
  // and the chart stay in lockstep.
  formatBarTime: (iso: string, withSeconds?: boolean) => string;
  // Day-of-month formatter (returns "DD"). Used by the x-axis label
  // generator: when bar i's day differs from bar i-1's, that bar
  // gets "DD" instead of "HH:MM" — a TradingView-style date marker
  // at midnight crossings and the Friday→Sunday weekend reopen.
  formatBarDay: (iso: string) => string;
  // Short label for the active timezone (e.g. "PT", "PDT"). Suffixed
  // onto the tooltip header so the user always knows what timezone
  // they're reading without glancing back at the selector.
  tzLabel: string;
}

export function TerminalChartCanvas({
  snapshot,
  overlays,
  timeframe,
  formatBarTime,
  formatBarDay,
  tzLabel,
}: Props) {
  const [bars, setBars] = useState<TerminalIntradayBar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const palette = useMemo(() => resolveLumenPalette(), []);
  const initialMountRef = useRef(true);
  // ECharts instance handle for the post-render collision pass on
  // markLine label chips. We need pixel coords (not data y) to
  // detect chip overlap; the chart instance exposes convertToPixel.
  const chartRef = useRef<ReactEChartsCore | null>(null);
  // Per-overlay-line vertical offset in pixels, indexed by the order
  // produced by buildOverlayLines. 0 = no offset; positive = chip
  // pushed down, negative = chip pushed up.
  const [labelOffsets, setLabelOffsets] = useState<number[]>([]);

  // Aggregate the raw 1-min bars into the user-selected timeframe. All
  // downstream math (VWAP, default-zoom span, candle rendering) reads
  // `aggregatedBars` so the rest of the pipeline is timeframe-agnostic.
  const aggregatedBars = useMemo(
    () => (bars ? aggregateBars(bars, TIMEFRAME_MINUTES[timeframe]) : null),
    [bars, timeframe],
  );

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
  // dataZoom defaults so the chart lands on a sensible recent window.
  // On subsequent emissions, omit dataZoom so the user's pan/zoom state
  // survives merge updates.
  //
  // Reading `initialMountRef.current` during render is fine; the mutation
  // (flip to false) happens post-commit in the useEffect below. This
  // avoids the StrictMode-double-render bug where useMemo's factory runs
  // twice and the second run sees a stale `false` if we mutated inline.
  const option = useMemo(() => {
    if (!aggregatedBars || aggregatedBars.length === 0) return null;
    const opt = buildEChartsOption(
      aggregatedBars,
      snapshot,
      overlays,
      palette,
      TIMEFRAME_MINUTES[timeframe],
      labelOffsets,
      formatBarTime,
      formatBarDay,
      tzLabel,
    );
    if (initialMountRef.current) {
      opt.dataZoom = [
        {
          type: "inside",
          start: computeDefaultZoomStart(aggregatedBars),
          end: 100,
        },
      ];
    }
    return opt;
  }, [aggregatedBars, snapshot, overlays, palette, timeframe, labelOffsets, formatBarTime, formatBarDay, tzLabel]);

  // Flip the first-mount flag after the chart has actually mounted with
  // bars present. Subsequent option builds will omit dataZoom config so
  // the user's pan/zoom state isn't reset on each 30s poll.
  useEffect(() => {
    if (aggregatedBars && aggregatedBars.length > 0 && initialMountRef.current) {
      initialMountRef.current = false;
    }
  }, [aggregatedBars]);

  // Post-render collision pass on the right-edge label chips.
  // Re-derive overlay lines, ask the chart instance for each line's
  // pixel y, cluster overlapping chips, and store per-line vertical
  // offsets. Triggered both on data updates (bars / snapshot /
  // overlays change) and on user pan/zoom (`dataZoom` event via the
  // `onEvents` prop on ReactEChartsCore — re-binds automatically if
  // the underlying instance is recreated).
  //
  // The state-update guard is the array equality on labelOffsets
  // (see setLabelOffsets call below). `labelOffsets` is intentionally
  // not a dep of this useCallback — `setLabelOffsets((prev) => …)`
  // already gives us the latest value, and including labelOffsets
  // would invalidate the listener identity on every settle.
  const recomputeLabelOffsets = useCallback(() => {
    const inst = chartRef.current?.getEchartsInstance();
    if (!inst) return;
    const lines = buildOverlayLines(snapshot, overlays, palette);
    const next = computeCollisionOffsets(lines, inst);
    setLabelOffsets((prev) => (arraysEqual(prev, next) ? prev : next));
  }, [snapshot, overlays, palette]);

  useEffect(() => {
    if (!aggregatedBars || aggregatedBars.length === 0) return;
    // Run on the next paint so the chart has flushed its render and
    // convertToPixel returns valid coordinates.
    const id = window.requestAnimationFrame(recomputeLabelOffsets);
    return () => window.cancelAnimationFrame(id);
  }, [aggregatedBars, recomputeLabelOffsets]);

  // Debounced dataZoom handler. ReactEChartsCore's `onEvents` prop
  // wires this through the canonical event-binding lifecycle so it
  // re-binds automatically if ECharts recreates the underlying
  // instance (vs `inst.on` which would leak a handler bound to a
  // stale instance).
  const onChartEvents = useMemo(() => {
    let timer = 0;
    return {
      dataZoom: () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(recomputeLabelOffsets, 80);
      },
    };
  }, [recomputeLabelOffsets]);

  if (error && !bars) {
    return (
      <div className="terminal-chart-canvas">
        <span className="empty">Chart unavailable: {error}</span>
      </div>
    );
  }
  if (!aggregatedBars) {
    return (
      <div className="terminal-chart-canvas">
        <span className="empty">Loading ES bars…</span>
      </div>
    );
  }
  if (aggregatedBars.length === 0) {
    return (
      <div className="terminal-chart-canvas">
        <span className="empty">No bars available — IBKR may be reconnecting.</span>
      </div>
    );
  }

  return (
    <div className="terminal-chart-canvas">
      <ReactEChartsCore
        ref={chartRef}
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
        onEvents={onChartEvents}
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
  timeframeMin: number,
  labelOffsets: number[],
  formatBarTime: (iso: string, withSeconds?: boolean) => string,
  formatBarDay: (iso: string) => string,
  tzLabel: string,
): EChartsOption {
  // ECharts candlestick expects [open, close, low, high]
  const data = bars.map((b) => [b.open, b.close, b.low, b.high]);
  // Day-aware x-axis labels: a bar gets its DD (day-of-month, in the
  // user's TZ) when its day differs from the previous bar's. This
  // catches midnight crossings AND the Friday→Sunday weekend reopen
  // in one rule — both manifest as "the day-of-month changed". All
  // other bars get the usual HH:MM label. The first bar (i=0) has
  // no prior to compare against, so it always gets HH:MM — accepted
  // edge case (the date is implicit from the chart's anchor).
  //
  // Day strings precomputed once per bar; the rich-text formatter
  // below uses them to render day markers in a different style than
  // time markers so they stand visually distinct on the axis.
  const days = bars.map((b) => formatBarDay(b.time));
  const times = bars.map((b, i) => {
    if (i > 0 && days[i] !== days[i - 1]) return days[i];
    return formatBarTime(b.time);
  });
  const overlayLines = buildOverlayLines(snapshot, overlays, palette);
  const orBand = buildOpeningRangeBand(snapshot, overlays);
  const vwapSeries = buildAvwapSeries(bars, overlays.vwap, palette, timeframeMin);
  // RTH-session shading: subtle ink-100 wash over each contiguous
  // run of cash-session bars (Mon-Fri 09:30-16:00 ET). Reuses the
  // bucket-overlap predicate so the shading is consistent with the
  // RTH AVWAP gating at every timeframe (1m / 5m / 15m / 1h / 4h).
  const rthRanges = buildRthShadeRanges(bars, timeframeMin);

  return {
    backgroundColor: "transparent",
    animation: false,
    grid: {
      left: 8,
      // Right gutter sized for spec §4.2's "100px right gutter with
      // hairline leaders". 88px desktop carves room for the two-line
      // chip + axis tick labels (containLabel: true adds tick width
      // on top of `right`). On narrow mobile viewports (<=768px)
      // an 88px gutter eats ~30% of plot width, so we drop to 56px
      // and accept tighter chip/axis interaction.
      right: gutterRightPx(),
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
        // Day-changeover labels (bare 2-digit "27") get a heavier
        // ink-100 treatment via the `rich.day` style; time labels
        // (5-char "HH:MM") inherit the default ink-60 axisLabel
        // tone. The regex match is tight — anything that's exactly
        // 2 digits is a day marker, everything else (HH:MM, HH:MM:SS)
        // stays normal. Differentiates day markers from time markers
        // typographically so a lone "27" doesn't read as a price.
        formatter: (value: string) =>
          /^\d{2}$/.test(value) ? `{day|${value}}` : value,
        rich: {
          day: {
            color: palette.ink100,
            fontSize: 10,
            fontWeight: "bold",
            fontFamily: "var(--font-mono, monospace)",
          },
        },
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
          seriesName?: string;
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
          `<div style="opacity:0.6;font-size:10px;letter-spacing:0.08em">${formatBarTime(b.time, true)} ${tzLabel}</div>`,
          `O ${fmt(b.open)}  H ${fmt(b.high)}`,
          `L ${fmt(b.low)}  C ${fmt(b.close)}`,
          `<div style="opacity:0.55;font-size:10px;margin-top:2px">vol ${b.volume.toFixed(0)}</div>`,
        ];
        // Append any active VWAP-line values at this bar.
        const vwapHits = arr.filter(
          (p) =>
            p.seriesType === "line" &&
            typeof p.seriesName === "string" &&
            /^VWAP /.test(p.seriesName) &&
            typeof p.data === "number",
        );
        if (vwapHits.length > 0) {
          lines.push('<div style="margin-top:2px;opacity:0.85">');
          for (const h of vwapHits) {
            lines.push(`${h.seriesName} ${fmt(h.data as number)}`);
          }
          lines.push("</div>");
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
          // Per-line label rendered at the right end (in the gutter,
          // past the line's tip but before the price-axis tick
          // labels). The line itself extends across the plot width
          // and acts as the spec §4.2 "hairline leader" naturally.
          // Spec §4.2 lines 496-507: each gutter annotation is a
          // two-line chip — the 3-letter code on top, the price value
          // on the bottom. Annotations match the color of their
          // overlay. The chip carries a paper-deep fill + 1px ink-40
          // hairline border (spec §2.4 grammar) so labels read as
          // discrete annotations rather than data continuations.
          //
          // The markLine itself extends across the plot width and
          // butts against the chip — its terminal segment in the
          // gutter doubles as the spec's "hairline leader" matching
          // the line's dash pattern. (A separate leader-only segment
          // is a follow-up; the line-as-leader interpretation is
          // adequate for first-light.)
          label: {
            show: true,
            position: "end",
            distance: 0,
            fontSize: 10,
            fontFamily: "var(--font-mono, monospace)",
            lineHeight: 12,
            backgroundColor: palette.paperDeep,
            borderColor: palette.ink40,
            borderWidth: 1,
            padding: [2, 4],
            align: "left",
          },
          data: overlayLines.map((line, i) => {
            const dy = labelOffsets[i] ?? 0;
            return {
              yAxis: line.value,
              lineStyle: {
                color: line.color,
                type: line.style,
                width: line.width,
              },
              label: {
                formatter: `${line.label}\n${line.value.toFixed(2)}`,
                color: line.color,
                // Vertical pixel offset applied by the post-render
                // collision pass (see computeCollisionOffsets). 0 when
                // no nearby labels would overlap. Chips moved away
                // from their actual y rely on color match + dash
                // pattern + proximity for visual association.
                offset: dy !== 0 ? [0, dy] : undefined,
              },
            };
          }),
        },
        // Combined markArea: RTH-session shading (vertical strips)
        // + OR band (horizontal strip). Both inherit the default
        // styling from `itemStyle` but each data item can override.
        // Spec §4.2: OR band at 5% ink-100. RTH shading at 5% ink-100
        // is the same intensity but reads less prominent because it's
        // a wider swath; the visual demarcation between RTH and ETH
        // is the *boundary*, not the absolute brightness.
        markArea: {
          silent: true,
          itemStyle: {
            color: hexToRgba(palette.ink100, 0.05),
            borderWidth: 0,
          },
          // Default label config (used by the OR band corners). RTH
          // shade items override with `label.show: false`.
          label: {
            show: true,
            color: palette.ink60,
            fontSize: 10,
            fontFamily: "var(--font-mono, monospace)",
            lineHeight: 12,
            backgroundColor: palette.paperDeep,
            borderColor: palette.ink40,
            borderWidth: 1,
            padding: [2, 4],
            align: "left",
          },
          data: [
            // RTH session vertical strips. 3% ink-100 (vs the OR
            // band's 5%) — keeps the OR band's spec §4.2-reserved
            // 5% identity as the louder wash where they overlap.
            // `coord: [idx, "min/max"]` is used instead of the
            // simpler `xAxis: idx` because ECharts on a string-typed
            // category axis can interpret a numeric value as the
            // category VALUE not the index, and our `times` array
            // has duplicates (e.g. "09:30" appears every day). The
            // explicit coord form guarantees index-based lookup.
            ...rthRanges.map(([s, e]) => [
              {
                coord: [s, "min"],
                itemStyle: { color: hexToRgba(palette.ink100, 0.03) },
                label: { show: false },
              },
              { coord: [e, "max"] },
            ]),
            // OR band — horizontal band with corner labels
            ...(orBand
              ? [
                  [
                    {
                      yAxis: orBand.low,
                      label: {
                        position: "insideEndBottom",
                        formatter: `ORL\n${orBand.low.toFixed(2)}`,
                      },
                    },
                    {
                      yAxis: orBand.high,
                      label: {
                        position: "insideEndTop",
                        formatter: `ORH\n${orBand.high.toFixed(2)}`,
                      },
                    },
                  ],
                ]
              : []),
          ],
        },
      },
      // AVWAP series — up to 3 anchors × 5 series each (vwap line,
      // ±1σ band edges, ±2σ band edges). Always emit all 15 series so
      // their indices stay stable across renders; series with their
      // toggle off carry an empty data array.
      ...vwapSeries,
    ],
  };
}

// ── Static markLine overlays (non-VWAP) ─────────────────────────────

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
  // 3-letter code rendered at the right end of the line in the gutter
  // past the price axis. PH/PL/PC for prior-day HLC, POC/VAH/VAL for
  // the value-area triplet, ORH/ORL for the opening-range edges.
  label: string;
};

function buildOverlayLines(
  snapshot: TerminalSnapshot | null,
  overlays: OverlayState,
  palette: LumenPalette,
): OverlayLine[] {
  if (!snapshot) return [];
  const lines: OverlayLine[] = [];
  const lv = snapshot.levels;

  // VWAPs (Session + anchored backend AVWAPs) are rendered as
  // running line series, not static markLines — see buildAvwapSeries.

  // Spec §4.2: POC → ink-80, 1.5px solid; VAH/VAL → ink-60, 1px dashed.
  if (overlays.pocVa) {
    if (lv.poc != null) {
      lines.push({ value: lv.poc, color: palette.ink80, style: "solid", width: 1.5, label: "POC" });
    }
    if (lv.vah != null) {
      lines.push({ value: lv.vah, color: palette.ink60, style: "dashed", width: 1, label: "VAH" });
    }
    if (lv.val != null) {
      lines.push({ value: lv.val, color: palette.ink60, style: "dashed", width: 1, label: "VAL" });
    }
  }

  // Spec §4.2: Prior-day HLC → ink-60, 1px DOTTED (all three).
  // PDH/PDC/PDL keeps a uniform 3-letter cadence with POC/VAH/VAL so
  // labels stack with consistent chip width.
  if (overlays.priorHlc) {
    if (lv.pd_high != null) {
      lines.push({ value: lv.pd_high, color: palette.ink60, style: "dotted", width: 1, label: "PDH" });
    }
    if (lv.pd_close != null) {
      lines.push({ value: lv.pd_close, color: palette.ink60, style: "dotted", width: 1, label: "PDC" });
    }
    if (lv.pd_low != null) {
      lines.push({ value: lv.pd_low, color: palette.ink60, style: "dotted", width: 1, label: "PDL" });
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

// ── Label collision pass ────────────────────────────────────────────

// Approximate chip height in pixels: 2 lines × 12px lineHeight + 2×2
// padding + 2×1 border + 2px breathing. Used as the cluster-merge
// threshold (any two chips within this pixel distance overlap).
//
// Keep in sync with the markLine.label config in `buildEChartsOption`
// — if the chip's lineHeight, padding, borderWidth, or fontSize
// changes there, this constant must be recomputed. A future
// follow-up should compute it from text metrics rather than hand-tune.
const LABEL_CHIP_PIXEL_HEIGHT = 32;

interface EChartsInstanceLike {
  convertToPixel(
    finder: { yAxisIndex: number } | { xAxisIndex: number } | string,
    value: number | string,
  ): number | number[];
}

/**
 * Project each overlay line's data y onto the chart's pixel-y axis,
 * cluster overlapping chips, then distribute each cluster's labels
 * symmetrically around the cluster's mean. Returns an array indexed
 * parallel to `lines` — entry i is the pixel offset to apply to
 * line i's chip via ECharts `label.offset: [0, dy]`.
 *
 * Pixel-aware (not data-aware) so the result tracks user pan/zoom:
 * when the y-axis auto-scales to a tighter range, levels that were
 * "close enough to collide" at 12h zoom may no longer collide at
 * tight 1h zoom (and vice versa).
 *
 * Algorithm: iterative cluster-merge with centered-block placement.
 * Treat each chip as occupying [meanY - n/2·H, meanY + n/2·H] where
 * H is the chip height and n is the cluster size. Adjacent clusters
 * whose blocks overlap are merged (cluster mean recomputed as the
 * average of all member original-y values). Repeat until stable.
 * Within a cluster of size n, the k-th member is placed at
 * meanY + (k − (n−1)/2) · H — preserving top-to-bottom screen order.
 *
 * This approach minimizes total displacement subject to no-overlap:
 * a long chain of near-collisions is recognized as one centered
 * block, rather than letting greedy single-pass clustering snowball
 * a 6-item chain into a 192px stack anchored at the topmost item.
 */
function computeCollisionOffsets(
  lines: OverlayLine[],
  inst: EChartsInstanceLike,
): number[] {
  const offsets = new Array(lines.length).fill(0);
  if (lines.length < 2) return offsets;

  type Item = { i: number; pixelY: number };
  type Cluster = { members: Item[]; meanY: number };

  const items: Item[] = [];
  for (let i = 0; i < lines.length; i++) {
    let px: number;
    try {
      const result = inst.convertToPixel({ yAxisIndex: 0 }, lines[i].value);
      px = typeof result === "number" ? result : NaN;
    } catch {
      px = NaN;
    }
    if (Number.isFinite(px)) items.push({ i, pixelY: px });
  }
  if (items.length < 2) return offsets;
  items.sort((a, b) => a.pixelY - b.pixelY);

  let clusters: Cluster[] = items.map((it) => ({ members: [it], meanY: it.pixelY }));

  // Iteratively merge any pair of adjacent clusters whose centered
  // blocks overlap. Bounded by the number of items (each iteration
  // strictly reduces the cluster count, or terminates).
  let changed = true;
  while (changed) {
    changed = false;
    const next: Cluster[] = [];
    for (const c of clusters) {
      if (next.length === 0) {
        next.push(c);
        continue;
      }
      const prev = next[next.length - 1];
      const prevMaxY = prev.meanY + (prev.members.length / 2) * LABEL_CHIP_PIXEL_HEIGHT;
      const curMinY = c.meanY - (c.members.length / 2) * LABEL_CHIP_PIXEL_HEIGHT;
      if (curMinY < prevMaxY) {
        const all = [...prev.members, ...c.members];
        const sumY = all.reduce((s, m) => s + m.pixelY, 0);
        next[next.length - 1] = { members: all, meanY: sumY / all.length };
        changed = true;
      } else {
        next.push(c);
      }
    }
    clusters = next;
  }

  for (const c of clusters) {
    const n = c.members.length;
    c.members.forEach((m, k) => {
      const placed = c.meanY + (k - (n - 1) / 2) * LABEL_CHIP_PIXEL_HEIGHT;
      offsets[m.i] = placed - m.pixelY;
    });
  }
  return offsets;
}

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ── Responsive gutter ──────────────────────────────────────────────

/**
 * Right-gutter pixel size for the chart's plot area. 88px on desktop
 * to fit two-line level labels per spec §4.2; 56px on narrow mobile
 * viewports where 88px would eat ~30% of the plot width. Read at
 * option-build time (re-runs on each 30s poll, so a viewport resize
 * gets picked up within one poll cycle).
 */
function gutterRightPx(): number {
  if (typeof window === "undefined") return 88;
  return window.matchMedia("(max-width: 768px)").matches ? 56 : 88;
}

// ── Default zoom — keeps visible window ~12h regardless of buffer ───

/**
 * Compute the dataZoom `start` percentage so the visible window on
 * first paint is ~12h, regardless of how much history the backend
 * returned. Without this, a 168h buffer at the prior `start: 75`
 * default would render ~42h of bars in the visible band — sub-pixel
 * candle widths at typical viewport sizes. The user can still
 * pan/zoom back through the full buffer.
 */
function computeDefaultZoomStart(bars: TerminalIntradayBar[]): number {
  const VISIBLE_MS = 12 * 60 * 60 * 1000;
  if (bars.length < 2) return 0;
  const first = Date.parse(bars[0].time);
  const last = Date.parse(bars[bars.length - 1].time);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) {
    return 0;
  }
  const spanMs = last - first;
  if (spanMs <= VISIBLE_MS) return 0;
  return Math.max(0, Math.min(99, 100 - (VISIBLE_MS / spanMs) * 100));
}

// ── AVWAP — multi-anchor cumulative VWAP + ±σ bands ─────────────────

/**
 * Compute cumulative VWAP and stddev bands from `anchorIdx` onward.
 * Ports the volume-weighted variant of TradingView's anchored-VWAP +
 * VWSD bands (matches the user's verified TV reference):
 *   typical = (high + low + close) / 3
 *   VWAP[i]   = cumsum(typ × vol) / cumsum(vol)
 *   stddev[i] = sqrt(max(0, cumsum(typ² × vol)/cumsum(vol) − VWAP²))
 *
 * `inScope` (optional) gates which post-anchor bars contribute to the
 * cumulants AND emit a value. RTH passes a "Mon-Fri 09:30-16:00 ET"
 * predicate so the line only renders during cash-session bars and
 * doesn't drift during ETH (where neither RTH volume nor RTH typical
 * prices belong in the running VWAP). Out-of-scope bars stay null —
 * `connectNulls: false` on the line series turns this into a clean
 * gap during ETH that re-anchors at next RTH open.
 *
 * Returns an array aligned 1:1 with `bars`. Pre-anchor and
 * out-of-scope entries are `null`.
 */
function vwapWithBandsSeries(
  bars: TerminalIntradayBar[],
  anchorIdx: number,
  inScope?: (bar: TerminalIntradayBar) => boolean,
): ({ vwap: number; stddev: number } | null)[] {
  const out: ({ vwap: number; stddev: number } | null)[] = new Array(bars.length).fill(null);
  if (anchorIdx < 0 || anchorIdx >= bars.length) return out;
  let cumTpVol = 0;
  let cumVol = 0;
  let cumTpSqVol = 0;
  for (let i = anchorIdx; i < bars.length; i++) {
    const b = bars[i];
    if (inScope && !inScope(b)) continue;
    const typ = (b.high + b.low + b.close) / 3;
    const vol = b.volume > 0 ? b.volume : 1;
    cumTpVol += typ * vol;
    cumVol += vol;
    cumTpSqVol += typ * typ * vol;
    if (cumVol > 0) {
      const vwap = cumTpVol / cumVol;
      const variance = Math.max(0, cumTpSqVol / cumVol - vwap * vwap);
      out[i] = { vwap, stddev: Math.sqrt(variance) };
    }
  }
  return out;
}

// ET clock helpers — used to detect the most-recent Daily-Globex
// (18:00 ET) and RTH (09:30 ET, weekdays-only) anchor moments.
const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  weekday: "short",
});

function etPart(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/**
 * Walk back minute-by-minute from `latestMs` until ET clock matches
 * the target hh:mm (and optionally a weekday filter). Caps at 14 days
 * lookback (≥1 trading week of safety, holiday-tolerant) — returns
 * null if no match. `allowedWeekdays` is the set of 3-letter ET names
 * that are valid; pass `null` to allow any.
 */
function findRecentEtMomentMs(
  latestMs: number,
  targetHour: number,
  targetMin: number,
  allowedWeekdays: ReadonlySet<string> | null,
): number | null {
  const MAX_MIN = 14 * 24 * 60;
  for (let offset = 0; offset < MAX_MIN; offset++) {
    const ms = latestMs - offset * 60_000;
    const parts = ET_FMT.formatToParts(new Date(ms));
    const hh = parseInt(etPart(parts, "hour"), 10);
    const mm = parseInt(etPart(parts, "minute"), 10);
    if (hh !== targetHour || mm !== targetMin) continue;
    if (allowedWeekdays) {
      const wk = etPart(parts, "weekday");
      if (!allowedWeekdays.has(wk)) continue;
    }
    return ms;
  }
  return null;
}

// Globex is closed Fri 17:00 ET → Sun 18:00 ET. Without filtering, the
// daily anchor's "most recent 18:00 ET" can land on Sat or Fri evening
// (closed-market times); `indexForAnchorMs` then resolves to the bar
// just before the Friday-evening halt — i.e. Friday-close — which is
// stale by ~50 hours over the weekend. Restricting to Sun-Thu (the
// days that actually start a Globex daily session) keeps the anchor
// honest. Mon's daily anchor is Sun 18:00, …, Fri's daily anchor is
// Thu 18:00, weekend's is Thu 18:00.
const GLOBEX_DAILY_OPEN_DAYS: ReadonlySet<string> = new Set(["Sun", "Mon", "Tue", "Wed", "Thu"]);
const RTH_DAYS: ReadonlySet<string> = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

/**
 * Whether a bar's bucket [bar.time, bar.time + timeframeMin) overlaps
 * the RTH cash-session window (09:30 ≤ ET clock < 16:00 on Mon-Fri).
 *
 * Sub-hour timeframes (1m / 5m / 15m): buckets nest cleanly inside or
 * outside RTH, so the predicate's start- and end-of-bucket checks
 * agree. At hour-aligned timeframes (1h / 4h), buckets straddle the
 * 09:30 boundary — e.g. a 1h bucket at 09:00 ET covers 09:00-10:00 ET
 * (30 min ETH + 30 min RTH). Returning `true` when the bucket
 * overlaps RTH includes the straddling bucket so the AVWAP line
 * begins at the bucket containing 09:30. The tradeoff: that first
 * bucket's aggregated OHLCV silently includes the pre-09:30 portion,
 * mildly contaminating cumulants. This caveat already applies to the
 * `aggregateBars` UTC-bucket alignment and is acceptable for the
 * "structure read" use of coarse timeframes; precise RTH cumulants
 * require the 1m / 5m timeframe.
 *
 * Holiday early closes (1pm ET) are not encoded — those bars 13:00 ET
 * onward will still cumulate. Acceptable for now.
 */
function isRthBar(bar: TerminalIntradayBar, timeframeMin: number): boolean {
  const startMs = Date.parse(bar.time);
  if (!Number.isFinite(startMs)) return false;
  // The bucket's last-instant timestamp (1ms before the next bucket
  // start) — formatToParts on this gives the right ET clock for the
  // close edge, even when the bucket spans a DST transition.
  const lastMs = startMs + timeframeMin * 60_000 - 1;

  const inRth = (ms: number): boolean => {
    const parts = ET_FMT.formatToParts(new Date(ms));
    if (!RTH_DAYS.has(etPart(parts, "weekday"))) return false;
    const hh = parseInt(etPart(parts, "hour"), 10);
    const mm = parseInt(etPart(parts, "minute"), 10);
    const minutes = hh * 60 + mm;
    return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  };

  return inRth(startMs) || inRth(lastMs);
}

/**
 * Walk the bar buffer and collect [startIdx, endIdx] pairs for each
 * contiguous run of cash-session (RTH) bars. Used by `buildEChartsOption`
 * to render a subtle ink-100 wash over the RTH portions of the chart so
 * the operator can see the RTH ↔ ETH transitions at a glance.
 *
 * Reuses `isRthBar`'s bucket-overlap predicate so the shading lines up
 * with the RTH AVWAP gating at every timeframe.
 */
function buildRthShadeRanges(
  bars: TerminalIntradayBar[],
  timeframeMin: number,
): [number, number][] {
  const ranges: [number, number][] = [];
  let runStart = -1;
  for (let i = 0; i < bars.length; i++) {
    const inRth = isRthBar(bars[i], timeframeMin);
    if (inRth && runStart === -1) runStart = i;
    else if (!inRth && runStart !== -1) {
      ranges.push([runStart, i - 1]);
      runStart = -1;
    }
  }
  if (runStart !== -1) ranges.push([runStart, bars.length - 1]);
  return ranges;
}

/**
 * Map an anchor-moment (UTC ms) to the largest aggregated-bar index
 * whose timestamp is ≤ anchorMs. The bucket spanning the anchor
 * moment is the correct starting point for cumulating from that
 * moment onward.
 */
function indexForAnchorMs(bars: TerminalIntradayBar[], anchorMs: number): number {
  let idx = -1;
  for (let i = 0; i < bars.length; i++) {
    const t = Date.parse(bars[i].time);
    if (Number.isFinite(t) && t <= anchorMs) idx = i;
    else break;
  }
  return idx;
}

/**
 * Week anchor: most-recent ≥36h gap between consecutive bars (= the
 * weekend halt: Friday 17:00 ET → Sunday 18:00 ET). Falls back to the
 * first bar in the buffer if no such gap exists yet.
 */
function findWeekAnchorIdx(bars: TerminalIntradayBar[]): number {
  if (bars.length === 0) return -1;
  const ANCHOR_GAP_MS = 36 * 60 * 60 * 1000;
  for (let i = bars.length - 1; i > 0; i--) {
    const t = Date.parse(bars[i].time);
    const tPrev = Date.parse(bars[i - 1].time);
    if (Number.isFinite(t) && Number.isFinite(tPrev) && t - tPrev >= ANCHOR_GAP_MS) {
      return i;
    }
  }
  return 0;
}

function findDailyGlobexAnchorIdx(bars: TerminalIntradayBar[]): number {
  if (bars.length === 0) return -1;
  const latestMs = Date.parse(bars[bars.length - 1].time);
  if (!Number.isFinite(latestMs)) return -1;
  const ms = findRecentEtMomentMs(latestMs, 18, 0, GLOBEX_DAILY_OPEN_DAYS);
  if (ms == null) return -1;
  return indexForAnchorMs(bars, ms);
}

function findRthAnchorIdx(bars: TerminalIntradayBar[]): number {
  if (bars.length === 0) return -1;
  const latestMs = Date.parse(bars[bars.length - 1].time);
  if (!Number.isFinite(latestMs)) return -1;
  const ms = findRecentEtMomentMs(latestMs, 9, 30, RTH_DAYS);
  if (ms == null) return -1;
  return indexForAnchorMs(bars, ms);
}

// Per-anchor visual treatment. Spec §4.2 reserves ink-100 for the
// flagship line (Week is the long-running structural reference);
// supporting anchors step down to ink-80 (Daily) and ink-60 (RTH).
// Bands match each anchor's tone but at thinner weight.
const VWAP_STYLES: Record<
  VwapAnchorKey,
  { label: string; color: keyof LumenPalette; lineWidth: number; bandWidth: number; dashBand: boolean }
> = {
  week: { label: "Week", color: "ink100", lineWidth: 1.5, bandWidth: 1, dashBand: false },
  daily: { label: "Daily", color: "ink80", lineWidth: 1.25, bandWidth: 1, dashBand: true },
  rth: { label: "RTH", color: "ink60", lineWidth: 1.25, bandWidth: 0.75, dashBand: true },
};

function findAnchorIdx(key: VwapAnchorKey, bars: TerminalIntradayBar[]): number {
  switch (key) {
    case "week":
      return findWeekAnchorIdx(bars);
    case "daily":
      return findDailyGlobexAnchorIdx(bars);
    case "rth":
      return findRthAnchorIdx(bars);
  }
}

// Per-anchor in-scope predicate. RTH only counts bars during the
// cash session (Mon-Fri 09:30-16:00 ET) — without this, the running
// VWAP would drift across ETH bars even though "RTH VWAP" should
// freeze (or vanish) outside cash hours. Week and Daily Globex run
// continuously through their respective sessions, so no predicate.
// Predicate takes the bar's timeframe in minutes so it can correctly
// classify hour-aligned buckets that straddle the 09:30 boundary.
const VWAP_IN_SCOPE: Partial<
  Record<VwapAnchorKey, (bar: TerminalIntradayBar, timeframeMin: number) => boolean>
> = {
  rth: isRthBar,
};

type EChartsLineSeries = {
  type: "line";
  name: string;
  data: (number | null)[];
  showSymbol: boolean;
  sampling?: string;
  smooth: boolean;
  connectNulls: boolean;
  lineStyle: { color: string; width: number; type?: "solid" | "dashed" | "dotted" };
  z: number;
  silent: boolean;
};

/**
 * Build all AVWAP line series — exactly 15 entries (3 anchors × 5
 * series: vwap, +1σ, -1σ, +2σ, -2σ), preserving stable indices across
 * renders so ECharts' notMerge: false can swap data cleanly. Disabled
 * series carry an empty `data` array.
 */
function buildAvwapSeries(
  bars: TerminalIntradayBar[],
  vwapState: VwapOverlayState,
  palette: LumenPalette,
  timeframeMin: number,
): EChartsLineSeries[] {
  const out: EChartsLineSeries[] = [];
  for (const { key } of VWAP_ANCHORS) {
    const style = VWAP_STYLES[key];
    const state = vwapState[key];
    const anyOn = state.vwap || state.band1 || state.band2;
    const color = palette[style.color];

    let series: ({ vwap: number; stddev: number } | null)[] | null = null;
    if (anyOn) {
      const idx = findAnchorIdx(key, bars);
      if (idx >= 0) {
        const inScopeFactory = VWAP_IN_SCOPE[key];
        const inScope = inScopeFactory ? (b: TerminalIntradayBar) => inScopeFactory(b, timeframeMin) : undefined;
        series = vwapWithBandsSeries(bars, idx, inScope);
      }
    }

    const vwapData = state.vwap && series ? series.map((s) => (s ? s.vwap : null)) : [];
    const upper1Data =
      state.band1 && series ? series.map((s) => (s ? s.vwap + s.stddev : null)) : [];
    const lower1Data =
      state.band1 && series ? series.map((s) => (s ? s.vwap - s.stddev : null)) : [];
    const upper2Data =
      state.band2 && series ? series.map((s) => (s ? s.vwap + 2 * s.stddev : null)) : [];
    const lower2Data =
      state.band2 && series ? series.map((s) => (s ? s.vwap - 2 * s.stddev : null)) : [];

    const baseStyle = { color, width: style.lineWidth };
    const bandStyle = {
      color,
      width: style.bandWidth,
      type: style.dashBand ? ("dashed" as const) : ("solid" as const),
    };

    out.push(
      {
        type: "line",
        name: `VWAP ${style.label}`,
        data: vwapData,
        showSymbol: false,
        // LTTB downsampling drops representative points to thin dense
        // lines, but with sparse-null patterns (RTH gaps in ETH, etc.)
        // it can drop the bar adjacent to a transition and visually
        // merge two stripes into one sloped segment. Skip sampling so
        // null gaps render as honest discontinuities.
        smooth: false,
        connectNulls: false,
        lineStyle: baseStyle,
        z: 5,
        silent: true,
      },
      {
        type: "line",
        name: `VWAP ${style.label} +1σ`,
        data: upper1Data,
        showSymbol: false,
        smooth: false,
        connectNulls: false,
        lineStyle: bandStyle,
        z: 4,
        silent: true,
      },
      {
        type: "line",
        name: `VWAP ${style.label} −1σ`,
        data: lower1Data,
        showSymbol: false,
        smooth: false,
        connectNulls: false,
        lineStyle: bandStyle,
        z: 4,
        silent: true,
      },
      {
        type: "line",
        name: `VWAP ${style.label} +2σ`,
        data: upper2Data,
        showSymbol: false,
        smooth: false,
        connectNulls: false,
        lineStyle: bandStyle,
        z: 3,
        silent: true,
      },
      {
        type: "line",
        name: `VWAP ${style.label} −2σ`,
        data: lower2Data,
        showSymbol: false,
        smooth: false,
        connectNulls: false,
        lineStyle: bandStyle,
        z: 3,
        silent: true,
      },
    );
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

// (Bar-time formatting moved to `useTimezone.formatChartTime` and
// threaded through `TerminalChartCanvas` props so the user's
// timezone selection — ET / CT / MT / PT / Local — flows into both
// the x-axis labels and the tooltip.)
