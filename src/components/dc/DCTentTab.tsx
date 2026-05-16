/**
 * DCTentTab — dedicated tent view (PR 7).
 *
 * Two stacked sections:
 *
 *   TOP: small-multiples grid of OPEN positions.
 *     Each card carries a compact `TentChart` (height ~200) +
 *     header strip (strategy name, days-in-trade, breakevens).
 *     Clicking the card opens the full TentChartModal — same one
 *     PR 6 wired to the Positions tab.
 *
 *   BOTTOM: closed-trade explorer.
 *     A trade row list with a date filter; clicking a row opens
 *     the through-expiry TentChartModal (trade endpoint —
 *     iv_source=entry only since trade_history doesn't carry
 *     position_uid for the greek_snapshots join).
 *
 * Loads its own tent payloads via `useTentSmallMultiples` (parallel
 * fetch across all open positions on tab-mount + 60s refresh).
 * Empty-state handling: zero open positions → friendly message;
 * zero closed trades in the selected window → "no trades in this
 * range".
 */

import { useEffect, useMemo, useState } from "react";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import { dcApi } from "../../api/dcClient";
import type {
  DCPhantomPosition,
  DCPosition,
  DCTentResponse,
  DCTrade,
} from "../../api/dcTypes";
import { TentChart } from "./TentChart";
import { TentChartModal, type TentTarget } from "./TentChartModal";
import { filterTradesByDays, isTentRenderable } from "./dcTentTab.helpers";


interface Props {
  positions: DCPosition[];
  trades: DCTrade[];
  phantoms: DCPhantomPosition[];
  phantomsLoaded: boolean;
}


export function DCTentTab({ positions, trades, phantoms, phantomsLoaded }: Props) {
  const [modalTarget, setModalTarget] = useState<{
    target: TentTarget;
    title: string;
  } | null>(null);

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <OpenPositionsGrid
        positions={positions}
        onOpen={(p) =>
          setModalTarget({
            target: { kind: "position", positionUid: p.position_uid! },
            title: p.strategy_name,
          })
        }
      />
      <MissedEntriesPanel
        phantoms={phantoms}
        loaded={phantomsLoaded}
        onOpen={(ph) =>
          setModalTarget({
            target: { kind: "phantom", positionUid: ph.position_uid },
            title: `${ph.strategy_name} (missed ${ph.entry_date})`,
          })
        }
      />
      <ClosedTradesPanel
        trades={trades}
        onOpen={(t) =>
          setModalTarget({
            target: { kind: "trade", tradeId: t.id },
            title: `${t.strategy_name} (closed ${t.close_date?.slice(0, 10) ?? "?"})`,
          })
        }
      />
      {modalTarget && (
        <TentChartModal
          target={modalTarget.target}
          title={modalTarget.title}
          onClose={() => setModalTarget(null)}
        />
      )}
    </div>
  );
}


// ── Open positions: small-multiples grid ─────────────────────────


