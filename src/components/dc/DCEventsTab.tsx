/**
 * DC Events Tab — audit log of every entry attempt (signal fire) persisted
 * to the daemon's signal_events table.
 *
 * One row per attempt: entered, skipped_signal, or blocked_* with full
 * context (features snapshot, S/L ratio at the time, reason text).
 *
 * 2026-08-01: automated DC entry is retired (daemon switch
 * `dc_entry.enabled`, shipped false). The daemon still evaluates and
 * records every signal, so from that date this tab stops being an
 * execution log and becomes the "would have fired" RESEARCH record: a
 * GO/GO+ that the daemon deliberately did not trade lands as
 * `blocked_entries_disabled`, carrying the signal name. Those rows are
 * now the primary content, which is why they get their own colour tier
 * rather than falling through to the unknown-outcome default.
 */

import { useMemo, useState } from "react";

import { useDCSignalEvents } from "../../hooks/useDCSignalEvents";
import { useTimezone } from "../../hooks/useTimezone";
import type { DCSignalEvent } from "../../api/dcTypes";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import { SignalBadge } from "./SignalBadge";
import {
  STICKY_HEADER_BG,
  tableStyle,
  thStickyStyle as thStyle,
  tdStyle,
  tdMono,
} from "./tableStyles";

function todayET(): string {
  // Date FILTER stays ET-anchored. The backend's `entry_date` column
  // is computed from the daemon's ET wall-clock at entry time
  // (engine/entry.py: ctx.now.strftime('%Y-%m-%d') with ctx.now in
  // ET), so the date filter must match that semantic. A PT trader
  // at 8pm PT (= 11pm ET) clicking "Today" wants the ET-current
  // date — matches the backend, matches the trader-mental-model
  // of "today's session." Display of the Time COLUMN is separately
  // formatted in the user's selected TZ via useTimezone (see
  // EventRow); the filter and the display are decoupled.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
    .format(new Date());
}

/**
 * Outcomes that get a summary chip, in display order.
 *
 * This list is EXHAUSTIVE-BY-HAND, not derived from the data: a chip only
 * renders when its count is non-zero, so an outcome missing from this array
 * is silently absent from the summary even while its rows sit in the table
 * below. That is how `blocked_entries_disabled` was initially invisible.
 * Exported so a test can pin membership — when the daemon gains an outcome,
 * add it here.
 */
export const SUMMARY_OUTCOMES = [
  "entered",
  "blocked_entries_disabled",
  "skipped_signal",
  "blocked_sl",
  "blocked_margin",
  "blocked_risk",
  "blocked_strike",
  "blocked_legs",
  "blocked_conn",
  "blocked_data",
  "blocked_vix",
  "blocked_size",
  "blocked_order",
  "blocked_duplicate",
  "blocked_deconflict",
  // Credit-direction strategies (straddles) are signals/dashboard-only —
  // engine/entry.py gate 0. Emitted by the daemon but absent from this
  // list until 2026-08-01, i.e. chip-less rows: the same bug this list
  // was extracted to prevent.
  "blocked_direction",
] as const;

