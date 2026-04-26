/**
 * DC Trading Dashboard — main layout with 4 tabs.
 * Displays SPX double calendar spread trading data.
 */

import { useMemo, useState } from "react";
import { useDCData } from "../../hooks/useDCData";
import { computeSystemHealth } from "../../lib/systemHealth";
import { colors, fonts, withAlpha, withAlphaByte } from "../../styles/tokens";
import { RouteNav } from "../nav/RouteNav";
import { DCPositionsTab } from "./DCPositionsTab";
import { DCHistoryTab } from "./DCHistoryTab";
import { DCStrategiesTab } from "./DCStrategiesTab";
import { DCSignalsTab } from "./DCSignalsTab";
import { DCEventsTab } from "./DCEventsTab";
import { DCArmedBanner } from "./DCArmedBanner";
import { DCSystemHealthStrip } from "./DCSystemHealthStrip";
import { CapitalAllocationTab } from "./CapitalAllocationTab";

type DCTab = "positions" | "history" | "strategies" | "signals" | "capital" | "events";

const TABS: { value: DCTab; label: string }[] = [
  { value: "signals", label: "Signals" },
  { value: "strategies", label: "Strategies" },
  { value: "positions", label: "Positions" },
  { value: "history", label: "History" },
  { value: "events", label: "Events" },
  { value: "capital", label: "Capital" },
];

export function DCDashboard() {
  const data = useDCData();
  const [tab, setTab] = useState<DCTab>("signals");

  // Rebuild only when the underlying payloads change. `new Date()` is
  // passed inside so age-driven level transitions track polling, not
  // render. If a future feature needs second-by-second aging on the
  // broker pill, switch to a low-rate useTick — the aggregator is pure.
  const health = useMemo(
    () => computeSystemHealth(data.signals, data.brokerState, data.positions),
    [data.signals, data.brokerState, data.positions],
  );

  if (data.loading) {
    return (
      <div style={centerStyle}>
        <div style={spinnerStyle} />
        <span style={{ color: colors.textMuted }}>Loading DC dashboard...</span>
      </div>
    );
  }

  const statusColor = data.apiOnline ? colors.accentGreen : colors.accentRed;
  const pnlColor = (data.summary?.today_pnl ?? 0) >= 0 ? colors.accentGreen : colors.accentRed;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: colors.bgBase }}>
      {/* Header */}
      <header style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: `1px solid ${colors.borderDim}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{
            margin: 0, fontSize: 18, fontWeight: 700,
            fontFamily: fonts.sans, color: colors.textPrimary, letterSpacing: 0.5,
          }}>
            DC Trading
          </h1>
          <span style={{
            fontSize: 10, fontWeight: 600, fontFamily: fonts.sans,
            padding: "2px 8px", borderRadius: 10, letterSpacing: 0.5,
            color: statusColor,
            background: withAlphaByte(statusColor, 0x18),
            border: `1px solid ${withAlpha(statusColor, 0.25)}`,
          }}>
            {data.apiOnline ? (data.summary?.daemon_online ? "LIVE" : "HISTORICAL") : "OFFLINE"}
          </span>
          {data.summary && (
            <span style={{
              fontFamily: fonts.mono, fontSize: 13, color: colors.textSecondary,
            }}>
              {data.summary.open_positions} open &middot; {data.summary.today_trades} today &middot;{" "}
              <span style={{ color: pnlColor }}>
                {data.summary.today_pnl >= 0 ? "+" : ""}{data.summary.today_pnl.toFixed(2)}
              </span>
            </span>
          )}
        </div>
        <RouteNav current="dc" showBrand={false} />
      </header>

      {/* System Health strip — one ambient anomaly-radar row. Neutral
          when healthy; lights up amber/red on IV fallback, stale broker
          sidecar, or position drift. Hidden when the API is offline
          because every pill would be grey (unknown) and add noise. */}
      {data.apiOnline && (
        <DCSystemHealthStrip
          health={health}
          onClickIV={() => setTab("signals")}
          onClickBroker={() => setTab("positions")}
          onClickDrift={() => setTab("positions")}
        />
      )}

      {/* API offline banner */}
      {!data.apiOnline && (
        <div style={{
          background: withAlpha(colors.accentRed, 0.08),
          border: `1px solid ${withAlpha(colors.accentRed, 0.25)}`,
          borderRadius: 6, padding: "8px 16px", margin: "8px 12px 0",
          fontFamily: fonts.sans, fontSize: 12, color: colors.textSecondary,
        }}>
          <span style={{ color: colors.accentRed, fontWeight: 600 }}>DC API Unavailable</span>
          {" "}— Ensure the DC API server is running on port 8001.
        </div>
      )}

      {/* Armed banner — appears when subscribed strategies are imminent/firing */}
      <DCArmedBanner signals={data.signals} onClickJumpToSignals={() => setTab("signals")} />

      {/* Tab bar */}
      <div className="tab-bar" style={{ padding: "0 12px", marginTop: 8 }}>
        {TABS.map((t) => (
          <button
            key={t.value}
            className={`tab-btn ${tab === t.value ? "active" : ""}`}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
        {tab === "positions" && <DCPositionsTab positions={data.positions} risk={data.risk} brokerState={data.brokerState} />}
        {tab === "history" && <DCHistoryTab trades={data.trades} />}
        {tab === "strategies" && <DCStrategiesTab stats={data.strategies} signals={data.signals} />}
        {tab === "signals" && (
          <DCSignalsTab
            signals={data.signals}
            strategies={data.strategies}
            positions={data.positions}
          />
        )}
        {tab === "events" && <DCEventsTab />}
        {tab === "capital" && (
          <CapitalAllocationTab positions={data.positions} />
        )}
      </div>
    </div>
  );
}

const centerStyle: React.CSSProperties = {
  height: "100%", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center",
  background: colors.bgBase, color: colors.textMuted, fontFamily: fonts.sans, gap: 12,
};

const spinnerStyle: React.CSSProperties = {
  width: 32, height: 32, border: `3px solid ${colors.borderDim}`, borderTopColor: colors.accentBlue,
  borderRadius: "50%", animation: "spin 1s linear infinite",
};