function OpenPositionsGrid({
  positions,
  onOpen,
}: {
  positions: DCPosition[];
  onOpen: (p: DCPosition) => void;
}) {
  // Only positions with a position_uid can be tent'd. Legacy rows
  // from before PR 2's schema land are silently excluded — the grid
  // showing only the renderable subset is clearer than rendering
  // empty cells.
  const renderable = useMemo(
    () => positions.filter(
      (p) => p.position_uid != null && p.position_uid !== "",
    ),
    [positions],
  );

  const tents = useTentSmallMultiples(renderable);

  return (
    <div className="panel" style={{ padding: 12 }}>
      <div className="panel-header" style={{ marginBottom: 8 }}>
        <span className="panel-title">
          Through-expiry payoff — open positions ({renderable.length})
        </span>
      </div>
      <div style={{
        fontSize: 11,
        color: colors.textMuted,
        fontFamily: fonts.sans,
        marginBottom: 8,
        lineHeight: 1.4,
      }}>
        DC payoff projections across SPX, sampled at the current
        time-to-expiry. Click any card for the full chart with the
        live-IV curve, breakevens, current SPX, and (when an entry-IV
        anchor exists) a frozen-IV overlay for drift comparison.
      </div>
      {renderable.length === 0 ? (
        <div style={emptyStyle}>
          No open positions to chart. New entries will appear here as
          the daemon opens them.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 12,
          }}
        >
          {renderable.map((p) => (
            <PositionTentCard
              key={p.id}
              position={p}
              tent={tents[p.position_uid!] ?? null}
              onClick={() => onOpen(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}


function PositionTentCard({
  position: p,
  tent,
  onClick,
}: {
  position: DCPosition;
  tent: DCTentResponse | null;
  onClick: () => void;
}) {
  const isPhantom = tent?.phantom === true;
  return (
    <button
      onClick={onClick}
      aria-label={`Open tent chart for ${p.strategy_name}`}
      style={{
        textAlign: "left",
        background: colors.bgPanel,
        border: isPhantom
          ? `2px dashed ${colors.accentAmber}`
          : `1px solid ${colors.borderDim}`,
        borderRadius: 6,
        padding: "10px 12px",
        cursor: "pointer",
        fontFamily: fonts.sans,
        color: colors.textPrimary,
        // Subtle hover: the cards are click-to-expand, so a small
        // surface cue helps without dominating the chart inside.
        transition: "background 80ms, border-color 80ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = colors.borderBright;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = isPhantom
          ? colors.accentAmber
          : colors.borderDim;
      }}
    >
      {/* Header strip */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.textBright }}>
          {p.strategy_name}
        </div>
        <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.mono }}>
          {tent ? `${tent.days_in_trade.toFixed(1)}d in` : "loading…"}
        </div>
      </div>
      {/* Compact tent */}
      <TentChart frozenCurve={tent} height={180} compact />
      {/* Footer: strikes + breakevens */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          fontFamily: fonts.mono,
          color: colors.textSecondary,
          marginTop: 4,
        }}
      >
        <span>
          {p.put_strike}P / {p.call_strike}C
        </span>
        <span>
          BE{" "}
          {tent?.breakeven_low?.toFixed(0) ?? "—"} /{" "}
          {tent?.breakeven_high?.toFixed(0) ?? "—"}
        </span>
      </div>
    </button>
  );
}


// ── Alpha-tracking dashboard for phantom (would-have-entered) plays ──


/**
 * The Tent tab is operator-facing alpha research. This panel surfaces
 * plays the daemon recorded but couldn't fill at the broker — strikes
 * the strategy resolved, sized, gated, and submitted to the ladder,
 * where the broker side failed (no cross / parked-no-fill exhausted).
 *
 * Framing is deliberately neutral. These are NOT "misses" to be flagged;
 * they're additional alpha exposure the operator can study alongside
 * real entries. The through-expiry tent renders identically to a real
 * position so the analysis surface is the same.
 *
 * Each card opens the through-expiry phantom-tent modal (live + frozen
 * IV overlays, same as a real position). The block_category badge tells
 * the operator at a glance HOW the fill failed (LADDER exhausted vs
 * PARKED with no cross vs OTHER).
 */
function MissedEntriesPanel({
  phantoms,
  loaded,
  onOpen,
}: {
  phantoms: DCPhantomPosition[];
  loaded: boolean;
  onOpen: (ph: DCPhantomPosition) => void;
}) {
  const [days, setDays] = useState(30);

  const filtered = useMemo(() => {
    if (days === 0) return phantoms;
    // Date filter must be ET-anchored: backend `entry_date` is written
    // from the daemon's ET wall-clock at entry time, and a PT trader
    // at 9pm PT (= midnight ET) selecting "30d" must see today's ET-
    // dated phantom. Naive `new Date().setDate(-N) → toISOString()` is
    // a UTC/local hybrid that drops boundary days. Mirror the pattern
    // used in DCEventsTab.tsx:todayET().
    const cutoffInstant = new Date();
    cutoffInstant.setDate(cutoffInstant.getDate() - days);
    const iso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
    }).format(cutoffInstant);
    return phantoms.filter((p) => p.entry_date >= iso);
  }, [phantoms, days]);

  return (
    <div className="panel" style={{ padding: 12 }}>
      <div
        className="panel-header"
        style={{
          marginBottom: 8,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span className="panel-title">
          Alpha plays — recorded entries the bot didn&rsquo;t fill (
          {loaded ? filtered.length : "—"})
        </span>
        <DateRangePicker value={days} onChange={setDays} />
      </div>
      <div style={{
        fontSize: 11,
        color: colors.textMuted,
        fontFamily: fonts.sans,
        marginBottom: 8,
        lineHeight: 1.4,
      }}>
        Real strikes the daemon resolved, sized, and submitted to the
        broker — fill failed (ladder exhausted or parked-at-ask with no
        cross), so no position was held. Additional plays to study; the
        through-expiry tent renders the same as a real entry. Click a
        row to analyze.
      </div>
      {/* Loading vs empty: until the first slow-tier poll settles,
          show a loading placeholder rather than "No missed entries" —
          the latter would re-create the perception bug this PR fixes
          ("looks like nothing's tracked"). */}
      {!loaded ? (
        <div style={emptyStyle}>Loading recorded plays…</div>
      ) : filtered.length === 0 ? (
        <div style={emptyStyle}>
          {days > 0
            ? `No unfilled plays in the last ${days} day${days === 1 ? "" : "s"}.`
            : "No broker no-fills recorded yet."}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 8,
            maxHeight: "max(240px, calc(100vh - 400px))",
            overflowY: "auto",
          }}
        >
          {filtered.map((ph) => (
            <PhantomChip key={ph.id} phantom={ph} onClick={() => onOpen(ph)} />
          ))}
        </div>
      )}
    </div>
  );
}


