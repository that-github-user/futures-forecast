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
 *
 * The tab renders TWO axes and they are not the same question.
 * `eventOutcomeClass.ts` owns the verdict axis — in / should be in / no
 * trade — which is the headline. This file owns the mechanical axis:
 * which gate stopped it, and how badly. A `blocked_order` row is
 * should-be-in on the first axis (the daemon went to market) and red on
 * the second (the ladder exhausted with zero fills). Both are true; the
 * old single binary could only say one of them, and said the wrong one.
 */

import { useMemo, useState } from "react";

import { useDCSignalEvents } from "../../hooks/useDCSignalEvents";
import { useTimezone } from "../../hooks/useTimezone";
import type { DCSignalEvent } from "../../api/dcTypes";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import type { EventClass } from "./eventOutcomeClass";
import {
  EVENT_CLASS_ORDER,
  classifyOutcome,
  eventClassColor,
  eventClassLabel,
  eventClassTooltip,
  orderOutcomesForDisplay,
} from "./eventOutcomeClass";
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
 * Row budget per fetch. A single session tops out around a dozen events,
 * and "All history" grows steadily, so 500 — the hook's old hardcoded
 * value — would have quietly become "the newest 500" within months while
 * the chip still said "All history". (Stated without the live row count
 * and date that used to sit here: this repo is public and the daemon's
 * is not.) The API
 * caps at 5000 (api/app.py: `le=5000`); 2000 buys years of headroom and
 * the truncation note below catches the day it doesn't.
 */
const DAY_LIMIT = 500;
const ALL_HISTORY_LIMIT = 2000;

