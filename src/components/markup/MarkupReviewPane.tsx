/**
 * MarkupReviewPane — post-close review of a session's markup alerts on an SPX
 * candle chart. The discrimination instrument: filter/highlight alerts by
 * direction, σ band, distance-from-ATM, and exclude pending, then read the
 * subset's hit-rate / MFE / heat to hunt the feature that separates winners from
 * duds (the live recorder's reason for being).
 *
 * Reads `/terminal/v1/markup/review?date=` — once for a finalized (past)
 * session, re-polled every 60s while the selected date is TODAY, because only
 * the authoritative IBKR bars can repair a live candle the spot stream missed
 * for longer than its window. The response's bars are 1-minute whatever `tf` is
 * requested, so the timeframe toggle is a purely client-side display grid (see
 * lib/tfBuckets) and never a round-trip.
 * The chart is lazy-loaded so lightweight-charts only ships on this route.
 */

import { Suspense, lazy, useMemo, useState } from "react";
import { RouteNav } from "../nav/RouteNav";
import { MarkupPanel } from "../straddle/MarkupPanel";
import { useLiveMarkup } from "../../hooks/useLiveMarkup";
import { useMarkupReview } from "../../hooks/useMarkupReview";
import {
  DEFAULT_FILTERS,
  etDateString,
  filterAlerts,
  fromInputDate,
  passesFilters,
  shiftSessionDate,
  subsetStats,
  toInputDate,
  type AlertFilters,
} from "./markupReviewHelpers";
import {
  liveAlertToReview,
  liveSessionCandles,
} from "../../hooks/liveMarkupHelpers";
import type { Timeframe } from "../../lib/tfBuckets";

import "./MarkupReviewPane.css";

const MarkupReviewChart = lazy(() =>
  import("./MarkupReviewChart").then((m) => ({ default: m.MarkupReviewChart })),
);

const pct = (v: number | null): string =>
  v == null ? "—" : `${Math.round(v * 100)}%`;
