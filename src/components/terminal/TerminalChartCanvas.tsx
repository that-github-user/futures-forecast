/**
 * TerminalChartCanvas — replaces the placeholder div in the middle band.
 *
 * Polls /terminal/v1/bars/es-intraday every 30s and renders a candlestick
 * chart of the last ~48h of ES 1-min bars (RTH + ETH/Globex). No overlay
 * lines yet — VWAP / AVWAPs / POC-VAH-VAL / Prior HLC / OR overlays land
 * with the toggle interactivity in PR η. Toggle pills above this canvas
 * stay visually present but non-interactive until then (per spec §4.2).
 */

import { useEffect, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { CandlestickChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { fetchTerminalIntradayBars, type TerminalIntradayBar } from "../../api/terminalClient";

echarts.use([
  CandlestickChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

const POLL_INTERVAL_MS = 30_000;

export function TerminalChartCanvas() {
  const [bars, setBars] = useState<TerminalIntradayBar[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const option = useMemo(() => buildEChartsOption(bars), [bars]);

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
        option={option}
        style={{ width: "100%", height: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge={true}
        lazyUpdate={true}
      />
    </div>
  );
}

// ── ECharts option builder ──────────────────────────────────────────

function buildEChartsOption(bars: TerminalIntradayBar[] | null) {
  if (!bars || bars.length === 0) return {};

  // ECharts candlestick expects [open, close, low, high]
  const data = bars.map((b) => [b.open, b.close, b.low, b.high]);
  const times = bars.map((b) => formatBarTime(b.time));

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
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.18)" } },
      axisLabel: {
        color: "rgba(255,255,255,0.55)",
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
        color: "rgba(255,255,255,0.55)",
        fontSize: 10,
        fontFamily: "var(--font-mono, monospace)",
      },
      axisTick: { show: false },
      splitLine: {
        lineStyle: { color: "rgba(255,255,255,0.06)" },
      },
    },
    dataZoom: [
      {
        type: "inside",
        // Default view: last ~25% of the buffer (~12h of bars at 1-min × 48h)
        // so the user lands on the most-recent action and can scroll back.
        start: 75,
        end: 100,
      },
    ],
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", lineStyle: { color: "rgba(255,255,255,0.3)" } },
      backgroundColor: "rgba(8,7,10,0.94)",
      borderColor: "rgba(255,255,255,0.18)",
      textStyle: {
        color: "#f5efe2",
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
          // LUMEN palette: cream for up-bars, persimmon for down-bars.
          // Hollow body for up, filled for down — the FT convention.
          color: "rgba(0,0,0,0)",
          color0: "#c45a3a",
          borderColor: "#e8d8b0",
          borderColor0: "#c45a3a",
          borderWidth: 1,
        },
      },
    ],
  };
}

function formatBarTime(iso: string, withSeconds: boolean = false): string {
  // Input: "2026-04-26T22:01:00Z" → display "22:01" (or "Sun 22:01" on
  // a day boundary). Toggle with seconds for tooltip detail.
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  const time = `${hh}:${mm}${withSeconds ? `:${d.getUTCSeconds().toString().padStart(2, "0")}` : ""}`;
  return time;
}