/**
 * Format YYYYMMDD (the backend expiry format) as "May 21".
 * Falls back to the raw string when the format doesn't match.
 */
function formatExpiry(yyyymmdd: string): string {
  if (!/^\d{8}$/.test(yyyymmdd)) return yyyymmdd;
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6)) - 1;
  const d = Number(yyyymmdd.slice(6, 8));
  return new Date(y, m, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}


/**
 * Days between an ISO YYYY-MM-DD date and today (ET). Positive means
 * the date is in the past. Used for the "Xd ago" affordance — operators
 * need a quick at-a-glance "is this miss still relevant?" cue.
 */
function daysAgoET(isoDate: string): number {
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
  // YYYY-MM-DD lexicographic subtraction won't work — actual day delta
  // needs Date math. Pin both to UTC midnight to skirt DST entirely.
  const a = new Date(`${isoDate}T00:00:00Z`);
  const b = new Date(`${todayIso}T00:00:00Z`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}


function PhantomChip({
  phantom,
  onClick,
}: {
  phantom: DCPhantomPosition;
  onClick: () => void;
}) {
  // Block category drives a small colored pill so the failure mode is
  // visible at-a-glance without opening the modal. Falls back to "UNK"
  // when the category is null — "MISS" reads too much like a positive-
  // event term in trading slang.
  const categoryLabel = (() => {
    switch (phantom.block_category) {
      case "ladder_exhausted": return "LADDER";
      case "parked_no_fill": return "PARKED";
      case "other": return "OTHER";
      default: return "UNK";
    }
  })();
  const daysAgo = daysAgoET(phantom.entry_date);
  return (
    <button
      onClick={onClick}
      aria-label={`Open through-expiry tent for ${phantom.strategy_name} no-fill play on ${phantom.entry_date}`}
      style={{
        textAlign: "left",
        background: colors.bgInset,
        // Dashed neutral-border + amber pill: the dashed stroke alone
        // carries the "phantom / not held" semantic, so reserving the
        // amber accent for the LADDER/PARKED pill (failure-mode
        // information) keeps the dashboard's existing amber-as-warning
        // vocabulary cleaner. PositionTentCard's dashed-amber is rare
        // (only fires when an open position's tent reads phantom=true);
        // this panel renders a whole grid of cards and shouldn't read
        // as a wall of amber warnings.
        border: `1px dashed ${colors.borderBright}`,
        borderRadius: 4,
        padding: "8px 10px",
        cursor: "pointer",
        fontFamily: fonts.sans,
        color: colors.textPrimary,
        fontSize: 11,
      }}
    >
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 2,
        alignItems: "center",
      }}>
        <span style={{ fontWeight: 600, color: colors.textBright }}>
          {phantom.strategy_name}
        </span>
        <span style={{
          fontSize: 9,
          fontFamily: fonts.mono,
          color: colors.accentAmber,
          background: withAlpha(colors.accentAmber, 0.12),
          border: `1px solid ${withAlpha(colors.accentAmber, 0.4)}`,
          borderRadius: 2,
          padding: "1px 5px",
          letterSpacing: 0.5,
        }}>
          {categoryLabel}
        </span>
      </div>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        color: colors.textMuted,
        fontFamily: fonts.mono,
      }}>
        <span>{phantom.put_strike}P / {phantom.call_strike}C</span>
        <span>
          {phantom.entry_date}
          {daysAgo > 0 ? ` · ${daysAgo}d ago` : " · today"}
        </span>
      </div>
      <div style={{
        color: colors.textSecondary,
        fontFamily: fonts.mono,
        fontSize: 10,
        marginTop: 2,
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
      }}>
        <span>
          intended ${phantom.intended_debit.toFixed(2)} × {phantom.intended_quantity}
        </span>
        <span>
          {formatExpiry(phantom.front_exp)} / {formatExpiry(phantom.back_exp)}
        </span>
      </div>
      {/* "NOT HELD · alpha track" watermark — cements that this is
          analysis-only, not a real position, so a screenshot or quick
          glance can't misread the card. "alpha track" frames the panel
          as additional study material rather than a failure log. */}
      <div style={{
        marginTop: 4,
        fontSize: 9,
        fontFamily: fonts.mono,
        color: colors.textMuted,
        letterSpacing: 0.8,
        textTransform: "uppercase",
      }}>
        NOT HELD · alpha track
      </div>
    </button>
  );
}


