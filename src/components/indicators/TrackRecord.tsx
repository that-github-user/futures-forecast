/**
 * TrackRecord — performance view with time-range toggle.
 *
 * Today: Session scorecard + trade log + performance context
 * Month: Calendar heatmap + monthly stats
 */

import { useMemo, useState } from "react";
import type { DailySummary, HistoryEntry, RollingAccuracy, SessionStats } from "../../api/types";
import { CalendarHeatmap } from "../charts/CalendarHeatmap";
import { colors, fonts, withAlpha } from "../../styles/tokens";

type TimeRange = "today" | "month";

interface Props {
  history: HistoryEntry[];
  liveStats: { pf: number | null; winRate: number | null; numTrades: number | null };
  sessionStats: SessionStats | null;
  rollingAccuracy: RollingAccuracy | null;
  dailySummaries: DailySummary[];
}

interface Trade {
  time: string;
  direction: string;
  entryPrice: number;
  pnlPts: number;
  regime: string | null;
}

export function TrackRecord({ history, liveStats, sessionStats, rollingAccuracy, dailySummaries }: Props) {
  const [timeRange, setTimeRange] = useState<TimeRange>("today");
  // Compute trades from history (client-side fallback when session_stats not yet available)
  const trades = useMemo(() => {
    const result: Trade[] = [];
    for (const e of history) {
      if (e.realized_return == null) continue;
      if (e.signal.direction === "FLAT") continue;

      const dirSign = e.signal.direction === "LONG" ? 1 : -1;
      const pnlPts = Math.round(dirSign * e.realized_return * e.last_close * 100) / 100;

      const d = new Date(e.timestamp);
      const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

      result.push({
        time,
        direction: e.signal.direction,
        entryPrice: e.last_close,
        pnlPts,
        regime: e.regime ?? null,
      });
    }
    return result;
  }, [history]);

  // Client-side session stats fallback
  const stats = useMemo(() => {
    if (sessionStats) return sessionStats;
    // Compute from trades
    if (!trades.length) return null;
    const wins = trades.filter((t) => t.pnlPts > 0);
    const losses = trades.filter((t) => t.pnlPts < 0);
    const totalPnl = trades.reduce((s, t) => s + t.pnlPts, 0);
    let streak = 0;
    let streakType: "W" | "L" | "none" = "none";
    for (let i = trades.length - 1; i >= 0; i--) {
      if (i === trades.length - 1) {
        streakType = trades[i].pnlPts > 0 ? "W" : trades[i].pnlPts < 0 ? "L" : "none";
        streak = streakType !== "none" ? 1 : 0;
      } else {
        const t = trades[i].pnlPts > 0 ? "W" : trades[i].pnlPts < 0 ? "L" : "none";
        if (t === streakType) streak++;
        else break;
      }
    }
    return {
      n_trades: trades.length,
      n_wins: wins.length,
      n_losses: losses.length,
      n_flat: 0,
      total_pnl_pts: Math.round(totalPnl * 4) / 4,
      best_trade_pts: wins.length ? Math.max(...wins.map((t) => t.pnlPts)) : 0,
      worst_trade_pts: losses.length ? Math.min(...losses.map((t) => t.pnlPts)) : 0,
      current_streak: streak,
      streak_type: streakType,
      regime_breakdown: null,
    } satisfies SessionStats;
  }, [sessionStats, trades]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 4, height: "100%", overflow: "hidden" }}>
      {/* Time range toggle */}
      <div style={{ display: "flex", gap: 0, background: colors.bgInset, borderRadius: 4, border: `1px solid ${colors.borderDim}`, overflow: "hidden", flexShrink: 0 }}>
        {(["today", "month"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setTimeRange(r)}
            style={{
              flex: 1,
              background: timeRange === r ? colors.borderDim : "transparent",
              color: timeRange === r ? colors.textPrimary : colors.textDim,
              border: "none",
              padding: "4px 8px",
              fontSize: 10,
              fontFamily: fonts.sans,
              fontWeight: 500,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {r === "today" ? "Today" : "Calendar"}
          </button>
        ))}
      </div>

      {timeRange === "today" && (
        <>
          {rollingAccuracy && <AccuracyStrip accuracy={rollingAccuracy} />}
          {stats && <SessionScorecard stats={stats} />}
          {trades.length > 0 ? (
            <>
              <TradeLog trades={trades} />
              <PerformanceContext trades={trades} pf={liveStats.pf} />
            </>
          ) : (
            <div style={{ padding: 16, color: colors.textMuted, fontSize: 11, textAlign: "center" }}>
              Waiting for trade outcomes...
            </div>
          )}
        </>
      )}

      {timeRange === "month" && (
        <div style={{ flex: 1, overflow: "auto" }}>
          <CalendarHeatmap summaries={dailySummaries} />
        </div>
      )}
    </div>
  );
}