export function DCEventsTab() {
  const [date, setDate] = useState<string>(todayET());
  const [strategyFilter, setStrategyFilter] = useState<string>("");
  // Time-column display follows the user's selected timezone (set by
  // the dropdown next to the chart on /app, persisted in localStorage
  // as `dc.timezone`). Date filter stays ET-anchored — see todayET().
  const { formatChartTime, tzLabel } = useTimezone();

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

        <div style={{ width: 1, alignSelf: "stretch", background: colors.borderDim, margin: "0 4px" }} />

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

        <div style={{ marginLeft: "auto", fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans }}>
          {loading ? "Loading…" : `${events.length} events`}
        </div>
      </div>

      {/* Summary chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {SUMMARY_OUTCOMES.map((k) => {
          const n = counts[k] ?? 0;
          if (n === 0) return null;
          const color = outcomeColor(k);
          return (
            <div key={k} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 10px", borderRadius: 14, fontSize: 11,
              fontFamily: fonts.sans, background: color + "18",
              border: `1px solid ${color}40`, color,
            }}>
              <span style={{ fontWeight: 700 }}>{n}</span>
              <span style={{ opacity: 0.85 }}>{labelFor(k)}</span>
            </div>
          );
        })}
        {/* Drift rollup chip (R2 follow-up to PR #174 — task #261).
            Appears only when ≥1 entry in the visible session had its
            strikes re-resolved mid-window. Amber to match the per-row
            Drift column color encoding; tooltip explains the meaning.
            Hidden when total drift events == 0 (the common quiet day)
            so the chip row stays uncluttered. */}
        {(() => {
          const driftEvents = events.filter(
            (e) => (e.pre_entry_reresolve_count ?? 0) > 0,
          );
          if (driftEvents.length === 0) return null;
          const totalReresolves = driftEvents.reduce(
            (sum, e) => sum + (e.pre_entry_reresolve_count ?? 0), 0,
          );
          return (
            <div
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "4px 10px", borderRadius: 14, fontSize: 11,
                fontFamily: fonts.sans, background: colors.accentAmber + "18",
                border: `1px solid ${colors.accentAmber}40`,
                color: colors.accentAmber,
              }}
              title={
                `${driftEvents.length} ${driftEvents.length === 1 ? "entry" : "entries"} `
                + `had ${totalReresolves} mid-window strike re-resolve${totalReresolves === 1 ? "" : "s"} total. `
                + `Common on FOMC/CPI/NFP days when SPX moves enough during the T-60s pre-entry `
                + `window that the original 20Δ strikes drift past the 0.03 threshold.`
              }
            >
              <span style={{ fontWeight: 700 }}>{driftEvents.length}</span>
              <span style={{ opacity: 0.85 }}>w/ drift</span>
            </div>
          );
        })()}
      </div>

      {/* Error/empty */}
      {error && (
        <div className="panel" style={{ padding: 12, color: colors.accentRed, fontSize: 13 }}>
          Failed to load signal events from the DC API.
        </div>
      )}

      {/* Table */}
      <div className="panel" style={{ padding: 12 }}>
        <div className="panel-header" style={{ marginBottom: 8 }}>
          <span className="panel-title">Signal Events</span>
        </div>
        {!loading && events.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: 13, textAlign: "center", padding: 24 }}>
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
                  <th
                    scope="col"
                    style={thStyle}
                    title="Resolved strikes the daemon picked (post-deconflict-move). NULL when the resolve phase didn't run (blocked_strike, prechecks)."
                  >
                    Strikes
                  </th>
                  <th style={thStyle}>Reason</th>
                  <th style={thStyle}>S/L</th>
                  <th style={thStyle}>Debit</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>SPX</th>
                  <th
                    scope="col"
                    aria-label="IV anchor source — chain, vix, or default"
                    style={thStyle}
                    title="IV anchor at THIS event's resolve attempt. Distinct from the live SL-poll badge (different cycles)."
                  >
                    IV
                  </th>
                  <th
                    scope="col"
                    aria-label="Pre-entry re-resolve count"
                    style={thStyle}
                    title="Number of times the drift watcher re-resolved this strategy's strikes during the T-60s pre-entry window. 0 on quiet days, 1-2 on macro-event days. NULL on rows that didn't reach the gate (blocked_signal, blocked_strike, etc)."
                  >
                    Drift
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <EventRow key={e.id} event={e} formatChartTime={formatChartTime} tzLabel={tzLabel} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({
  event, formatChartTime, tzLabel,
}: {
  event: DCSignalEvent;
  formatChartTime: (iso: string, withSeconds?: boolean) => string;
  tzLabel: string;
}) {
  return (
    <tr>
      <td style={{ ...tdMono, whiteSpace: "nowrap" }}
          title={`Rendered: ${formatChartTime(event.entry_time, true)} ${tzLabel} • Raw broker timestamp: ${event.entry_time}`}>
        {formatChartTime(event.entry_time, true)}{" "}
        <span style={{ color: colors.textMuted, fontSize: 10 }}>{tzLabel}</span>
      </td>
      <td style={tdStyle}>{event.strategy_name}</td>
      <td style={tdStyle}><SignalBadge signal={event.signal} /></td>
      <td style={tdStyle}>
        <OutcomeBadge outcome={event.outcome} />
        <MoveBadge event={event} />
      </td>
      <td style={tdMono} title={resolvedStrikesTitle(event)}>
        {formatResolvedStrikes(event)}
      </td>
      <td style={{ ...tdStyle, color: colors.textSecondary, maxWidth: 360 }}>
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
      <td style={driftCellStyle(event.pre_entry_reresolve_count ?? null)}
          title={driftCellTitle(event.pre_entry_reresolve_count ?? null)}>
        {event.pre_entry_reresolve_count ?? "—"}
      </td>
    </tr>
  );
}

