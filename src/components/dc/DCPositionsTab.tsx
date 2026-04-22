import type {
  DCBrokerOrder,
  DCBrokerPosition,
  DCBrokerState,
  DCPosition,
  DCRiskStatus,
} from "../../api/dcTypes";
import {
  type BrokerDcGroup,
  brokerDebitPerSpread,
  groupBrokerLegs,
} from "../../lib/brokerGrouping";
import { SignalBadge } from "./SignalBadge";
import { tableStyle, thStyle, tdStyle, tdMono } from "./tableStyles";

interface Props {
  positions: DCPosition[];
  risk: DCRiskStatus | null;
  brokerState: DCBrokerState | null;
}

export function DCPositionsTab({ positions, risk, brokerState }: Props) {
  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Risk status cards */}
      {risk && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
          <RiskCard
            label="Daily P&L"
            value={`$${risk.daily_pnl >= 0 ? "+" : ""}${risk.daily_pnl.toFixed(0)}`}
            color={risk.daily_pnl >= 0 ? "#10b981" : "#ef4444"}
          />
          <RiskCard label="Trades Today" value={`${risk.daily_trades}`} />
          <RiskCard label="Wins / Losses" value={`${risk.daily_wins}W / ${risk.daily_losses}L`} />
          <RiskCard
            label="Status"
            value={risk.paused ? "PAUSED" : "ACTIVE"}
            color={risk.paused ? "#f59e0b" : "#10b981"}
          />
        </div>
      )}

      {/* Broker-reality panel. Shows what IBKR reports right now —
          independent of the daemon's SQLite view below — so the
          operator can reconcile without logging in and contending for
          the session. Only SPX-universe positions are included
          (symbol='SPX', covering SPX monthly + SPXW dailies + BAG
          combos). Non-SPX holdings in the paper account (e.g. BULL)
          are filtered server-side. */}
      <BrokerRealityPanel brokerState={brokerState} daemonPositions={positions} />

      {/* Open positions table */}
      <div className="panel" style={{ padding: 12 }}>
        <div className="panel-header" style={{ marginBottom: 8 }}>
          <span className="panel-title">Daemon Tracked Positions ({positions.length})</span>
        </div>
        {positions.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: 24 }}>
            No open positions
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle} aria-label="Daemon-tracked positions">
              <thead>
                <tr>
                  <th style={thStyle}>Strategy</th>
                  <th style={thStyle}>Signal</th>
                  <th style={thStyle}>Entry</th>
                  <th style={thStyle}>Put K</th>
                  <th style={thStyle}>Call K</th>
                  <th style={thStyle}>Front Exp</th>
                  <th style={thStyle}>Back Exp</th>
                  <th style={thStyle}>Debit</th>
                  <th style={thStyle}>Broker Δ</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>SPX@Entry</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.id}>
                    <td style={tdStyle}>{p.strategy_name}</td>
                    <td style={tdStyle}><SignalBadge signal={p.signal} /></td>
                    <td style={tdStyle}>{formatTime(p.entry_time)}</td>
                    <td style={tdMono}>{p.put_strike}</td>
                    <td style={tdMono}>{p.call_strike}</td>
                    <td style={tdStyle}>{p.front_exp}</td>
                    <td style={tdStyle}>{p.back_exp}</td>
                    <td style={tdMono}>${p.entry_debit.toFixed(2)}</td>
                    <td style={driftCellStyle(p.debit_drift)}
                        title={driftTooltip(p)}>
                      {formatDrift(p.debit_drift)}
                    </td>
                    <td style={tdMono}>{p.quantity}</td>
                    <td style={tdMono}>{p.spx_at_entry?.toFixed(2) ?? "—"}</td>
                    <td style={tdStyle}>{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function RiskCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      background: "#111827", border: "1px solid #1e293b", borderRadius: 6, padding: "10px 12px",
    }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: "Inter, sans-serif", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{
        fontSize: 16, fontWeight: 700, fontFamily: "JetBrains Mono, monospace",
        color: color ?? "#e2e8f0", marginTop: 2,
      }}>
        {value}
      </div>
    </div>
  );
}