/* ── Accuracy Strip (from hindcast scoring) ── */

function AccuracyStrip({ accuracy }: { accuracy: RollingAccuracy }) {
  const covColor = accuracy.coverage_p10_p90 != null
    ? (accuracy.coverage_p10_p90 >= 0.70 && accuracy.coverage_p10_p90 <= 0.90 ? colors.accentGreen
      : accuracy.coverage_p10_p90 < 0.50 ? colors.accentRed : colors.accentAmber)
    : colors.textMuted;
  const dirColor = accuracy.direction_hit_rate != null
    ? (accuracy.direction_hit_rate > 0.55 ? colors.accentGreen
      : accuracy.direction_hit_rate >= 0.50 ? colors.accentAmber : colors.accentRed)
    : colors.textMuted;
  const trackColor = accuracy.mean_tracking_rmse_pts != null
    ? (accuracy.mean_tracking_rmse_pts < 2 ? colors.accentGreen
      : accuracy.mean_tracking_rmse_pts < 4 ? colors.accentAmber : colors.accentRed)
    : colors.textMuted;

  return (
    <div style={{ display: "flex", justifyContent: "space-around", padding: "6px 4px", background: colors.bgPanel, borderRadius: 6, border: `1px solid ${colors.borderDim}` }}>
      <MiniStat label="Coverage" value={accuracy.coverage_p10_p90 != null ? `${(accuracy.coverage_p10_p90 * 100).toFixed(0)}%` : "--"} color={covColor} sub="ideal ~80%" />
      <MiniStat label="Direction" value={accuracy.direction_hit_rate != null ? `${(accuracy.direction_hit_rate * 100).toFixed(0)}%` : "--"} color={dirColor} sub="hit rate" />
      <MiniStat label="Tracking" value={accuracy.mean_tracking_rmse_pts != null ? `${accuracy.mean_tracking_rmse_pts.toFixed(1)}` : "--"} color={trackColor} sub="RMSE pts" />
      <MiniStat label="n" value={`${accuracy.n_evaluated}`} color={colors.textPrimary} sub="scored" />
    </div>
  );
}

function MiniStat({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 8, color: colors.textMuted, marginBottom: 1 }}>{label}</div>
      <div style={{ fontFamily: fonts.mono, fontSize: 13, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 7, color: colors.textDim, marginTop: 1 }}>{sub}</div>
    </div>
  );
}

/* ── Session Scorecard ── */

function SessionScorecard({ stats }: { stats: SessionStats }) {
  const pnlColor = stats.total_pnl_pts > 0 ? colors.accentGreen : stats.total_pnl_pts < 0 ? colors.accentRed : colors.textSecondary;

  // Build streak dots (last N results from streak info)
  const streakDots = [];
  if (stats.current_streak > 0) {
    const count = Math.min(stats.current_streak, 8);
    for (let i = 0; i < count; i++) {
      streakDots.push(stats.streak_type);
    }
  }

  // Regime context: find the current regime from breakdown
  const regimeEntries = stats.regime_breakdown
    ? Object.entries(stats.regime_breakdown).filter(([k]) => k !== "unknown")
    : [];

  return (
    <div style={{ padding: "8px 10px", background: colors.bgPanel, borderRadius: 6, border: `1px solid ${colors.borderDim}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        {/* W/L record */}
        <div style={{ fontSize: 12, fontFamily: fonts.mono }}>
          <span style={{ color: colors.accentGreen, fontWeight: 700 }}>{stats.n_wins}W</span>
          <span style={{ color: colors.textMuted }}> / </span>
          <span style={{ color: colors.accentRed, fontWeight: 700 }}>{stats.n_losses}L</span>
          {stats.n_flat > 0 && (
            <>
              <span style={{ color: colors.textMuted }}> / </span>
              <span style={{ color: colors.textSecondary }}>{stats.n_flat}F</span>
            </>
          )}
        </div>
        {/* Total P&L */}
        <div style={{ fontFamily: fonts.mono, fontSize: 16, fontWeight: 700, color: pnlColor }}>
          {stats.total_pnl_pts >= 0 ? "+" : ""}{stats.total_pnl_pts.toFixed(2)} pts
        </div>
      </div>

      {/* Streak + regime row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {/* Streak dots */}
        <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: colors.textMuted }}>streak</span>
          {streakDots.length > 0 ? streakDots.map((type, i) => (
            <div
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: type === "W" ? colors.accentGreen : colors.accentRed,
              }}
            />
          )) : (
            <span style={{ fontSize: 9, color: colors.textDim }}>--</span>
          )}
        </div>

        {/* Regime context */}
        {regimeEntries.length > 0 && (
          <div style={{ fontSize: 9, color: colors.textSecondary }}>
            {regimeEntries.slice(0, 2).map(([regime, data]) => (
              <span key={regime} style={{ marginLeft: 8 }}>
                {regime}: {(data as { n: number; wins: number }).wins}/{(data as { n: number }).n}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Trade Log ── */

function TradeLog({ trades }: { trades: Trade[] }) {
  // Show newest first
  const reversed = [...trades].reverse();

  return (
    <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, minHeight: 0 }}>
      {reversed.map((t, i) => {
        const isWin = t.pnlPts > 0;
        const isLoss = t.pnlPts < 0;
        const dirColor = t.direction === "LONG" ? colors.accentGreen : colors.accentRed;
        const arrow = t.direction === "LONG" ? "\u2191" : "\u2193";
        const bgTint = isWin ? withAlpha(colors.accentGreen, 0.04) : isLoss ? withAlpha(colors.accentRed, 0.04) : "transparent";

        return (
          <div
            key={`${t.time}-${i}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 8px",
              background: bgTint,
              borderRadius: 4,
              fontSize: 11,
            }}
          >
            <span style={{ color: colors.textMuted, fontFamily: fonts.mono, fontSize: 10, minWidth: 36 }}>
              {t.time}
            </span>
            <span style={{ color: dirColor, fontWeight: 700, fontSize: 13, minWidth: 16, textAlign: "center" }}>
              {arrow}
            </span>
            <span style={{ color: colors.textSecondary, fontFamily: fonts.mono, fontSize: 10, minWidth: 52 }}>
              {t.entryPrice.toFixed(2)}
            </span>
            {t.regime && (
              <span style={{
                fontSize: 8,
                color: colors.textDim,
                background: colors.borderDim,
                padding: "1px 4px",
                borderRadius: 3,
                textTransform: "capitalize",
              }}>
                {t.regime.replace("_", "-")}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span style={{
              color: isWin ? colors.accentGreen : isLoss ? colors.accentRed : colors.textSecondary,
              fontFamily: fonts.mono,
              fontWeight: 600,
              fontSize: 11,
              minWidth: 52,
              textAlign: "right",
            }}>
              {t.pnlPts >= 0 ? "+" : ""}{t.pnlPts.toFixed(2)}
            </span>
          </div>
        );
      })}
      {trades.length === 0 && (
        <div style={{ padding: 12, color: colors.textMuted, fontSize: 11, textAlign: "center" }}>
          No trades yet this session
        </div>
      )}
    </div>
  );
}

