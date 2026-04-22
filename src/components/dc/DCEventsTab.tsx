/**
 * DC Events Tab — audit log of every entry attempt (signal fire) persisted
 * to the daemon's signal_events table.
 *
 * One row per attempt: entered, skipped_signal, or blocked_* with full
 * context (features snapshot, S/L ratio at the time, reason text).
 */

import { useMemo, useState } from "react";

import { useDCSignalEvents } from "../../hooks/useDCSignalEvents";
import type { DCSignalEvent } from "../../api/dcTypes";
import { SignalBadge } from "./SignalBadge";

const ET_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function todayET(): string {
  // Render ET date for the default date input value.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
    .format(new Date());
}

export function DCEventsTab() {
  const [date, setDate] = useState<string>(todayET());
  const [strategyFilter, setStrategyFilter] = useState<string>("");

  const today = todayET();
  const effectiveDate = date === "all" ? "all" : date;
  const { events, loading, error } = useDCSignalEvents({
    date: effectiveDate || undefined,
    strategy: strategyFilter || undefined,
  });

  // Derive strategy list from the fetched events so the filter only shows
  // strategies that actually have rows in the current view.
  const strategyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) set.add(e.strategy_name);
    return Array.from(set).sort();
  }, [events]);

  const counts = useMemo(() => summarizeOutcomes(events), [events]);

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Filter row */}
      <div className="panel" style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <label style={labelStyle}>
          Date
          <input
            type="date"
            value={date === "all" ? "" : date}
            // Empty changes (native clear-X, or the empty state after
            // "All history" is picked) are a no-op. The chip buttons are
            // the only way to enter/leave the "all" mode — otherwise the
            // browser clear button would silently snap back to today and
            // fight with the All-history toggle.
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
            style={inputStyle}
          />
        </label>
        <button
          onClick={() => setDate(today)}
          style={chipButtonStyle(date === today)}
        >
          Today
        </button>
        <button
          onClick={() => setDate("all")}
          style={chipButtonStyle(date === "all")}
        >
          All history
        </button>

        <div style={{ width: 1, alignSelf: "stretch", background: "#1e293b", margin: "0 4px" }} />

        <label style={labelStyle}>
          Strategy
          <select
            value={strategyFilter}
            onChange={(e) => setStrategyFilter(e.target.value)}
            style={inputStyle}
          >
            <option value="">All</option>
            {strategyOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <div style={{ marginLeft: "auto", fontSize: 11, color: "#64748b", fontFamily: "Inter, sans-serif" }}>
          {loading ? "Loading…" : `${events.length} events`}
        </div>
      </div>

      {/* Summary chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {(["entered", "skipped_signal", "blocked_sl", "blocked_margin",
           "blocked_risk", "blocked_strike", "blocked_legs", "blocked_conn",
           "blocked_data", "blocked_vix", "blocked_size", "blocked_order",
           "blocked_duplicate", "blocked_deconflict"] as const).map((k) => {
          const n = counts[k] ?? 0;
          if (n === 0) return null;
          const color = outcomeColor(k);
          return (
            <div key={k} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 10px", borderRadius: 14, fontSize: 11,
              fontFamily: "Inter, sans-serif", background: color + "18",
              border: `1px solid ${color}40`, color,
            }}>
              <span style={{ fontWeight: 700 }}>{n}</span>
              <span style={{ opacity: 0.85 }}>{labelFor(k)}</span>
            </div>
          );
        })}
      </div>

      {/* Error/empty */}
      {error && (
        <div className="panel" style={{ padding: 12, color: "#ef4444", fontSize: 13 }}>
          Failed to load signal events from the DC API.
        </div>
      )}

      {/* Table */}
      <div className="panel" style={{ padding: 12 }}>
        <div className="panel-header" style={{ marginBottom: 8 }}>
          <span className="panel-title">Signal Events</span>
        </div>
        {!loading && events.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: 24 }}>
            No events {date === "all" ? "recorded" : `on ${date}`}.
          </div>
        ) : (
          <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 320px)", overflowY: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Time</th>
                  <th style={thStyle}>Strategy</th>
                  <th style={thStyle}>Signal</th>
                  <th style={thStyle}>Outcome</th>
                  <th style={thStyle}>Reason</th>
                  <th style={thStyle}>S/L</th>
                  <th style={thStyle}>Debit</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>SPX</th>
                  <th
                    scope="col"
                    aria-label="IV anchor source — chain, vix, or default"
                    style={thStyle}
                    title="IV anchor the BS inverter used for this resolve (chain = live sample, vix = fallback, default = cold-start)"
                  >
                    IV
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: DCSignalEvent }) {
  return (
    <tr>
      <td style={tdMono}>{formatET(event.entry_time)}</td>
      <td style={tdStyle}>{event.strategy_name}</td>
      <td style={tdStyle}><SignalBadge signal={event.signal} /></td>
      <td style={tdStyle}>
        <OutcomeBadge outcome={event.outcome} />
        <MoveBadge event={event} />
      </td>
      <td style={{ ...tdStyle, color: "#94a3b8", maxWidth: 360 }}>
        {event.outcome_reason ?? "—"}
      </td>
      <td style={tdMono}>
        {event.sl_ratio != null ? event.sl_ratio.toFixed(3) : "—"}
      </td>
      <td style={tdMono}>
        {event.entry_debit != null ? `$${event.entry_debit.toFixed(2)}` : "—"}
      </td>
      <td style={tdMono}>{event.quantity ?? "—"}</td>
      <td style={tdMono}>
        {event.spx_at_event != null ? event.spx_at_event.toFixed(0) : "—"}
      </td>
      <td style={ivSourceCellStyle(event.iv_source)} title={ivSourceTitle(event.iv_source)}>
        {event.iv_source ?? "—"}
      </td>
    </tr>
  );
}