/** Style the Drift cell. 0 reads as the quiet baseline (textMuted);
 *  any positive count is amber to draw the operator's eye — SPX
 *  moved enough during the pre-entry window to re-resolve strikes,
 *  which is operationally noteworthy on macro days. NULL is the
 *  generic "—" mono cell (rows that didn't reach the gate). */
export function driftCellStyle(
  count: number | null,
): React.CSSProperties {
  if (count == null) return tdMono;
  if (count === 0) return { ...tdMono, color: colors.textMuted };
  return { ...tdMono, color: colors.accentAmber, fontWeight: 600 };
}

export function driftCellTitle(count: number | null): string {
  if (count == null) {
    return "Event predates drift tracking, OR didn't reach the entry gate (blocked_signal, blocked_strike, etc.).";
  }
  if (count === 0) {
    return "No mid-window re-resolves. SPX stayed within the 0.03 delta-drift threshold for the full 60s pre-entry window — the gate used the original strikes.";
  }
  return `${count} mid-window re-resolve${count === 1 ? "" : "s"}. SPX moved enough during the pre-entry window that the drift watcher fetched fresh strikes at least once. Common on FOMC/CPI/NFP days.`;
}

/** "P7050 / C7280" when both strikes resolved, "P7050 / —" if only put,
 *  "—" if neither (resolve phase didn't run). SPX strikes are integers;
 *  toFixed(0) keeps the cell compact in the dense events table. */
function formatResolvedStrikes(event: DCSignalEvent): string {
  const p = event.resolved_put_strike;
  const c = event.resolved_call_strike;
  if (p == null && c == null) return "—";
  const pStr = p != null ? `P${p.toFixed(0)}` : "—";
  const cStr = c != null ? `C${c.toFixed(0)}` : "—";
  return `${pStr} / ${cStr}`;
}

/** Tooltip for the Strikes cell. Returns "" (no tooltip) for the
 *  common no-conflict case — the column header already explains
 *  what the cell shows. Surfaces deconflict context only when an
 *  auto-move actually fired (ideal vs. resolved differ).
 *
 *  `conflicting_strategy` is comma-joined when both legs conflict;
 *  we render BOTH ideal sides independently rather than branching
 *  put-vs-call so a dual-leg conflict doesn't shadow one side.
 */
function resolvedStrikesTitle(event: DCSignalEvent): string {
  const p = event.resolved_put_strike;
  const c = event.resolved_call_strike;
  if (p == null && c == null) {
    return "Resolved strikes — NULL when the resolve phase didn't run (blocked_strike, prechecks failed, or connect failure)";
  }
  if (!event.conflicting_strategy) return "";
  const parts: string[] = [];
  if (event.ideal_put_strike != null && p != null) {
    parts.push(`ideal P${event.ideal_put_strike.toFixed(0)} → resolved P${p.toFixed(0)}`);
  }
  if (event.ideal_call_strike != null && c != null) {
    parts.push(`ideal C${event.ideal_call_strike.toFixed(0)} → resolved C${c.toFixed(0)}`);
  }
  if (parts.length === 0) return "";
  return `${parts.join(" · ")} (conflicted with ${event.conflicting_strategy})`;
}


export function ivSourceCellStyle(source: DCSignalEvent["iv_source"]): React.CSSProperties {
  const base = { ...tdMono, fontSize: 10, textTransform: "uppercase" as const, letterSpacing: 0.5 };
  switch (source) {
    case "chain":   return { ...base, color: colors.accentGreen };
    case "vix":     return { ...base, color: colors.accentAmber };
    case "default": return { ...base, color: colors.accentRed };
    default:        return { ...base, color: colors.textMuted };
  }
}