/* ── Performance Context ── */

function PerformanceContext({ trades, pf }: { trades: Trade[]; pf: number | null }) {
  const wins = trades.filter((t) => t.pnlPts > 0);
  const losses = trades.filter((t) => t.pnlPts < 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnlPts, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnlPts, 0) / losses.length : 0;

  // Max drawdown from cumulative P&L
  let cumPnl = 0;
  let peak = 0;
  let maxDD = 0;
  for (const t of trades) {
    cumPnl += t.pnlPts;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDD) maxDD = dd;
  }

  // Equity sparkline data
  const equityPoints: number[] = [];
  let running = 0;
  for (const t of trades) {
    running += t.pnlPts;
    equityPoints.push(running);
  }

  return (
    <div style={{ padding: "6px 8px", background: colors.bgPanel, borderRadius: 6, border: `1px solid ${colors.borderDim}` }}>
      <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 4 }}>
        <PerfStat label="Avg Win" value={avgWin > 0 ? `+${avgWin.toFixed(1)}` : "--"} color={colors.accentGreen} />
        <PerfStat label="Avg Loss" value={avgLoss.toFixed(1)} color={colors.accentRed} />
        <PerfStat label="Max DD" value={`-${maxDD.toFixed(1)}`} color={colors.accentAmber} />
        <PerfStat label="PF" value={pf != null ? pf.toFixed(2) : "--"} color={pf == null ? colors.textMuted : pf >= 1 ? colors.accentGreen : colors.accentRed} />
      </div>
      {equityPoints.length >= 2 && <EquitySparkline data={equityPoints} />}
    </div>
  );
}

function PerfStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 8, color: colors.textMuted }}>{label}</div>
      <div style={{ fontFamily: fonts.mono, fontSize: 12, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

function EquitySparkline({ data }: { data: number[] }) {
  const w = 320;
  const h = 30;
  const pad = 2;
  const allVals = [0, ...data];
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;

  const toX = (i: number) => pad + (i / Math.max(data.length - 1, 1)) * (w - 2 * pad);
  const toY = (v: number) => h - pad - ((v - min) / range) * (h - 2 * pad);

  const points = data.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
  const zeroY = toY(0);
  const lastVal = data[data.length - 1];
  const lineColor = lastVal >= 0 ? colors.accentGreen : colors.accentRed;

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <line x1={pad} y1={zeroY} x2={w - pad} y2={zeroY} stroke={colors.borderMid} strokeWidth={0.5} strokeDasharray="2,2" />
      <polyline points={points} fill="none" stroke={lineColor} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