export function DCEventsTab() {
  const [date, setDate] = useState<string>(todayET());
  const [strategyFilter, setStrategyFilter] = useState<string>("");
  const [classFilter, setClassFilter] = useState<EventClass | null>(null);
  const [outcomeFilter, setOutcomeFilter] = useState<string | null>(null);
  // Time-column display follows the user's selected timezone (set by
  // the dropdown next to the chart on /app, persisted in localStorage
  // as `dc.timezone`). Date filter stays ET-anchored — see todayET().
  const { formatChartTime, tzLabel } = useTimezone();

  const today = todayET();
  const limit = date === "all" ? ALL_HISTORY_LIMIT : DAY_LIMIT;
  // Strategy is deliberately NOT sent to the API. It used to be, and the
  // option list was then derived from the strategy-scoped response — so
  // picking a strategy collapsed the dropdown to that one strategy and
  // switching required a detour through "All". Date stays server-side
  // (it bounds the payload); strategy is a client-side slice of a set we
  // already hold.
  const { events, loading, error } = useDCSignalEvents({ date, limit });

  // Options come from the UNFILTERED fetch, so every strategy with a row
  // on this date is always reachable in one click.
  const strategyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) set.add(e.strategy_name);
    // Keep the active selection listed even when this date has no rows for
    // it. Without this the controlled <select> has no matching option, the
    // DOM renders it blank, and the operator sees an apparently-unset
    // filter that is nonetheless filtering everything away.
    if (strategyFilter) set.add(strategyFilter);
    return Array.from(set).sort();
  }, [events, strategyFilter]);

  // Three nested scopes, in the order the filters compose:
  //   scoped      — date (server) + strategy. The class chip counts.
  //   classScoped — plus the class chip. The outcome chip list + counts.
  //   visible     — plus the outcome chip. The table.
  // The class counts MUST read `scoped`, not `visible`, or every chip
  // zeroes itself the moment one of them is clicked.
  const scoped = useMemo(
    () => (strategyFilter ? events.filter((e) => e.strategy_name === strategyFilter) : events),
    [events, strategyFilter],
  );

  const classCounts = useMemo(() => {
    const out: Record<EventClass, number> = { in: 0, should_be_in: 0, no_trade: 0 };
    for (const e of scoped) out[classifyOutcome(e.outcome)] += 1;
    return out;
  }, [scoped]);

  const classScoped = useMemo(
    () => (classFilter ? scoped.filter((e) => classifyOutcome(e.outcome) === classFilter) : scoped),
    [scoped, classFilter],
  );

  const counts = useMemo(() => summarizeOutcomes(classScoped), [classScoped]);
  // DERIVED, never whitelisted — see OUTCOME_DISPLAY_ORDER's doc comment.
  // Any outcome present in the data gets a chip, including one this build
  // has never heard of.
  const outcomeChips = useMemo(() => {
    const present = Object.keys(counts);
    // Force-keep the ACTIVE chip even when the surrounding scope no longer
    // contains that outcome — same guarantee the strategy <select> makes
    // above, for the same reason. Pick "entered", then a strategy with no
    // fills, and the chip would otherwise vanish while still filtering:
    // three unpressed tiles, three unpressed chips, an empty table, and
    // nothing on screen or in the a11y tree naming what emptied it. It
    // renders at 0 (the `counts[k] ?? 0` fallback below), which reads as
    // "this filter is on and matches nothing here" — the true statement.
    if (outcomeFilter) present.push(outcomeFilter);
    return orderOutcomesForDisplay(present);
  }, [counts, outcomeFilter]);

  const visible = useMemo(
    () => (outcomeFilter ? classScoped.filter((e) => e.outcome === outcomeFilter) : classScoped),
    [classScoped, outcomeFilter],
  );

  const filtersActive = strategyFilter !== "" || classFilter !== null || outcomeFilter !== null;
  const clearFilters = () => {
    setStrategyFilter("");
    setClassFilter(null);
    setOutcomeFilter(null);
  };

  const toggleClass = (c: EventClass) => {
    const next = classFilter === c ? null : c;
    setClassFilter(next);
    // Drop an outcome filter the new class cannot contain. Intersecting
    // them would empty the table while both chips still read as active,
    // and neither would explain why.
    if (next && outcomeFilter && classifyOutcome(outcomeFilter) !== next) {
      setOutcomeFilter(null);
    }
  };

  const toggleOutcome = (o: string) => {
    if (outcomeFilter === o) {
      setOutcomeFilter(null);
      return;
    }
    setOutcomeFilter(o);
    // An outcome chip is the more specific intent, so it MOVES the class
    // filter rather than intersecting with it. Unreachable through the UI
    // today (the chips are derived from the class-scoped set, so every
    // visible chip is already inside the active class) — kept as a guard
    // so a future entry point can't produce an empty intersection.
    if (classFilter && classifyOutcome(o) !== classFilter) {
      setClassFilter(classifyOutcome(o));
    }
  };

  // The API truncates newest-first with no total in the response, so a full
  // page is the only truncation signal available. Better a false positive on
  // an exact-N day than silently relabelling "newest 2000" as "All history".
  const truncated = !loading && events.length >= limit;

  // An empty list means one of two things this tab must never confuse, and
  // the stakes went up when the verdict counts became three 22px headline
  // numbers: either the daemon evaluated nothing, or we could not ask.
  // `useDCSignalEvents` now keeps last-good rows through a dropped poll, so
  // a list that is STILL empty under `error` is the second case — and it
  // renders as "—", not as three zeros. Zeros are a claim about the
  // session; a dash is a claim about the connection.
  const outage = error && events.length === 0;
  const stale = error && events.length > 0;

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

        {/* Readout is the class breakdown, not a bare row count. "321
            events" invited exactly the reconciliation the operator could
            not do; the three numbers he actually wants are these. */}
        <div style={{
          marginLeft: "auto", fontSize: 11, color: colors.textMuted,
          fontFamily: fonts.sans, textAlign: "right", lineHeight: 1.5,
        }}>
          {loading ? "Loading…" : outage ? "No data — DC API unreachable" : (
            <>
              <div>
                {EVENT_CLASS_ORDER.map((c, i) => (
                  <span key={c}>
                    {i > 0 ? " · " : ""}
                    <span style={{ color: eventClassColor(c), fontWeight: 700 }}>
                      {classCounts[c]}
                    </span>{" "}
                    {eventClassLabel(c).toLowerCase()}
                  </span>
                ))}
              </div>
              {filtersActive && (
                <div style={{ opacity: 0.85 }}>
                  showing {visible.length} of {events.length}
                </div>
              )}
            </>
          )}
        </div>

        {truncated && (
          <div style={{
            flexBasis: "100%", fontSize: 11, color: colors.accentAmber,
            fontFamily: fonts.sans,
          }}>
            Showing the newest {events.length} — older events not loaded. Pick a specific
            date to reach earlier sessions.
          </div>
        )}
      </div>

      {/* THE HEADLINE: the only question this tab needs to answer at a
          glance — should we be in these positions, or not? Everything
          below is the supporting detail, deliberately smaller.
          Three classes, not two: "in" and "should be in" were previously
          collapsed, which reported 14 plays on a record where the daemon
          went to market 112 times. Splitting them keeps the fill count
          honest without burying the 98 that reached the market and never
          crossed. All three render at n=0 — they are the page's headline
          numbers and a missing zero reads as a missing category. A zero is
          a claim about the SESSION though, so during an outage they render
          "—" instead: the operator must not read a dropped poll as a quiet
          day on a product whose whole remaining job is the research
          record. */}
      <div role="group" aria-label="Filter by verdict class"
           style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {EVENT_CLASS_ORDER.map((c) => (
          <ClassTile
            key={c}
            n={outage ? null : classCounts[c]}
            label={eventClassLabel(c)}
            color={eventClassColor(c)}
            title={outage
              ? `${eventClassLabel(c)} — unknown. The DC API did not answer, so this is `
                + `an outage, not a count.`
              : `${eventClassTooltip(c)} Click to filter; click again to clear.`}
            active={classFilter === c}
            onToggle={() => toggleClass(c)}
          />
        ))}
      </div>

      {/* Breakdown — the granularity, kept as metadata rather than the
          headline. Chips are DERIVED from the outcomes present in the
          visible data and merely sorted by OUTCOME_DISPLAY_ORDER, so an
          outcome this build has never seen still gets a chip (grey, generic
          label) instead of vanishing from the summary while its rows sit in
          the table below. That failure mode has already happened twice. */}
      <div role="group" aria-label="Filter by outcome"
           style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {outcomeChips.map((k) => {
          const n = counts[k] ?? 0;
          const color = outcomeColor(k);
          const active = outcomeFilter === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggleOutcome(k)}
              aria-pressed={active}
              title={`${n} × ${labelFor(k)} — counts as ${eventClassLabel(classifyOutcome(k))}. `
                + `Click to filter; click again to clear.`}
              style={outcomeChipStyle(color, active)}
            >
              <span style={{ fontWeight: 700 }}>{n}</span>
              <span style={{ opacity: 0.85 }}>{labelFor(k)}</span>
            </button>
          );
        })}
        {/* Drift rollup chip (R2 follow-up to PR #174 — task #261).
            Appears only when ≥1 entry in the visible session had its
            strikes re-resolved mid-window. Amber to match the per-row
            Drift column color encoding; tooltip explains the meaning.
            Hidden when total drift events == 0 (the common quiet day)
            so the chip row stays uncluttered. Reads `classScoped` — the
            same set the outcome chips beside it summarise — so the whole
            chip row describes one population. It is a rollup, not a
            filter, so it stays a div. */}
        {(() => {
          const driftEvents = classScoped.filter(
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

      {/* Error/empty. Two different sentences, because the two states cost
          the operator different things: `stale` still shows real rows (just
          not this minute's), `outage` shows nothing and every number above
          is a dash. */}
      {error && (
        <div className="panel" style={{ padding: 12, color: colors.accentRed, fontSize: 13 }}>
          {stale
            ? "DC API unreachable — showing the last successful load. Counts above may "
              + "be missing this session's newest events."
            : "Failed to load signal events from the DC API. Nothing below is a "
              + "statement about the session — we could not ask."}
        </div>
      )}

      {/* Table */}
      <div className="panel" style={{ padding: 12 }}>
        <div className="panel-header" style={{ marginBottom: 8 }}>
          <span className="panel-title">Signal Events</span>
        </div>
        {!loading && outage ? (
          /* NOT "No events" — that sentence says the daemon evaluated
             nothing, and on a retired-entry product the difference between
             "quiet session" and "we lost the feed" is the difference
             between walking away and going to look. */
          <div style={{ color: colors.accentRed, fontSize: 13, textAlign: "center", padding: 24 }}>
            Could not reach the DC API — event count unknown for{" "}
            {date === "all" ? "any session" : date}. Retrying every 30s.
          </div>
        ) : !loading && events.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: 13, textAlign: "center", padding: 24 }}>
            No events {date === "all" ? "recorded" : `on ${date}`}.
          </div>
        ) : !loading && visible.length === 0 ? (
          /* Deliberately NOT the copy above. "No events recorded" says the
             daemon did nothing; here it evaluated plenty and the operator's
             own filter hid them. Saying the wrong one of those on a
             retired-entry product is the difference between "quiet day" and
             "the system is dead". */
          <div style={{
            color: colors.textMuted, fontSize: 13, textAlign: "center", padding: 24,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
          }}>
            <div>
              No events match this filter — all {events.length} loaded{" "}
              {events.length === 1 ? "event is" : "events are"} hidden by it.
            </div>
            {/* alignSelf override: chipButtonStyle carries flex-end for the
                horizontal filter row, and in this column-flex empty state
                that pins the panel's ONLY recovery affordance to the far
                right edge, detached from the centred message it belongs to. */}
            <button type="button" onClick={clearFilters}
                    style={{ ...chipButtonStyle(false), alignSelf: "center" }}>
              Clear filters
            </button>
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
                {visible.map((e) => (
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
  // distinction this tab now exists to show. Indigo — the should-be-in
  // class colour — rather than a severity tier, because it isn't one: it
  // is the master switch being off. This is the ONE outcome whose colour
  // is borrowed from the class axis, and it is borrowed on purpose, so the
  // chip that dominates the post-retirement tab ties visibly to the
  // headline tile it feeds. (It was accentBlue; that hex now belongs to
  // the active-chip border and reusing it made a selected chip and this
  // outcome indistinguishable.)
  if (outcome === "blocked_entries_disabled") return colors.accentIndigo;
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
  // `blocked_order` stays RED even though it classifies as should-be-in.
  // The two axes are answering different questions and both answers are
  // true: the play was called (class = should be in) AND the execution
  // failed outright (colour = hard error). Recolouring it to the class
  // tint would erase the 87.5% no-fill rate, which is the single most
  // actionable fact on this tab.
  if (outcome === "blocked_strike" || outcome === "blocked_legs"
      || outcome === "blocked_conn" || outcome === "blocked_data"
      || outcome === "blocked_order") return colors.accentRed;
  return colors.textSecondary;
}

/**
 * The headline tile — one per verdict class, and each one is a filter.
 *
 * A real <button> with `aria-pressed`, not the div it used to be. The old
 * tiles carried `cursor: "help"` and a title tooltip, which read as
 * clickable to the operator and were not; "nothing filters no matter which
 * button i click" is what that costs. Keyboard- and touch-reachable for
 * the same reason: the tooltip was previously the ONLY place the class
 * definitions existed, and title tooltips never surface on touch.
 *
 * `n === null` is the outage state and renders "—", disabled and dimmed.
 * A tile is the loudest thing on the page, so it may only ever show a
 * number it actually knows.
 */
function ClassTile({ n, label, color, title, active, onToggle }: {
  n: number | null; label: string; color: string; title: string;
  active: boolean; onToggle: () => void;
}) {
  const unknown = n === null;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={unknown}
      aria-pressed={active}
      title={title}
      style={{
        display: "inline-flex", alignItems: "baseline", gap: 8,
        padding: "8px 14px", borderRadius: 8, textAlign: "left",
        background: withAlpha(unknown ? colors.textMuted : color, active ? 0.22 : 0.1),
        border: `1px solid ${withAlpha(unknown ? colors.textMuted : color, active ? 0.85 : 0.35)}`,
        color: unknown ? colors.textMuted : color,
        fontFamily: fonts.sans, cursor: unknown ? "default" : "pointer",
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 22, fontFamily: fonts.mono }}>
        {unknown ? "—" : n}
      </span>
      <span style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 }}>
        {label}
      </span>
    </button>
  );
}

export function labelFor(outcome: string): string {
  // The generic transform would render this one as "blk:entries disabled",
  // which reads as a malfunction. It is a policy state, and now the most
  // common row on the tab, so it gets a plain-language label. "entries off"
  // rather than the earlier "not traded": with the class row above now
  // saying SHOULD BE IN, "not traded" answered a question nobody was
  // asking and quietly contradicted the tile. Name the CAUSE — the master
  // switch — and let the class row carry the verdict.
  if (outcome === "blocked_entries_disabled") return "entries off";
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
/**
 * Outcome chip skin. Keeps the established pill look — the drift rollup
 * chip beside it and OutcomeBadge in the table share it, so swapping to
 * `chipButtonStyle`'s flat rectangle would restyle the whole row — and
 * adds the missing active state. Alphas reproduce the old literals
 * (`color + "18"` = 0x18/255 ≈ 0.094, `${color}40` = 0x40/255 = 0.25) via
 * `withAlpha`, which tokens.ts asks new code to prefer.
 */
const outcomeChipStyle = (color: string, active: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "4px 10px", borderRadius: 14, fontSize: 11,
  fontFamily: fonts.sans,
  background: withAlpha(color, active ? 0.28 : 0.094),
  border: `1px solid ${withAlpha(color, active ? 0.85 : 0.25)}`,
  color, cursor: "pointer",
});
const chipButtonStyle = (active: boolean): React.CSSProperties => ({
  background: active ? colors.borderDim : STICKY_HEADER_BG,
  color: active ? colors.textPrimary : colors.textSecondary,
  border: `1px solid ${active ? colors.accentBlue : colors.borderDim}`,
  borderRadius: 4, padding: "5px 10px",
  fontSize: 11, fontFamily: fonts.sans, cursor: "pointer",
  alignSelf: "flex-end",
});