const pt = (v: number | null): string =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`;

const DIST_OPTIONS: { label: string; value: number | null }[] = [
  { label: "any", value: null },
  { label: "ATM (0)", value: 0 },
  { label: "≤±5", value: 5 },
  { label: "≤±10", value: 10 },
];

export function MarkupReviewPane() {
  const [date, setDate] = useState<string>(() => etDateString());
  const [tf, setTf] = useState<Timeframe>("1m");
  const [filters, setFilters] = useState<AlertFilters>(DEFAULT_FILTERS);
  const [refitToken, setRefitToken] = useState(0);

  // The ET-date call lives HERE, not in the hook: `etDateString` is a
  // components/ helper and hooks/ must not reach into it. Viewing today puts the
  // review hook into background re-poll — the authoritative repair for a live
  // candle the spot stream missed for longer than its window.
  const isToday = date === etDateString();

  // `tf` is NOT passed: the timeframe is a client-side display grid, and making
  // it a fetch key would unmount the chart on every toggle (see useMarkupReview).
  const { data, loading, offline, stale, refresh } = useMarkupReview(
    date,
    isToday,
  );
  // Live SSE markup (push). Null off-hours/cold/offline → the live section
  // hides and only the post-close review below shows.
  const { markup: live, connected } = useLiveMarkup();

  const filtered = useMemo(
    () => (data ? filterAlerts(data.alerts, filters) : []),
    [data, filters],
  );
  const stats = useMemo(() => subsetStats(filtered), [filtered]);

  // The chart arrows are CAUSAL — every fired strike is a real signal, so the
  // post-fire `status` lifecycle (pending/lost) must NOT scope them, or it would
  // shrink the at-fire ladder breadth that drives conviction (a 4-strike bar with
  // one pending strike must still read as breadth 4). Feed the chart all statuses;
  // only the stats rollup above honors the includePending toggle.
  const chartFiltered = useMemo(
    () =>
      data ? filterAlerts(data.alerts, { ...filters, includePending: true }) : [],
    [data, filters],
  );

  // Live overlay (today only): the spot window's 1-min candles from the SSE
  // stream, and live alerts (mapped to the review shape, filtered + deduped
  // against the fetched alerts) merged into the chart's markers.
  const liveBars = useMemo(() => {
    if (!isToday || !live?.spot_series) return [];
    return liveSessionCandles(live.spot_series, tf);
  }, [isToday, live, tf]);
  const chartAlerts = useMemo(() => {
    if (!isToday || !live) return chartFiltered;
    const seen = new Set(chartFiltered.map((a) => a.alert_ts));
    const liveAlerts = live.recent_alerts
      .map((a) => liveAlertToReview(a, live.center_atm))
      .filter(
        (a) =>
          passesFilters(a, { ...filters, includePending: true }) &&
          !seen.has(a.alert_ts),
      );
    return [...chartFiltered, ...liveAlerts];
  }, [isToday, live, chartFiltered, filters]);

  // σ-slider span follows the session's actual σ range (the detector's σ is
  // unbounded above), so a high-σ blowout is always reachable by the filter
  // — a fixed max would silently cap the range below real values.
  const sliderMaxZ = useMemo(() => {
    const zs = (data?.alerts ?? []).map((a) => a.spread_z ?? 0);
    return Math.max(20, Math.ceil(zs.length ? Math.max(...zs) : 0));
  }, [data]);

  const hasSession = !!data && (data.bars.length > 0 || data.alerts.length > 0);
  const emptyAlerts = !!data && data.alerts.length === 0;
  const setF = (patch: Partial<AlertFilters>) =>
    setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="markup-review">
      <RouteNav current="markup" />

      <header className="markup-review__head">
        <div className="markup-review__title">
          <h1>Markup Review</h1>
          <span className="markup-review__sub">
            SPX candles + alert markers · post-close
          </span>
        </div>
        <div className="markup-review__controls">
          <button
            className="markup-review__nav"
            onClick={() => setDate((d) => shiftSessionDate(d, -1))}
            aria-label="Previous session"
            title="Previous session"
          >
            ‹
          </button>
          <input
            type="date"
            className="markup-review__date"
            value={toInputDate(date)}
            max={toInputDate(etDateString())}
            onChange={(e) => setDate(fromInputDate(e.target.value))}
          />
          <button
            className="markup-review__nav"
            onClick={() => setDate((d) => shiftSessionDate(d, 1))}
            disabled={date >= etDateString()}
            aria-label="Next session"
            title="Next session"
          >
            ›
          </button>
          <div className="markup-review__seg">
            {(["1m", "5m"] as const satisfies readonly Timeframe[]).map((t) => (
              <button
                key={t}
                className={t === tf ? "is-active" : ""}
                onClick={() => setTf(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            className="markup-review__refresh"
            onClick={() => {
              // ↻ no longer flashes the loading state, so it no longer remounts
              // the chart — and the remount was what re-fitted the time scale.
              // Bump the refit token so an explicit refresh still returns a
              // session that has outgrown its zoom to a fitted view.
              setRefitToken((n) => n + 1);
              refresh();
            }}
          >
            ↻
          </button>
        </div>
      </header>

      <div className="markup-review__filters">
        <label>
          dir
          <select
            value={filters.direction}
            onChange={(e) =>
              setF({ direction: e.target.value as AlertFilters["direction"] })
            }
          >
            <option value="all">all</option>
            <option value="up">call ▲</option>
            <option value="down">put ▼</option>
          </select>
        </label>
        <label>
          σ ≥ {filters.minZ}
          <input
            type="range"
            min={0}
            max={sliderMaxZ}
            step={1}
            value={Math.min(filters.minZ, sliderMaxZ)}
            onChange={(e) => setF({ minZ: Number(e.target.value) })}
          />
        </label>
        <label>
          ATM-dist
          <select
            value={String(filters.maxDist)}
            onChange={(e) =>
              setF({
                maxDist:
                  e.target.value === "null" ? null : Number(e.target.value),
              })
            }
          >
            {DIST_OPTIONS.map((o) => (
              <option key={o.label} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="markup-review__chk">
          <input
            type="checkbox"
            checked={filters.includePending}
            onChange={(e) => setF({ includePending: e.target.checked })}
          />
          incl. pending (stats)
        </label>
      </div>

      <div className="markup-review__stats">
        <span>
          <b>{stats.n}</b> shown
        </span>
        <span>
          <b>{stats.finalized}</b> finalized
        </span>
        <span>
          MFE≥5 <b>{pct(stats.mfeGe5)}</b>
        </span>
        <span>
          ≥10 <b>{pct(stats.mfeGe10)}</b>
        </span>
        <span>
          med MFE <b>{pt(stats.medianMfe)}</b>
        </span>
        <span>
          med heat <b>{pt(stats.medianMae)}</b>
        </span>
        <span>
          t→peak <b>{stats.medianTMfe == null ? "—" : `${Math.round(stats.medianTMfe)}s`}</b>
        </span>
        <span>
          dirHit <b>{pct(stats.dirHit)}</b>
        </span>
        {emptyAlerts && (
          <span className="markup-review__note">
            no markup alerts recorded this session
          </span>
        )}
        {data && data.pending_count > 0 && (
          <span className="markup-review__pending">
            {data.pending_count} still accruing
          </span>
        )}
        {data?.bars_stale && (
          <span className="markup-review__stale">bars stale</span>
        )}
        {/* A failed background poll keeps the rendered session on screen (see
            settleReview) — say so here rather than replacing the chart with the
            offline message, which would unmount it and cost the operator's
            pan/zoom and the live tail. */}
        {stale && <span className="markup-review__stale">refresh failed</span>}
      </div>

      <div className="markup-review__body">
        {loading ? (
          <div className="markup-review__msg">Loading session…</div>
        ) : offline ? (
          <div className="markup-review__msg">
            Markup Review API offline or unauthorized.
          </div>
        ) : !hasSession ? (
          <div className="markup-review__msg">
            No data captured for {date}. Pick another session — the recorder
            accrues forward, so recent trading days fill in.
          </div>
        ) : (
          <Suspense
            fallback={<div className="markup-review__msg">Loading chart…</div>}
          >
            <MarkupReviewChart
              bars={data!.bars}
              alerts={chartAlerts}
              liveBars={liveBars}
              tf={tf}
              fitKey={`${date}|${tf}`}
              refitToken={refitToken}
            />
          </Suspense>
        )}
      </div>

      {/* Live Markup Tell — ancillary, below the (now-live) candle chart. */}
      {live && (
        <section className="markup-live" aria-label="Live markup tell">
          <header className="markup-live__head">
            <span
              className={`markup-live__dot${connected ? " is-on" : ""}`}
              aria-hidden="true"
            />
            <span className="markup-live__label">LIVE · MARKUP TELL</span>
            {live.center_atm != null && (
              <span className="markup-live__meta">center {live.center_atm}</span>
            )}
          </header>
          <MarkupPanel markup={live} />
        </section>
      )}
    </div>
  );
}
