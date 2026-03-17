/**
 * CalendarHeatmap — month grid where each day is colored by P&L.
 * Fills in as trading days complete. Empty cells for weekends/no data.
 */

import { useMemo, useState } from "react";
import type { DailySummary } from "../../api/types";

interface Props {
  summaries: DailySummary[];
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getPnlColor(pnl: number): string {
  if (pnl > 20) return "#059669";      // strong green
  if (pnl > 10) return "#10b981";
  if (pnl > 0) return "#34d399";       // light green
  if (pnl === 0) return "#475569";     // gray
  if (pnl > -10) return "#f87171";     // light red
  if (pnl > -20) return "#ef4444";
  return "#dc2626";                     // strong red
}

export function CalendarHeatmap({ summaries }: Props) {
  const now = new Date();
  const [monthOffset, setMonthOffset] = useState(0);

  const viewDate = useMemo(() => {
    const d = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    return d;
  }, [monthOffset]);

  // Build lookup: date string -> summary
  const lookup = useMemo(() => {
    const map: Record<string, DailySummary> = {};
    for (const s of summaries) {
      map[s.date] = s;
    }
    return map;
  }, [summaries]);

  // Build calendar grid for the view month
  const grid = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: { date: string; day: number; pnl: number | null; summary: DailySummary | null; isWeekend: boolean; isFuture: boolean }[] = [];

    // Padding for first week
    for (let i = 0; i < firstDay; i++) {
      cells.push({ date: "", day: 0, pnl: null, summary: null, isWeekend: false, isFuture: false });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      const dayOfWeek = dateObj.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isFuture = dateObj > now;
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const summary = lookup[dateStr] ?? null;

      cells.push({
        date: dateStr,
        day: d,
        pnl: summary?.total_pnl_pts ?? null,
        summary,
        isWeekend,
        isFuture,
      });
    }

    return cells;
  }, [viewDate, lookup]);

  // Month stats
  const monthSummaries = summaries.filter((s) => s.date.startsWith(`${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, "0")}`));
  const monthPnl = monthSummaries.reduce((s, d) => s + d.total_pnl_pts, 0);
  const greenDays = monthSummaries.filter((d) => d.total_pnl_pts > 0).length;
  const redDays = monthSummaries.filter((d) => d.total_pnl_pts < 0).length;

  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const hoveredSummary = hoveredDate ? lookup[hoveredDate] : null;

  const cellSize = 32;
  const gap = 3;

  return (
    <div style={{ padding: "4px 8px" }}>
      {/* Month navigation */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <button
          onClick={() => setMonthOffset((p) => p - 1)}
          style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, padding: "2px 8px" }}
        >
          &lt;
        </button>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", fontFamily: "Inter, sans-serif" }}>
          {MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
        </span>
        <button
          onClick={() => setMonthOffset((p) => Math.min(p + 1, 0))}
          disabled={monthOffset >= 0}
          style={{ background: "none", border: "none", color: monthOffset >= 0 ? "#334155" : "#94a3b8", cursor: monthOffset >= 0 ? "default" : "pointer", fontSize: 14, padding: "2px 8px" }}
        >
          &gt;
        </button>
      </div>

      {/* Day-of-week headers */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${cellSize}px)`, gap, justifyContent: "center", marginBottom: 2 }}>
        {DAY_LABELS.map((d) => (
          <div key={d} style={{ fontSize: 8, color: "#64748b", textAlign: "center" }}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${cellSize}px)`, gap, justifyContent: "center" }}>
        {grid.map((cell, i) => {
          if (!cell.date) {
            return <div key={`pad-${i}`} style={{ width: cellSize, height: cellSize }} />;
          }

          const isToday = cell.date === now.toISOString().slice(0, 10);
          const hasData = cell.pnl !== null;
          const bg = hasData
            ? getPnlColor(cell.pnl!)
            : cell.isWeekend
              ? "#0f172a"
              : cell.isFuture
                ? "#0f172a"
                : "#1e293b";

          return (
            <div
              key={cell.date}
              onMouseEnter={() => setHoveredDate(cell.date)}
              onMouseLeave={() => setHoveredDate(null)}
              style={{
                width: cellSize,
                height: cellSize,
                borderRadius: 4,
                background: bg,
                opacity: hasData ? 0.9 : 0.4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontFamily: "JetBrains Mono, monospace",
                color: hasData ? "#fff" : "#475569",
                fontWeight: isToday ? 700 : 400,
                border: isToday ? "1.5px solid #e2e8f0" : "1px solid transparent",
                cursor: hasData ? "pointer" : "default",
                transition: "transform 0.1s",
                transform: hoveredDate === cell.date ? "scale(1.15)" : "scale(1)",
              }}
            >
              {cell.day}
            </div>
          );
        })}
      </div>

      {/* Tooltip for hovered day */}
      {hoveredSummary && (
        <div style={{
          marginTop: 6,
          padding: "6px 10px",
          background: "#0f172a",
          borderRadius: 4,
          border: "1px solid #1e293b",
          fontSize: 10,
          fontFamily: "JetBrains Mono, monospace",
          color: "#94a3b8",
        }}>
          <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{hoveredDate}</span>
          {" | "}
          <span style={{ color: hoveredSummary.total_pnl_pts >= 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>
            {hoveredSummary.total_pnl_pts >= 0 ? "+" : ""}{hoveredSummary.total_pnl_pts.toFixed(1)} pts
          </span>
          {" | "}
          {hoveredSummary.n_wins}W/{hoveredSummary.n_losses}L
          {hoveredSummary.win_rate != null && ` | WR ${(hoveredSummary.win_rate * 100).toFixed(0)}%`}
        </div>
      )}

      {/* Month summary */}
      {monthSummaries.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 10, color: "#94a3b8", textAlign: "center", fontFamily: "JetBrains Mono, monospace" }}>
          <span style={{ color: monthPnl >= 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>
            {monthPnl >= 0 ? "+" : ""}{monthPnl.toFixed(1)} pts
          </span>
          {" | "}{monthSummaries.length} days ({greenDays} green / {redDays} red)
        </div>
      )}
    </div>
  );
}
