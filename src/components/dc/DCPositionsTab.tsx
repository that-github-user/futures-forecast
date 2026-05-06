import { useState } from "react";
import type {
  DCBrokerOrder,
  DCBrokerPosition,
  DCBrokerState,
  DCPosition,
  DCRiskStatus,
  DCStrategySpec,
} from "../../api/dcTypes";
import {
  type BrokerDcGroup,
  brokerDebitPerSpread,
  groupBrokerLegs,
} from "../../lib/brokerGrouping";
import { useTimezone } from "../../hooks/useTimezone";
import { useStrategySpecs } from "../../hooks/useStrategySpecs";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import { SignalBadge } from "./SignalBadge";
import { tableStyle, thStyle, tdStyle, tdMono } from "./tableStyles";

interface Props {
  positions: DCPosition[];
  risk: DCRiskStatus | null;
  brokerState: DCBrokerState | null;
}

export function DCPositionsTab({ positions, risk, brokerState }: Props) {
  const { formatPositionDateTime, tzLabel } = useTimezone();
  // Strategy specs (cached) provide the per-strategy thresholds the
  // exit monitor checks against — profit_target_pct, sl_ratio_exit,
  // exit_time, max_dit, etc. Used by the expanded detail panel to
  // render "X% of way to PT" and similar progress against threshold.
  const { specs } = useStrategySpecs();
  const specByName: Record<string, DCStrategySpec> = {};
  for (const s of specs ?? []) {
    specByName[s.name] = s;
  }
  // Track which rows are expanded. Set keyed by position.id so toggle
  // is O(1) and survives positions list mutation between polls.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Risk status cards */}
      {risk && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
          <RiskCard
            label="Daily P&L"
            value={`$${risk.daily_pnl >= 0 ? "+" : ""}${risk.daily_pnl.toFixed(0)}`}
            color={risk.daily_pnl >= 0 ? colors.accentGreen : colors.accentRed}
          />
          <RiskCard label="Trades Today" value={`${risk.daily_trades}`} />
          <RiskCard label="Wins / Losses" value={`${risk.daily_wins}W / ${risk.daily_losses}L`} />
          <RiskCard
            label="Status"
            value={risk.paused ? "PAUSED" : "ACTIVE"}
            color={risk.paused ? colors.accentAmber : colors.accentGreen}
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

      {/* Open positions table — expandable rows with live monitoring. */}
      <div className="panel" style={{ padding: 12 }}>
        <div className="panel-header" style={{ marginBottom: 8 }}>
          <span className="panel-title">Daemon Tracked Positions ({positions.length})</span>
          <span style={{ fontSize: 11, color: colors.textMuted, marginLeft: 12 }}>
            Click a row to expand exit-criteria + bracket details
          </span>
        </div>
        {positions.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: 13, textAlign: "center", padding: 24 }}>
            No open positions
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle} aria-label="Daemon-tracked positions">
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 24 }} aria-label="Expand row" />
                  <th style={thStyle}>Strategy</th>
                  <th style={thStyle}>Signal</th>
                  <th style={thStyle}>Entry</th>
                  <th style={thStyle}>Strikes</th>
                  <th style={thStyle} title="Days until front-leg expiry">DTE</th>
                  <th style={thStyle}>Debit</th>
                  <th style={thStyle} title="Live unrealized P&L (mid mark)">P&amp;L</th>
                  <th style={thStyle} title="P&L as fraction of entry premium / target">P&amp;L %</th>
                  <th style={thStyle} title="Live S/L ratio (front_premium / back_premium)">S/L</th>
                  <th style={thStyle}>TP</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const isExpanded = expanded.has(p.id);
                  const spec = specByName[p.strategy_name];
                  return (
                    <PositionRows
                      key={p.id}
                      position={p}
                      spec={spec}
                      isExpanded={isExpanded}
                      onToggle={() => toggleExpand(p.id)}
                      formatPositionDateTime={formatPositionDateTime}
                      tzLabel={tzLabel}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PositionRows: a (summary row, optional detail row) pair ──────
//
// One render component returns TWO <tr> elements: the slim summary
// row that's always visible, and (when expanded) a second row with
// colSpan covering the whole table for the detail panel. Returning
// a fragment from the parent map keeps the DOM table-valid (no
// nesting issues) while letting the detail layout breathe across
// the full width.

function PositionRows({
  position: p,
  spec,
  isExpanded,
  onToggle,
  formatPositionDateTime,
  tzLabel,
}: {
  position: DCPosition;
  spec: DCStrategySpec | undefined;
  isExpanded: boolean;
  onToggle: () => void;
  formatPositionDateTime: (iso: string) => string;
  tzLabel: string;
}) {
  const dte = daysUntil(p.front_exp);
  const pnl = p.unrealized_pnl ?? null;
  const pnlPct = p.pnl_pct ?? null;
  const slLive = p.live_sl_ratio ?? null;
  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          cursor: "pointer",
          // Soft hover-ish background only when expanded so the
          // detail panel reads as visually attached to its summary.
          background: isExpanded ? withAlpha(colors.accentBlue, 0.06) : "transparent",
        }}
        aria-expanded={isExpanded}
      >
        <td style={{ ...tdStyle, fontFamily: fonts.mono, color: colors.textMuted, width: 24 }}
            aria-hidden="true">
          {isExpanded ? "▼" : "▶"}
        </td>
        <td style={tdStyle}>{p.strategy_name}</td>
        <td style={tdStyle}><SignalBadge signal={p.signal} /></td>
        <td style={tdStyle}
            title={`Rendered: ${formatPositionDateTime(p.entry_time)} ${tzLabel} • Raw: ${p.entry_time}`}>
          {formatPositionDateTime(p.entry_time)}{" "}
          <span style={{ color: colors.textMuted }}>{tzLabel}</span>
        </td>
        <td style={tdMono}>{p.put_strike}P / {p.call_strike}C</td>
        <td style={tdMono}>{dte ?? "—"}</td>
        <td style={tdMono}>${p.entry_debit.toFixed(2)}</td>
        <td style={pnl == null ? tdMono : pnlCellStyle(pnl)}>
          {pnl == null ? "—" : formatDollarPnl(pnl)}
        </td>
        <td style={pnlPct == null ? tdMono : pnlCellStyle(pnlPct)}
            title={
              spec && pnlPct != null
                ? `Current ${(pnlPct * 100).toFixed(1)}% of entry; PT at ${(spec.profit_target_pct * 100).toFixed(0)}%`
                : undefined
            }>
          {pnlPct == null ? "—" : `${pnlPct >= 0 ? "+" : ""}${(pnlPct * 100).toFixed(1)}%`}
        </td>
        <td style={slLive == null ? tdMono : slCellStyle(slLive, spec?.sl_ratio_exit ?? null)}
            title={
              spec?.sl_ratio_exit != null && slLive != null
                ? `Live ${slLive.toFixed(3)} vs exit threshold ${spec.sl_ratio_exit.toFixed(3)}`
                : "Live front/back premium ratio"
            }>
          {slLive == null ? "—" : slLive.toFixed(3)}
        </td>
        <td style={tdMono}
            title={
              p.bracket_order_id == null
                ? "No broker-side TP attached"
                : `Bracket orderId=${p.bracket_order_id}; cancellation cascades from any non-TP exit`
            }>
          {p.bracket_target_price != null
            ? `$${p.bracket_target_price.toFixed(2)}`
            : p.bracket_order_id != null
              ? "✓"
              : "—"}
        </td>
        <td style={tdStyle}>{p.status}</td>
      </tr>
      {isExpanded && (
        <tr style={{ background: withAlpha(colors.accentBlue, 0.04) }}>
          <td colSpan={12} style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.borderDim}` }}>
            <PositionDetailPanel position={p} spec={spec} />
          </td>
        </tr>
      )}
    </>
  );
}


// ── PositionDetailPanel ─────────────────────────────────────────
//
// Shown inside the expanded row. Three sections in a responsive
// grid:
//   1. Position metadata (qty, SPX@entry, broker drift, bracket id)
//   2. Exit-criteria progress (PT, S/L, DIT, time-to-exit)
//   3. Strategy reference (entry rules, exit rules from the spec)
//
// All four exit-criteria progress bars handle missing data
// gracefully — the dashboard surfaces "—" for whichever metric the
// daemon hasn't computed yet, so an early-render row doesn't
// block on partial data.

function PositionDetailPanel({
  position: p, spec,
}: {
  position: DCPosition;
  spec: DCStrategySpec | undefined;
}) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
      gap: 16,
      fontFamily: fonts.sans,
      fontSize: 12,
    }}>
      {/* Position metadata */}
      <DetailSection title="Position">
        <DetailRow label="Quantity" value={`${p.quantity} contract${p.quantity === 1 ? "" : "s"}`} />
        <DetailRow label="SPX @ entry" value={p.spx_at_entry?.toFixed(2) ?? "—"} />
        <DetailRow
          label="Broker drift"
          value={formatDrift(p.debit_drift)}
          valueColor={driftColor(p.debit_drift)}
          tooltip={driftTooltip(p)}
        />
        <DetailRow label="Front exp" value={p.front_exp} />
        <DetailRow label="Back exp" value={p.back_exp} />
      </DetailSection>

      {/* Bracket section */}
      <DetailSection title="Profit-target bracket">
        {p.bracket_order_id != null ? (
          <>
            <DetailRow
              label="Status"
              value="Active at broker"
              valueColor={colors.accentGreen}
              tooltip="IBKR is holding a GTC limit at the target. Daemon-side TP monitor is a no-op for this position. Any non-TP exit cancels the bracket first to prevent double-fills."
            />
            <DetailRow label="Order ID" value={`#${p.bracket_order_id}`} />
            <DetailRow
              label="Target price"
              value={p.bracket_target_price != null ? `$${p.bracket_target_price.toFixed(2)}` : "—"}
              tooltip="GTC limit price. Bracket fills when spread mark trades through this level."
            />
          </>
        ) : (
          <DetailRow
            label="Status"
            value="Daemon-side"
            valueColor={colors.textMuted}
            tooltip="No broker-side TP. Daemon's monitor checks profit target on each cycle and submits a close when hit. Common reasons: hold-to-expiration sentinel (pt ≥ 1.0), bracket submission failed at entry, or legacy position from before PR #126."
          />
        )}
      </DetailSection>

      {/* Exit-criteria progress */}
      <DetailSection title="Exit criteria">
        <ExitCriterionRow
          label="Profit target"
          current={p.pnl_pct}
          threshold={spec?.profit_target_pct ?? null}
          format={(v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`}
          tooltip={
            spec?.profit_target_pct != null
              ? `PT fires when P&L% ≥ ${(spec.profit_target_pct * 100).toFixed(0)}%`
              : undefined
          }
        />
        <ExitCriterionRow
          label="S/L ratio"
          current={p.live_sl_ratio}
          threshold={spec?.sl_ratio_exit ?? null}
          format={(v) => v.toFixed(3)}
          // S/L exit fires when ratio DROPS below threshold (front
          // decayed too far / back didn't hold value). Inverse
          // direction from PT.
          inverse
          tooltip={
            spec?.sl_ratio_exit != null
              ? `S/L exit fires when live ratio < ${spec.sl_ratio_exit.toFixed(3)}`
              : "No S/L exit configured for this strategy"
          }
        />
        <ExitCriterionRow
          label="Days in trade"
          current={daysSince(p.entry_date)}
          threshold={spec?.max_dit ?? null}
          format={(v) => `${v}d`}
          tooltip={
            spec?.max_dit != null
              ? `DIT exit fires when days held ≥ ${spec.max_dit} (and time ≥ exit_time on that day)`
              : "No DIT exit for this strategy"
          }
        />
        <DetailRow
          label="Time exit"
          value={
            spec?.exit_time != null
              ? `${spec.exit_time} ET on ${p.front_exp}`
              : "—"
          }
          tooltip="Hard time stop on front-leg expiry day. Fires regardless of P&L."
        />
      </DetailSection>
    </div>
  );
}

// Visual: section heading + flex column of label/value rows.
function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 10, color: colors.textMuted, textTransform: "uppercase",
        letterSpacing: 0.5, fontWeight: 600, marginBottom: 6,
      }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {children}
      </div>
    </div>
  );
}

function DetailRow({
  label, value, valueColor, tooltip,
}: {
  label: string;
  value: React.ReactNode;
  valueColor?: string;
  tooltip?: string;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}
         title={tooltip}>
      <span style={{ color: colors.textMuted, fontSize: 11 }}>{label}</span>
      <span style={{
        fontFamily: fonts.mono, fontSize: 12,
        color: valueColor ?? colors.textPrimary,
      }}>
        {value}
      </span>
    </div>
  );
}

// Progress bar showing current vs threshold for an exit criterion.
// `inverse=true` reverses the direction (S/L: lower is worse).
function ExitCriterionRow({
  label, current, threshold, format, inverse, tooltip,
}: {
  label: string;
  current: number | null | undefined;
  threshold: number | null | undefined;
  format: (v: number) => string;
  inverse?: boolean;
  tooltip?: string;
}) {
  const hasBoth = current != null && threshold != null;
  // Progress: 0 = not started, 1 = at threshold (would fire), >1 = past.
  let pct: number | null = null;
  if (hasBoth && threshold !== 0) {
    if (inverse) {
      // S/L: 1 means at-threshold (lower=closer to firing). Map
      // [threshold, 1] → [1, 0] so the bar EMPTIES as ratio drops.
      pct = current >= 1 ? 0 : Math.max(0, Math.min(1, (1 - current) / Math.max(1e-6, 1 - threshold)));
    } else {
      // PT / DIT: current/threshold, capped 0..1.5 for visual.
      pct = Math.max(0, Math.min(1.5, current / threshold));
    }
  }
  return (
    <div title={tooltip}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ color: colors.textMuted, fontSize: 11 }}>{label}</span>
        <span style={{ fontFamily: fonts.mono, fontSize: 12 }}>
          {current == null ? "—" : format(current)}
          {threshold != null && (
            <span style={{ color: colors.textMuted }}> / {format(threshold)}</span>
          )}
        </span>
      </div>
      {pct != null && (
        <div style={{
          height: 4, background: colors.bgInset, borderRadius: 2, overflow: "hidden",
        }}>
          <div style={{
            height: "100%",
            width: `${Math.min(100, pct * 100)}%`,
            background: pct >= 1.0 ? colors.accentRed
                     : pct >= 0.75 ? colors.accentAmber
                     : colors.accentGreen,
            transition: "width 200ms ease",
          }} />
        </div>
      )}
    </div>
  );
}


// ── Cell styling helpers ─────────────────────────────────────────

function pnlCellStyle(v: number): React.CSSProperties {
  return {
    ...tdMono,
    color: v > 0 ? colors.accentGreen : v < 0 ? colors.accentRed : colors.textMuted,
  };
}

// S/L color: green when comfortably above exit threshold, amber as
// it drops toward threshold, red when at-or-below.
function slCellStyle(live: number, threshold: number | null): React.CSSProperties {
  const base = tdMono;
  if (threshold == null) return { ...base, color: colors.textPrimary };
  if (live <= threshold) return { ...base, color: colors.accentRed };
  if (live <= threshold * 1.15) return { ...base, color: colors.accentAmber };
  return { ...base, color: colors.accentGreen };
}

function formatDollarPnl(v: number): string {
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(v).toFixed(0)}`;
}


// ── Date helpers (no library; SPX exp strings are YYYYMMDD) ─────

function daysUntil(yyyymmdd: string): number | null {
  const parsed = parseSpxDate(yyyymmdd);
  if (parsed == null) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = (parsed.getTime() - today.getTime()) / 86_400_000;
  return Math.round(diff);
}

function daysSince(yyyy_mm_dd: string | null | undefined): number | null {
  if (!yyyy_mm_dd) return null;
  // entry_date stored as ISO 'YYYY-MM-DD' — different format from front_exp.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyy_mm_dd);
  if (!m) return null;
  const entry = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = (today.getTime() - entry.getTime()) / 86_400_000;
  return Math.max(0, Math.round(diff));
}

function parseSpxDate(yyyymmdd: string): Date | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null;
  const y = parseInt(yyyymmdd.slice(0, 4));
  const m = parseInt(yyyymmdd.slice(4, 6)) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8));
  return new Date(y, m, d);
}