export function ivSourceTitle(source: DCSignalEvent["iv_source"]): string {
  // Tight one-liners — internal nuance lives in the JSDoc on
  // IVSourceBadge. Distinct from the live "Live IV" badge: this one
  // is the entry-time anchor (at resolve), not the SL worker's poll.
  switch (source) {
    case "chain":   return "Live chain-sampled ATM IV at resolve (good path).";
    case "vix":     return "Fell back to VIX-scaled IV at resolve — pre-fix path that caused the 21/28 strike incident.";
    case "default": return "Hardcoded 20% default at resolve — cold-start or feature-refresh failure.";
    default:        return "Event fired before any resolve happened, or predates iv_source tracking.";
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
        marginLeft: 4, fontFamily: fonts.sans,
        // accentRedLight (persimmon-light) tier — between accentAmber (warn)
        // and accentRed (error) for blocked_* deconflict outcomes. Matches
        // the OUTCOME column severity tiers in outcomeColor().
        color: colors.accentRedLight,
        background: withAlpha(colors.accentRedLight, 0.094),
        border: `1px solid ${withAlpha(colors.accentRedLight, 0.25)}`,
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
      fontFamily: fonts.sans, color,
      background: color + "18",
    }}>
      {labelFor(outcome).toUpperCase()}
    </span>
  );
}

export function outcomeColor(outcome: string): string {
  if (outcome === "entered") return colors.accentGreen;
  // The retirement state (2026-08-01). Deliberately NOT textMuted: a
  // `blocked_entries_disabled` row means a GO/GO+ actually fired and we
  // declined to trade it, which is the opposite of `skipped_signal`'s "no
  // signal today". Flattening the two into the same grey would erase the
  // distinction this tab now exists to show. Blue reads as informational
  // rather than as any tier of failure — because it isn't one.
  if (outcome === "blocked_entries_disabled") return colors.accentBlue;
  if (outcome === "skipped_signal") return colors.textMuted;
  // Two intermediate severity tiers between accentGreen (entered) and
  // accentRed (hard-error blocked): accentAmber for soft-block (sl/vix
  // recoverable on next cycle) and accentRedLight for mid-block
  // (margin/risk/dup/size/deconflict — these are caller-side rejections,
  // not infrastructure failures).
  if (outcome === "blocked_sl" || outcome === "blocked_vix") return colors.accentAmber;
  if (outcome === "blocked_margin" || outcome === "blocked_risk"
      || outcome === "blocked_duplicate" || outcome === "blocked_size"
      || outcome === "blocked_deconflict") return colors.accentRedLight;
  if (outcome === "blocked_strike" || outcome === "blocked_legs"
      || outcome === "blocked_conn" || outcome === "blocked_data"
      || outcome === "blocked_order") return colors.accentRed;
  return colors.textSecondary;
}

export function labelFor(outcome: string): string {
  // The generic transform would render this one as "blk:entries disabled",
  // which reads as a malfunction. It is a policy state, and now the most
  // common row on the tab, so it gets a plain-language label.
  if (outcome === "blocked_entries_disabled") return "not traded";
  return outcome.replace(/^blocked_/, "blk:").replace(/_/g, " ");
}

function summarizeOutcomes(events: DCSignalEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) out[e.outcome] = (out[e.outcome] ?? 0) + 1;
  return out;
}

const labelStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 4, fontSize: 10,
  color: colors.textMuted, fontFamily: fonts.sans, textTransform: "uppercase", letterSpacing: 0.5,
};
const inputStyle: React.CSSProperties = {
  background: STICKY_HEADER_BG, color: colors.textPrimary, border: `1px solid ${colors.borderDim}`,
  borderRadius: 4, padding: "4px 8px", fontSize: 12, fontFamily: fonts.mono,
};
const chipButtonStyle = (active: boolean): React.CSSProperties => ({
  background: active ? colors.borderDim : STICKY_HEADER_BG,
  color: active ? colors.textPrimary : colors.textSecondary,
  border: `1px solid ${active ? colors.accentBlue : colors.borderDim}`,
  borderRadius: 4, padding: "5px 10px",
  fontSize: 11, fontFamily: fonts.sans, cursor: "pointer",
  alignSelf: "flex-end",
});