// Drift thresholds per spread. IBKR's avg_cost folds in commissions
// and exchange fees — IBKR option commission is ~$0.65/contract × 4
// legs ≈ $2.60 per spread of baseline commission, which on a 30-lot
// is ~$0.03/share before any exchange/regulatory fee. So cents-scale
// drift is expected noise on every position; only dime-and-up drift
// is an interesting signal (manual intervention, bookkeeping bug,
// or a ladder blend that didn't match the broker's actual fills).
// Thresholds may be re-tuned after a few weeks of live data — the
// right answer depends on observed spread of commission accounting.
const DRIFT_WARN = 0.05;
const DRIFT_ERROR = 0.15;

// Null predicate: all three helpers agree on the same nullish check
// (`d == null`). Backend always sets broker_entry_debit + debit_drift
// together; checking just one would catch any accidental desync between
// the two fields, but callers should never hit that state.
function isDriftUnset(d: number | null | undefined): boolean {
  return d == null;
}

function formatDrift(d: number | null): string {
  if (isDriftUnset(d)) return "—";
  // ASCII hyphen-minus (not U+2212): keeps UI strings grep-friendly
  // with terminal commands and CI text searches.
  const sign = d! >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(d!).toFixed(3)}`;
}

function driftCellStyle(d: number | null): React.CSSProperties {
  const base = tdMono;
  if (isDriftUnset(d)) return { ...base, color: "#64748b" };
  const mag = Math.abs(d!);
  if (mag < DRIFT_WARN) return { ...base, color: "#10b981" };    // green
  if (mag < DRIFT_ERROR) return { ...base, color: "#f59e0b" };   // amber
  return { ...base, color: "#ef4444" };                          // red
}

function driftTooltip(p: DCPosition): string {
  if (isDriftUnset(p.debit_drift)) {
    // Backend emits `drift_reason` to distinguish the two null-drift
    // cases. Permanent (legacy row) vs transient/investigate-worthy
    // (unmatched snapshot) read very differently to an operator, so
    // we spell each out rather than give the old catch-all.
    switch (p.drift_reason) {
      case "legacy":
        return "Not reconciled — this position predates conid " +
          "tracking (the daemon row was created before the four " +
          "conid fields were captured). No broker-side join is " +
          "possible; this is permanent for legacy rows.";
      case "unmatched":
        return "Not reconciled — daemon conids are populated but " +
          "at least one leg is missing from the latest broker-state " +
          "snapshot. Usually transient (snapshot stale, mid-rotation), " +
          "but a persistent unmatched signals real drift — investigate.";
      case null:
      case undefined:
        // Null/missing + drift unset: backend didn't run
        // reconciliation (sidecar missing, daemon newly started),
        // or frontend is hitting a pre-drift_reason backend build
        // where the field arrives as undefined.
        return "Not reconciled — broker-state sidecar is not " +
          "available yet; the daemon writes a fresh snapshot every " +
          "minute during RTH.";
      default: {
        // Future backend enum value this frontend doesn't know about —
        // fall back gracefully but surface a console warning so
        // protocol skew is visible before a user reports confusion.
        const unknown: never = p.drift_reason;
        // eslint-disable-next-line no-console
        console.warn("Unknown drift_reason from backend:", unknown);
        return "Not reconciled — cause not recognized by this " +
          "frontend build. Check for a backend schema change.";
      }
    }
  }
  const daemon = p.entry_debit.toFixed(4);
  // Defense in depth (review N3): backend always sets broker_entry_debit
  // + debit_drift together, but if that invariant ever breaks, render
  // "n/a" instead of a misleading $0.0000 that would look like a real
  // cost basis.
  const broker = p.broker_entry_debit == null
    ? "n/a"
    : `$${p.broker_entry_debit.toFixed(4)}`;
  const drift = p.debit_drift!.toFixed(4);
  // Tooltip uses the pretty glyphs (Δ, ≥) — rendered in a browser
  // `title` attribute, no HTML escaping concerns. The ASCII-minus swap
  // in formatDrift above is the grep-visible one (cell text); tooltip
  // text isn't a grep target, so we don't sacrifice typography here.
  return `Daemon entry_debit: $${daemon}\n` +
         `Broker reconstructed: ${broker}\n` +
         `Δ = broker − daemon = $${drift}\n\n` +
         `Green < $${DRIFT_WARN.toFixed(2)} (commission noise)\n` +
         `Amber < $${DRIFT_ERROR.toFixed(2)} (wider spread, acceptable)\n` +
         `Red ≥ $${DRIFT_ERROR.toFixed(2)} (investigate)`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return iso; }
}



/**
 * Broker reality panel. Renders the daemon's most recent snapshot of
 * what IBKR reports — positions + open orders, SPX-universe only.
 *
 * Why: the Daemon Tracked Positions table below shows the daemon's
 * SQLite view, which can drift from broker reality (crash mid-entry,
 * manual intervention, etc.). This panel is the independent second
 * source of truth — operator can see at a glance if the two agree.
 */
function BrokerRealityPanel({
  brokerState,
  daemonPositions,
}: {
  brokerState: DCBrokerState | null;
  daemonPositions: DCPosition[];
}) {
  if (!brokerState || brokerState.snapshot_at === null) {
    return (
      <div className="panel" style={{ padding: 12 }}>
        <div className="panel-header" style={{ marginBottom: 4 }}>
          <span className="panel-title">Broker Reality (IBKR)</span>
        </div>
        <div style={{ color: "#64748b", fontSize: 12, padding: 8 }}>
          No snapshot available — daemon hasn't written state/broker_state.json yet.
        </div>
      </div>
    );
  }

  const posCount = brokerState.positions.length;
  const orderCount = brokerState.open_orders.length;

  // Partition the flat list of broker legs into DC-sized groups
  // (all four legs of one daemon position) and orphan legs that
  // don't map to any open daemon row. Each broker position is
  // placed in exactly one bucket — sum preserves posCount.
  // `collisions` is populated when two daemon rows claim the same
  // conId (deconflict bug, or daemon double-booked) — always empty
  // in healthy state; non-empty is a hard signal the operator
  // needs to see.
  const { groups, unmatched, collisions } = groupBrokerLegs(
    brokerState.positions, daemonPositions,
  );
  // Review N1: gate on daemon having open rows too. Zero-daemon + some-
  // broker is a different condition ("you have positions the daemon
  // doesn't know about" — possibly cold start or pre-market) whose
  // severity doesn't fit the "full drift" narrative. The per-leg ⚠️
  // in the Unmatched table already flags each orphan; the banner is
  // specifically for the "daemon thinks it has N open but broker
  // disagrees on all of them" case that signals post-crash bookkeeping
  // divergence.
  const allUnmatched =
    posCount > 0 && daemonPositions.length > 0 && groups.length === 0;

  return (
    <div className="panel" style={{ padding: 12 }}>
      <div className="panel-header"
           style={{ marginBottom: 8, display: "flex",
                    justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="panel-title">
          Broker Reality — {posCount} SPX position{posCount !== 1 ? "s" : ""},{" "}
          {orderCount} open order{orderCount !== 1 ? "s" : ""}
        </span>
        <span style={{ fontSize: 10,
                       color: snapshotAgeColor(brokerState.snapshot_at),
                       fontFamily: "JetBrains Mono, monospace" }}
              title={
                snapshotAgeSec(brokerState.snapshot_at) !== null &&
                snapshotAgeSec(brokerState.snapshot_at)! >= STALE_WARN_SEC
                  ? "Snapshot is older than expected (1-min RTH / 5-min off-hours cadence). Daemon may be wedged."
                  : "Daemon-reported broker snapshot age"
              }>
          snapshot {formatSnapshotAge(brokerState.snapshot_at)}
        </span>
      </div>
      {collisions.length > 0 && (
        // Two open daemon rows claim the same conId. Broker leg lands
        // in whichever row registered first — the second's group will
        // show incomplete. Upstream bug in deconflict / double-book.
        <div role="status" aria-live="polite"
             style={{
               background: "rgba(239, 68, 68, 0.12)",
               border: "1px solid rgba(239, 68, 68, 0.45)",
               borderRadius: 4,
               padding: "8px 12px",
               marginBottom: 8,
               fontSize: 12,
               color: "#fecaca",
               fontFamily: "Inter, sans-serif",
             }}>
          <strong style={{ color: "#ef4444" }}>conId collision:</strong>{" "}
          {collisions.length} contract{collisions.length !== 1 ? "s" : ""}{" "}
          ({collisions.join(", ")}) claimed by more than one open daemon
          position. Grouping below shows first-claimer's DC only; the
          other DC will render with missing legs. Investigate deconflict
          or a double-book.
        </div>
      )}
      {allUnmatched && (
        // role="status" + aria-live=polite is right for a persistent
        // condition banner — it's announced once when it appears and
        // doesn't re-announce on every re-render. role="alert" would
        // interrupt on mount if the page loaded during a drift state,
        // which is too aggressive for a signal the operator is already
        // seeing in the table.
        <div role="status" aria-live="polite"
             style={{
               background: "rgba(239, 68, 68, 0.12)",
               border: "1px solid rgba(239, 68, 68, 0.45)",
               borderRadius: 4,
               padding: "8px 12px",
               marginBottom: 8,
               fontSize: 12,
               color: "#fecaca",
               fontFamily: "Inter, sans-serif",
             }}>
          <strong style={{ color: "#ef4444" }}>Full daemon–broker drift:</strong>{" "}
          IBKR reports {posCount} SPX position{posCount !== 1 ? "s" : ""}, none
          of which any open daemon position references. Either the
          daemon's SQLite view is completely out of sync (restart mid-fill,
          crashed before persistence) or every leg is a manual entry.
          Reconcile before the next entry fires.
        </div>
      )}
      {posCount === 0 && orderCount === 0 ? (
        <div style={{ color: "#64748b", fontSize: 12, padding: 8 }}>
          IBKR reports no SPX positions or open orders.
        </div>
      ) : (
        <>
          {groups.length > 0 && (
            <BrokerGroupedTable groups={groups} />
          )}
          {unmatched.length > 0 && (
            // Section landmark so screen readers announce the heading
            // and group the explanation + table as a named region.
            // sighted operators see the same styling as before.
            <section aria-labelledby="broker-orphan-heading"
                     style={{ marginTop: groups.length > 0 ? 16 : 0 }}>
              <h3 id="broker-orphan-heading"
                  style={{
                    fontSize: 11, color: "#f59e0b",
                    fontFamily: "Inter, sans-serif", textTransform: "uppercase",
                    letterSpacing: 0.5, marginBottom: 4,
                    fontWeight: 600, margin: 0,
                  }}>
                Unmatched legs ({unmatched.length})
              </h3>
              <div style={{ fontSize: 11, color: "#94a3b8",
                            fontFamily: "Inter, sans-serif",
                            marginTop: 4, marginBottom: 8 }}>
                No open daemon position references these contracts —
                manual entries, ghost positions from cleared DB rows,
                or a reconciliation drift to investigate.
              </div>
              <BrokerPositionsTable positions={unmatched} />
            </section>
          )}
          {orderCount > 0 && (
            <div style={{ marginTop: 12 }}>
              <BrokerOrdersTable orders={brokerState.open_orders} />
            </div>
          )}
        </>
      )}
    </div>
  );
}


/** Summarized DC-level view of the broker's position. One row per
 *  open daemon position, collapsing 4 broker legs into strategy /
 *  structure / qty / broker-computed debit + drift-vs-daemon. */
function BrokerGroupedTable({ groups }: { groups: BrokerDcGroup[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyle}
             aria-label="Broker-reported SPX positions, grouped by daemon DC">
        <thead>
          <tr>
            <th style={thStyle}>Match</th>
            <th style={thStyle}>Strategy</th>
            <th style={thStyle}>Structure</th>
            <th style={thStyle}>Front Exp</th>
            <th style={thStyle}>Back Exp</th>
            <th style={thStyle}>Qty</th>
            <th style={thStyle}>Broker Debit</th>
            <th style={thStyle}>Δ vs Daemon</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const brokerDebit = brokerDebitPerSpread(g);
            const drift = brokerDebit !== null
              ? brokerDebit - g.daemon.entry_debit
              : null;
            // Qty: every leg of a valid DC carries the same absolute
            // position size. Read from the first leg; fall back to
            // daemon.quantity if no legs populated (shouldn't happen
            // since a group exists only with ≥1 leg).
            const qty = g.legs[0] ? Math.abs(g.legs[0].position) : g.daemon.quantity;
            const matchLabel = g.complete
              ? "all 4 legs match daemon"
              : `only ${g.legs.length} of 4 legs matched — partial close or fill`;
            return (
              <tr key={g.daemon.id}>
                <td style={tdStyle}>
                  <span role="img" aria-label={matchLabel} title={matchLabel}>
                    {g.complete ? "✓" : "⚠️"}
                  </span>
                </td>
                <td style={tdStyle}>{g.daemon.strategy_name}</td>
                <td style={tdMono}>
                  P{g.daemon.put_strike}/C{g.daemon.call_strike}
                </td>
                <td style={tdStyle}>{g.daemon.front_exp}</td>
                <td style={tdStyle}>{g.daemon.back_exp}</td>
                <td style={tdMono}>{qty}</td>
                <td style={tdMono}>
                  {brokerDebit !== null ? `$${brokerDebit.toFixed(2)}` : "—"}
                </td>
                <td style={driftCellStyle(drift)}
                    title={brokerDebit !== null
                      ? driftTooltip(g.daemon)
                      : "Partial group — fewer than 4 broker legs match this daemon DC, so no broker debit can be reconstructed."}>
                  {formatDrift(drift)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


function BrokerPositionsTable({ positions }: { positions: DCBrokerPosition[] }) {
  // Rendered only for legs that don't map to any open daemon position —
  // the parent (BrokerRealityPanel) has already partitioned. Every row
  // here gets the ⚠️ icon by definition; no need for the daemon-conid
  // set argument the pre-grouping version carried.
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyle} aria-label="Broker-reported orphan legs">
        <thead>
          <tr>
            <th style={thStyle}>Match</th>
            <th style={thStyle}>Class</th>
            <th style={thStyle}>Expiry</th>
            <th style={thStyle}>K</th>
            <th style={thStyle}>Right</th>
            <th style={thStyle}>Qty</th>
            <th style={thStyle}>Avg Cost</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            return (
              <tr key={`${p.account}-${p.contract.conId}`}>
                <td style={tdStyle}>
                  <span role="img"
                        aria-label="no matching daemon position"
                        title="No daemon position references this contract — could be manual, a ghost, or drift">
                    ⚠️
                  </span>
                </td>
                <td style={tdStyle}>{p.contract.tradingClass || "—"}</td>
                <td style={tdStyle}>{p.contract.expiry || "—"}</td>
                <td style={tdMono}>
                  {p.contract.strike > 0 ? p.contract.strike.toFixed(0) : "—"}
                </td>
                <td style={tdStyle}>{p.contract.right || "—"}</td>
                <td style={{
                  ...tdMono,
                  color: p.position < 0 ? "#ef4444" : "#10b981",
                }}>
                  {p.position}
                </td>
                <td style={tdMono}>
                  {p.avg_cost > 0 ? `$${p.avg_cost.toFixed(2)}` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


function BrokerOrdersTable({ orders }: { orders: DCBrokerOrder[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyle} aria-label="Broker-reported open orders">
        <thead>
          <tr>
            <th style={thStyle}>OrderId</th>
            <th style={thStyle}>Action</th>
            <th style={thStyle}>Qty</th>
            <th style={thStyle}>Filled</th>
            <th style={thStyle}>Limit</th>
            <th style={thStyle}>TIF</th>
            <th style={thStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.orderId}>
              <td style={tdMono}>{o.orderId}</td>
              <td style={tdStyle}>{o.action}</td>
              <td style={tdMono}>{o.totalQuantity}</td>
              <td style={tdMono}>
                {o.filled > 0 ? `${o.filled}/${o.totalQuantity}` : "0"}
              </td>
              <td style={tdMono}>${o.lmtPrice.toFixed(2)}</td>
              <td style={tdStyle}>{o.tif}</td>
              <td style={{
                ...tdStyle,
                color: o.status === "Filled" ? "#10b981"
                  : o.status === "Inactive" ? "#f97316"
                  : o.status === "Cancelled" ? "#64748b"
                  : "#e2e8f0",
              }}>
                {o.status}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// Staleness color cut-offs. Daemon writes 1/min during RTH, every
// 5 min off-hours, so >10 min is "something's wrong" — the whole
// point of this panel is catching drift, and it must loudly signal
// when it can't see fresh data instead of silently rendering old.
const STALE_WARN_SEC = 600;    // >10 min → amber
const STALE_ERROR_SEC = 1800;  // >30 min → red

function snapshotAgeSec(iso: string): number | null {
  const snapshot = new Date(iso).getTime();
  if (!Number.isFinite(snapshot)) return null;
  return Math.round((Date.now() - snapshot) / 1000);
}

function formatSnapshotAge(iso: string): string {
  const ageSec = snapshotAgeSec(iso);
  if (ageSec === null) return "unknown";
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.round(ageSec / 60)}m ago`;
  return `${Math.round(ageSec / 3600)}h ago`;
}

function snapshotAgeColor(iso: string): string {
  const ageSec = snapshotAgeSec(iso);
  if (ageSec === null || ageSec >= STALE_ERROR_SEC) return "#ef4444";
  if (ageSec >= STALE_WARN_SEC) return "#f59e0b";
  return "#64748b";
}
