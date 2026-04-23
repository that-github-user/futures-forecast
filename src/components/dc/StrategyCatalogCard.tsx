/**
 * StrategyCatalogCard — one strategy in the browse/catalog view.
 *
 * Renders the full spec (DTE, deltas, entry days/times, profit target,
 * stop-loss, exit rules) plus a subscribe checkbox the user can toggle to
 * add the strategy to their personal monitor list. Optional historical
 * performance footer is shown when stats are available.
 *
 * Receives all strategy data via props — no hardcoded values.
 */

import type { DCStrategySpec, DCStrategyStats } from "../../api/dcTypes";
import { formatEntryDays } from "../../lib/dcLifecycle";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import { SignalBadge } from "./SignalBadge";

interface Props {
  spec: DCStrategySpec;
  signal: string | null;
  isSubscribed: boolean;
  onToggle: () => void;
  stats: DCStrategyStats | null;
  formatTime: (hhmmET: string | null) => string;
  tzLabel: string;
}

const FAMILY_LABELS: Record<string, string> = {
  long_dte: "Long DTE",
  short_dte: "Short DTE",
  hybrid_fm: "Hybrid Fri-Mon",
  spy_short_puts: "SPY Short Puts",
  spy_straddles: "SPY Straddles",
};

// Family-specific accent colors. long_dte + hybrid_fm reuse shared
// accents; short_dte (purple), spy_short_puts (cyan), spy_straddles
// (pink) are category-specific visual tags — not in the shared
// palette. Kept inline with this lookup so a future theme sweep sees
// them as one block.
const FAMILY_COLORS: Record<string, string> = {
  long_dte: colors.accentBlue,
  short_dte: "#a855f7",
  hybrid_fm: colors.accentAmber,
  spy_short_puts: "#06b6d4",  // cyan
  spy_straddles: "#ec4899",   // pink
};