// ── Closed trades: filterable explorer ───────────────────────────


function ClosedTradesPanel({
  trades,
  onOpen,
}: {
  trades: DCTrade[];
  onOpen: (t: DCTrade) => void;
}) {
  // Date-range state. Default window: last 30 days. The selector
  // operates on close_date (when the trade actually closed); through-
  // expiry rendering is driven by the trade's front/back_exp on the
  // server side.
  const [days, setDays] = useState(30);

  const filtered = useMemo(() => filterTradesByDays(trades, days), [trades, days]);

  // Filter to trades that can actually render a tent (need strikes
  // + expiries). Legacy rows missing those are excluded.
  const renderable = useMemo(
    () => filtered.filter(isTentRenderable),
    [filtered],
  );

  return (
    <div className="panel" style={{ padding: 12 }}>
      <div
        className="panel-header"
        style={{
          marginBottom: 8,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span className="panel-title">
          Closed trades — through-expiry view ({renderable.length})
        </span>
        <DateRangePicker value={days} onChange={setDays} />
      </div>
      {renderable.length === 0 ? (
        <div style={emptyStyle}>
          {days > 0
            ? `No closed trades in the last ${days} day${days === 1 ? "" : "s"}.`
            : "No closed trades on record."}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 8,
            // R2#2 round-1 fix: floor the calc so the grid doesn't
            // collapse to a few pixels on small viewports
            // (tablet/phone-landscape, or desktops with the armed/
            // offline banner stack pushing real available height
            // below 400px).
            maxHeight: "max(240px, calc(100vh - 400px))",
            overflowY: "auto",
          }}
        >
          {renderable.map((t) => (
            <ClosedTradeChip key={t.id} trade={t} onClick={() => onOpen(t)} />
          ))}
        </div>
      )}
    </div>
  );
}


