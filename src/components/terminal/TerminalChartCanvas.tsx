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
import { CandlestickChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkLineComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { fetchTerminalIntradayBars, type TerminalIntradayBar } from "../../api/terminalClient";
import type { TerminalSnapshot } from "../../api/terminalTypes";

echarts.use([
  CandlestickChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkLineComponent,
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
      initialMountRef.current = false;
    }
    return opt;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, snapshot, overlays, palette]);

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
          data: number[];
        }>;
        const item = arr.find((p) => p.seriesType === "candlestick");
        if (!item) return "";
        const i = item.dataIndex;
        const b = bars[i];
        if (!b) return "";
        const fmt = (n: number) => n.toFixed(2);
        return [
          `<div style="opacity:0.6;font-size:10px;letter-spacing:0.08em">${formatBarTime(b.time, true)}</div>`,
          `O ${fmt(b.open)}  H ${fmt(b.high)}`,
          `L ${fmt(b.low)}  C ${fmt(b.close)}`,
          `<div style="opacity:0.55;font-size:10px;margin-top:2px">vol ${b.volume.toFixed(0)}</div>`,
        ].join("<br/>");
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
          label: {
            show: true,
            position: "end",
            color: palette.ink60,
            fontSize: 9,
            fontFamily: "var(--font-mono, monospace)",
            distance: 4,
            formatter: "{b}",
          },
          // ECharts merges arrays as a unit, so passing the full list
          // each time is safe — toggling overlays off removes their
          // line from the data array.
          data: overlayLines.map((line) => ({
            name: line.label,
            yAxis: line.value,
            lineStyle: {
              color: line.color,
              type: line.style,
              width: 1,
            },
          })),
        },
      },
    ],
  };
}

// ── Overlay builder — derives lines from snapshot + toggle state ────

type OverlayLine = {
  label: string;
  value: number;
  color: string;
  style: "solid" | "dashed";
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

  // Session VWAP — solid cream, the canonical anchor of the day.
  if (overlays.sessionVwap && v.session_vwap != null) {
    lines.push({
      label: "VWAP",
      value: v.session_vwap,
      color: palette.posCream,
      style: "solid",
    });
  }

  // Anchored VWAPs (Day High, Day Low) — dashed cream, secondary.
  if (overlays.avwaps) {
    for (const a of v.anchored) {
      if (a.value != null) {
        lines.push({
          label: a.name === "Day High" ? "AVWAP H" : a.name === "Day Low" ? "AVWAP L" : a.name,
          value: a.value,
          color: palette.posCream,
          style: "dashed",
        });
      }
    }
  }

  // POC / VAH / VAL — the value-area triple. POC solid (the prominent
  // mode), VAH/VAL dashed (the boundary).
  if (overlays.pocVa) {
    if (lv.poc != null) {
      lines.push({ label: "POC", value: lv.poc, color: palette.ink80, style: "solid" });
    }
    if (lv.vah != null) {
      lines.push({ label: "VAH", value: lv.vah, color: palette.ink60, style: "dashed" });
    }
    if (lv.val != null) {
      lines.push({ label: "VAL", value: lv.val, color: palette.ink60, style: "dashed" });
    }
  }

  // Prior Day H/L/C — reference levels from yesterday's session. Close
  // is the most-watched of the three, so it gets the slightly heavier
  // ink-80 vs the high/low's ink-60.
  if (overlays.priorHlc) {
    if (lv.pd_high != null) {
      lines.push({ label: "PrH", value: lv.pd_high, color: palette.ink60, style: "dashed" });
    }
    if (lv.pd_close != null) {
      lines.push({ label: "PrC", value: lv.pd_close, color: palette.ink80, style: "solid" });
    }
    if (lv.pd_low != null) {
      lines.push({ label: "PrL", value: lv.pd_low, color: palette.ink60, style: "dashed" });
    }
  }

  // Opening range — first-5min H/L. Dashed, slightly more prominent
  // than prior-day-HL since OR is "today" not "yesterday."
  if (overlays.openingRange) {
    if (lv.or_high != null) {
      lines.push({ label: "ORH", value: lv.or_high, color: palette.ink80, style: "dashed" });
    }
    if (lv.or_low != null) {
      lines.push({ label: "ORL", value: lv.or_low, color: palette.ink80, style: "dashed" });
    }
  }

  return lines;
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