export function StrategyCatalogCard({ spec, signal, isSubscribed, onToggle, stats, formatTime, tzLabel }: Props) {
  const familyLabel = FAMILY_LABELS[spec.family] ?? spec.family;
  const familyColor = FAMILY_COLORS[spec.family] ?? colors.textMuted;

  return (
    <div
      style={{
        background: colors.bgPanel,
        border: `1px solid ${isSubscribed ? withAlpha(colors.accentBlue, 0.5) : colors.borderDim}`,
        borderRadius: 8,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Header: name + family + signal + subscribe */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary, fontFamily: fonts.sans }}>
            {spec.name}
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: familyColor,
              background: familyColor + "18",
              border: `1px solid ${familyColor}40`,
              padding: "2px 6px",
              borderRadius: 6,
              fontFamily: fonts.sans,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {familyLabel}
          </span>
          <SignalBadge signal={signal} />
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
            fontSize: 11,
            color: colors.textSecondary,
            fontFamily: fonts.sans,
          }}
        >
          <input
            type="checkbox"
            checked={isSubscribed}
            onChange={onToggle}
            style={{ cursor: "pointer", accentColor: colors.accentBlue }}
          />
          {isSubscribed ? "Subscribed" : "Subscribe"}
        </label>
      </div>

      {/* Specs grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "4px 12px",
          fontSize: 11,
          fontFamily: fonts.mono,
        }}
      >
        <SpecRow label="DTE" value={`${spec.front_dte} / ${spec.back_dte}`} />
        <SpecRow label="TP" value={`${(spec.profit_target_pct * 100).toFixed(0)}%`} />
        <SpecRow
          label="Δ Put / Call"
          value={
            spec.is_asymmetric
              ? `${(spec.put_delta * 100).toFixed(0)} / ${(spec.call_delta * 100).toFixed(0)} (asym)`
              : `${(spec.put_delta * 100).toFixed(0)}`
          }
        />
        <SpecRow label="S/L Min" value={spec.sl_ratio_min != null ? spec.sl_ratio_min.toFixed(2) : "—"} />
        <SpecRow label="Days" value={formatEntryDays(spec.entry_days)} />
        <SpecRow label="S/L Exit" value={spec.sl_ratio_exit != null ? spec.sl_ratio_exit.toFixed(2) : "—"} />
        <SpecRow label={`Times (${tzLabel})`} value={spec.entry_times.map(formatTime).join(", ")} fullWidth />
        {spec.entry_window_end != null && (
          <SpecRow label="Window End" value={spec.entry_window_end} />
        )}
        {spec.max_dit != null && <SpecRow label="Max DIT" value={`${spec.max_dit}d`} />}
        {spec.vix_min != null && <SpecRow label="VIX Min" value={spec.vix_min.toFixed(1)} />}
      </div>

      {/* Exit rules */}
      {(spec.delta_exits.length > 0 || spec.tested_exits.length > 0 || spec.partial_close != null) && (
        <div style={{ borderTop: `1px solid ${colors.borderDim}`, paddingTop: 8 }}>
          <div
            style={{
              fontSize: 9,
              color: colors.textMuted,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              fontFamily: fonts.sans,
              marginBottom: 4,
            }}
          >
            Exit Rules
          </div>
          <div style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.textSecondary, lineHeight: 1.5 }}>
            {spec.delta_exits.map((r, i) => (
              <div key={`d${i}`}>
                {r.leg === "put" ? "P" : "C"}
                {r.entry_delta} → |Δ| {r.direction === "above" ? "≥" : "≤"} {r.threshold.toFixed(2)}
              </div>
            ))}
            {spec.tested_exits.map((r, i) => (
              <div key={`t${i}`}>
                {r.leg === "put" ? "Put" : "Call"} tested −{(r.breach_pct * 100).toFixed(2)}%
              </div>
            ))}
            {spec.partial_close && (
              <div>
                Close {(spec.partial_close.pct_of_position * 100).toFixed(0)}% at{" "}
                {(spec.partial_close.at_pt_pct * 100).toFixed(0)}% TP
              </div>
            )}
          </div>
        </div>
      )}

      {/* Historical stats footer */}
      {stats && stats.total_trades > 0 && (
        <div
          style={{
            borderTop: `1px solid ${colors.borderDim}`,
            paddingTop: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 11,
            fontFamily: fonts.mono,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 6,
            }}
          >
            <Stat label="Trades" value={`${stats.total_trades}`} />
            <Stat
              label="Win Rate"
              value={stats.win_rate != null ? `${(stats.win_rate * 100).toFixed(0)}%` : "—"}
            />
            <Stat
              label="P&L"
              value={`${stats.total_pnl >= 0 ? "+" : ""}$${stats.total_pnl.toFixed(0)}`}
              color={stats.total_pnl >= 0 ? colors.accentGreen : colors.accentRed}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 6,
            }}
          >
            <Stat
              label="Avg P&L"
              value={stats.avg_pnl != null ? `$${stats.avg_pnl.toFixed(2)}` : "—"}
            />
            <Stat label="D'Alembert" value={`${stats.current_mult.toFixed(1)}x`} />
            <Stat
              label="W / L"
              value={`${stats.total_wins} / ${stats.total_losses}`}
            />
          </div>
          {(stats.consecutive_wins > 0 || stats.consecutive_losses > 0) && (
            <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
              {stats.consecutive_wins > 0 && (
                <span style={{ color: colors.accentGreen }}>{stats.consecutive_wins}W streak</span>
              )}
              {stats.consecutive_losses > 0 && (
                <span style={{ color: colors.accentRed }}>{stats.consecutive_losses}L streak</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SpecRow({ label, value, fullWidth }: { label: string; value: string; fullWidth?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 6, gridColumn: fullWidth ? "1 / -1" : undefined }}>
      <span style={{ color: colors.textMuted, fontFamily: fonts.sans, fontSize: 10 }}>{label}</span>
      <span style={{ color: colors.textPrimary, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ fontSize: 9, color: colors.textMuted, fontFamily: fonts.sans, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ color: color ?? colors.textPrimary }}>{value}</div>
    </div>
  );
}