function ClosedTradeChip({
  trade,
  onClick,
}: {
  trade: DCTrade;
  onClick: () => void;
}) {
  const win = trade.result === "win";
  const accent = trade.result == null
    ? colors.textMuted
    : win
      ? colors.accentGreen
      : colors.accentRed;
  return (
    <button
      onClick={onClick}
      aria-label={`Open through-expiry tent for ${trade.strategy_name}`}
      style={{
        textAlign: "left",
        background: colors.bgInset,
        border: `1px solid ${colors.borderDim}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 4,
        padding: "8px 10px",
        cursor: "pointer",
        fontFamily: fonts.sans,
        color: colors.textPrimary,
        fontSize: 11,
      }}
    >
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 2,
      }}>
        <span style={{ fontWeight: 600, color: colors.textBright }}>
          {trade.strategy_name}
        </span>
        {trade.pnl != null && (
          <span style={{ color: accent, fontFamily: fonts.mono }}>
            ${trade.pnl >= 0 ? "+" : ""}{trade.pnl.toFixed(0)}
          </span>
        )}
      </div>
      <div style={{ color: colors.textMuted, fontFamily: fonts.mono }}>
        {trade.close_date?.slice(0, 10) ?? "—"} ·{" "}
        {trade.put_strike}P / {trade.call_strike}C
      </div>
    </button>
  );
}


function DateRangePicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: number) => void;
}) {
  const options = [
    { days: 7, label: "7d" },
    { days: 30, label: "30d" },
    { days: 90, label: "90d" },
    { days: 0, label: "All" },
  ];
  return (
    <div role="group" aria-label="Date range" style={{ display: "flex", gap: 4 }}>
      {options.map((o) => (
        <button
          key={o.days}
          onClick={() => onChange(o.days)}
          aria-pressed={value === o.days}
          style={{
            fontSize: 11,
            padding: "3px 10px",
            background: value === o.days
              ? withAlpha(colors.accentBlue, 0.2)
              : "transparent",
            color: value === o.days ? colors.accentBlue : colors.textSecondary,
            border: `1px solid ${
              value === o.days
                ? withAlpha(colors.accentBlue, 0.5)
                : colors.borderDim
            }`,
            borderRadius: 3,
            cursor: "pointer",
            fontFamily: fonts.sans,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}


// ── Data: parallel tent fetch for small-multiples ────────────────


/**
 * Fetch frozen-IV tents in parallel for every position UID, refresh
 * on a 60s tick (matches the rest of the dashboard's poll cadence).
 * Returns `{ [uid]: DCTentResponse | null }` — null means the fetch
 * failed or returned no data, the card shows its placeholder state.
 *
 * Each refresh runs against the CURRENT positions snapshot, not a
 * stale closure — `positions` is the effect dependency.
 */
function useTentSmallMultiples(
  positions: DCPosition[],
): Record<string, DCTentResponse | null> {
  const [tents, setTents] = useState<Record<string, DCTentResponse | null>>({});

  // Derive a sorted uids array + a stable string key from positions.
  // useMemo on `[positions]` is unavoidable here — `positions` is a
  // fresh array reference every parent re-render (useDCData polls at
  // 30s and yields a new identity each tick). The memo collapses
  // those identity changes into a content-equal key.
  const { uids, uidKey } = useMemo(() => {
    const list = positions
      .map((p) => p.position_uid)
      .filter((u): u is string => u != null && u !== "")
      .sort();
    return { uids: list, uidKey: list.join("|") };
  }, [positions]);

  // R1#1 round-1 fix: depend ONLY on `uidKey` (not `positions`). The
  // effect closes over `uids` from the useMemo above, which is itself
  // memoized on `positions` — so when the uid set CONTENT changes
  // (a position opens or closes), uidKey changes and the effect
  // re-runs with fresh `uids`. When `positions` re-renders with the
  // same uid set (parent's 30s poll), uidKey is unchanged and the
  // effect skips re-running. Without this, the effect would tear
  // down its 60s interval and re-fire on every parent poll, doubling
  // the network footprint with no observability gain.
  useEffect(() => {
    if (uids.length === 0) {
      // Clear any stale tents from a prior non-empty state so a
      // future N → 0 → N transition doesn't briefly show old data.
      setTents({});
      return;
    }

    let cancelled = false;

    async function refresh() {
      const results = await Promise.allSettled(
        uids.map((uid) => dcApi.positionTent(uid, { ivSource: "latest" })),
      );
      if (cancelled) return;
      const next: Record<string, DCTentResponse | null> = {};
      uids.forEach((uid, i) => {
        const r = results[i];
        next[uid] = r.status === "fulfilled" ? r.value : null;
      });
      setTents(next);
    }
    refresh();

    const interval = setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uidKey]);

  return tents;
}


const emptyStyle: React.CSSProperties = {
  color: colors.textMuted,
  fontSize: 13,
  textAlign: "center",
  padding: 24,
  fontFamily: fonts.sans,
};