// ── Drift color helper (used by DetailRow tooltip + value) ──────

function driftColor(d: number | null | undefined): string {
  if (d == null) return colors.textMuted;
  const mag = Math.abs(d);
  if (mag < DRIFT_WARN) return colors.accentGreen;
  if (mag < DRIFT_ERROR) return colors.accentAmber;
  return colors.accentRed;
}


function RiskCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      background: colors.bgPanel, border: `1px solid ${colors.borderDim}`, borderRadius: 6, padding: "10px 12px",
    }}>
      <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.sans, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{
        fontSize: 16, fontWeight: 700, fontFamily: fonts.mono,
        color: color ?? colors.textPrimary, marginTop: 2,
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

// Shared style for the two error banners in BrokerRealityPanel
// (conId-collision + full-drift). Same visual treatment; extracted to
// avoid two copies of the identical inline-style block. accentRedLight
// (persimmon-light) is the softer-red token for body text on the dark
// error-banner background — distinct from accentRed (used for the
// banner border) so the message text stays readable inside the tint.
const errorBannerStyle: React.CSSProperties = {
  background: withAlpha(colors.accentRed, 0.12),
  border: `1px solid ${withAlpha(colors.accentRed, 0.45)}`,
  borderRadius: 4,
  padding: "8px 12px",
  marginBottom: 8,
  fontSize: 12,
  color: colors.accentRedLight,
  fontFamily: fonts.sans,
};

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
  if (isDriftUnset(d)) return { ...base, color: colors.textMuted };
  const mag = Math.abs(d!);
  if (mag < DRIFT_WARN) return { ...base, color: colors.accentGreen };    // green
  if (mag < DRIFT_ERROR) return { ...base, color: colors.accentAmber };   // amber
  return { ...base, color: colors.accentRed };                          // red
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
        <div style={{ color: colors.textMuted, fontSize: 12, padding: 8 }}>
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
                       fontFamily: fonts.mono }}
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
        <div role="status" aria-live="polite" style={errorBannerStyle}>
          <strong style={{ color: colors.accentRed }}>conId collision:</strong>{" "}
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
        <div role="status" aria-live="polite" style={errorBannerStyle}>
          <strong style={{ color: colors.accentRed }}>Full daemon–broker drift:</strong>{" "}
          IBKR reports {posCount} SPX position{posCount !== 1 ? "s" : ""}, none
          of which any open daemon position references. Either the
          daemon's SQLite view is completely out of sync (restart mid-fill,
          crashed before persistence) or every leg is a manual entry.
          Reconcile before the next entry fires.
        </div>
      )}
      {posCount === 0 && orderCount === 0 ? (
        <div style={{ color: colors.textMuted, fontSize: 12, padding: 8 }}>
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
                    fontSize: 11, color: colors.accentAmber,
                    fontFamily: fonts.sans, textTransform: "uppercase",
                    letterSpacing: 0.5, marginBottom: 4,
                    fontWeight: 600, margin: 0,
                  }}>
                Unmatched legs ({unmatched.length})
              </h3>
              <div style={{ fontSize: 11, color: colors.textSecondary,
                            fontFamily: fonts.sans,
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
                  color: p.position < 0 ? colors.accentRed : colors.accentGreen,
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
                // accentRedLight (persimmon-light) for Inactive — the
                // mid-severity tier between accentAmber (warn) and
                // accentRed (error). Same token used in DCEventsTab for
                // the equivalent severity slot.
                color: o.status === "Filled" ? colors.accentGreen
                  : o.status === "Inactive" ? colors.accentRedLight
                  : o.status === "Cancelled" ? colors.textMuted
                  : colors.textPrimary,
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
  if (ageSec === null || ageSec >= STALE_ERROR_SEC) return colors.accentRed;
  if (ageSec >= STALE_WARN_SEC) return colors.accentAmber;
  return colors.textMuted;
}