export function ivSourceCellStyle(source: DCSignalEvent["iv_source"]): React.CSSProperties {
  const base = { ...tdMono, fontSize: 10, textTransform: "uppercase" as const, letterSpacing: 0.5 };
  switch (source) {
    case "chain":   return { ...base, color: "#10b981" };
    case "vix":     return { ...base, color: "#f59e0b" };
    case "default": return { ...base, color: "#ef4444" };
    default:        return { ...base, color: "#64748b" };
  }
}


export function ivSourceTitle(source: DCSignalEvent["iv_source"]): string {
  switch (source) {
    case "chain":   return "Live chain-sampled ATM IV fed the BS inverter (good path).";
    case "vix":     return "Fell back to VIX-scaled IV — chain sample failed. This was the pre-fix path that caused the 21/28 strike incident.";
    case "default": return "Neither chain nor VIX available — hardcoded 20% default. Cold-start or feature-refresh failure.";
    default:        return "Event fired before any resolve happened (blocked_signal / blocked_features / blocked_vix / blocked_canTrade) or predates iv_source tracking.";
  }
}


/**
 * Inline badge shown next to the outcome when a strategy's entry had
 * to auto-move one or both strikes to avoid a conflict with an already-
 * open position. Renders nothing when conflicting_strategy is null
 * (the common case).
 *
 * Format: MOVED (put) P7050→7055 · avoiding 2/3 DC
 *
 * We intentionally show ONLY the ideal_* side that was actually moved —
 * the other leg would show "ideal==actual" and clutter the row.
 */
function MoveBadge({ event }: { event: DCSignalEvent }) {
  if (!event.conflicting_strategy) return null;
  const parts: string[] = [];
  if (event.ideal_put_strike != null) {
    parts.push(`P${event.ideal_put_strike.toFixed(0)}`);
  }
  if (event.ideal_call_strike != null) {
    parts.push(`C${event.ideal_call_strike.toFixed(0)}`);
  }
  if (parts.length === 0) return null;
  return (
    <span
      title={`Ideal strike ${parts.join(", ")} was held by ${event.conflicting_strategy}; auto-moved to next delta-tolerable strike`}
      style={{
        fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 8,
        marginLeft: 4, fontFamily: "Inter, sans-serif",
        color: "#f97316",
        background: "#f9731618",
        border: "1px solid #f9731640",
        verticalAlign: "middle",
      }}
    >
      MOVED · avoid {event.conflicting_strategy}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const color = outcomeColor(outcome);
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8,
      fontFamily: "Inter, sans-serif", color,
      background: color + "18",
    }}>
      {labelFor(outcome).toUpperCase()}
    </span>
  );
}

function outcomeColor(outcome: string): string {
  if (outcome === "entered") return "#10b981";
  if (outcome === "skipped_signal") return "#64748b";
  if (outcome === "blocked_sl" || outcome === "blocked_vix") return "#eab308";
  if (outcome === "blocked_margin" || outcome === "blocked_risk"
      || outcome === "blocked_duplicate" || outcome === "blocked_size"
      || outcome === "blocked_deconflict") return "#f97316";
  if (outcome === "blocked_strike" || outcome === "blocked_legs"
      || outcome === "blocked_conn" || outcome === "blocked_data"
      || outcome === "blocked_order") return "#ef4444";
  return "#94a3b8";
}

function labelFor(outcome: string): string {
  return outcome.replace(/^blocked_/, "blk:").replace(/_/g, " ");
}

function summarizeOutcomes(events: DCSignalEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) out[e.outcome] = (out[e.outcome] ?? 0) + 1;
  return out;
}

function formatET(iso: string): string {
  try {
    return ET_TIME.format(new Date(iso));
  } catch {
    return iso;
  }
}

const labelStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 4, fontSize: 10,
  color: "#64748b", fontFamily: "Inter, sans-serif", textTransform: "uppercase", letterSpacing: 0.5,
};
const inputStyle: React.CSSProperties = {
  background: "#0f1520", color: "#e2e8f0", border: "1px solid #1e293b",
  borderRadius: 4, padding: "4px 8px", fontSize: 12, fontFamily: "JetBrains Mono, monospace",
};
const chipButtonStyle = (active: boolean): React.CSSProperties => ({
  background: active ? "#1e293b" : "#0f1520",
  color: active ? "#e2e8f0" : "#94a3b8",
  border: `1px solid ${active ? "#3b82f6" : "#1e293b"}`,
  borderRadius: 4, padding: "5px 10px",
  fontSize: 11, fontFamily: "Inter, sans-serif", cursor: "pointer",
  alignSelf: "flex-end",
});
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "6px 8px", color: "#64748b", fontSize: 10,
  fontFamily: "Inter, sans-serif", textTransform: "uppercase", letterSpacing: 0.5,
  borderBottom: "1px solid #1e293b", position: "sticky", top: 0, background: "#0f1520",
};
const tdStyle: React.CSSProperties = {
  padding: "6px 8px", color: "#e2e8f0", fontSize: 12,
  fontFamily: "Inter, sans-serif", borderBottom: "1px solid #111827",
};
const tdMono: React.CSSProperties = { ...tdStyle, fontFamily: "JetBrains Mono, monospace" };
