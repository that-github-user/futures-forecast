/**
 * System Health strip — sits under the DC dashboard header and surfaces
 * anomalies in three aggregate indicators from any tab:
 *
 *   IV     — how many strategies resolved on chain vs fell back to VIX.
 *   Broker — broker_state sidecar freshness + conId collisions + orphans.
 *   Drift  — max |debit_drift| across open positions.
 *
 * Each pill is a button; clicking jumps to the tab where the per-row
 * detail lives. Aggregation is a pure function (see lib/systemHealth);
 * this component is just formatting + click routing.
 */

import type { BrokerHealth, DriftHealth, IVSourceHealth, SystemHealth } from "../../lib/systemHealth";
import { DRIFT_ERROR, DRIFT_WARN } from "../../lib/systemHealth";
import { colors, fonts, withAlpha, withAlphaByte } from "../../styles/tokens";

interface Props {
  health: SystemHealth;
  onClickIV: () => void;
  onClickBroker: () => void;
  onClickDrift: () => void;
}

type ColorPair = { fg: string; bg: string; border: string };
// When healthy (`ok` or `unknown`) pills stay neutral so the strip reads
// as ambient — only lights up when something is actually off. That way
// the eye doesn't habituate to a row of green and miss the red.
const COLOR: Record<"ok" | "warn" | "error" | "unknown", ColorPair> = {
  ok: { fg: colors.textSecondary, bg: "transparent", border: colors.borderDim },
  unknown: { fg: colors.textDim, bg: "transparent", border: colors.borderDim },
  warn: {
    fg: colors.accentAmber,
    bg: withAlphaByte(colors.accentAmber, 0x18),
    border: withAlpha(colors.accentAmber, 0.25),
  },
  error: {
    fg: colors.accentRed,
    bg: withAlphaByte(colors.accentRed, 0x18),
    border: withAlpha(colors.accentRed, 0.25),
  },
};

function formatAge(sec: number | null): string {
  if (sec == null) return "no snap";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function ivLabel(iv: IVSourceHealth): string {
  const { chain, vix, default_, pending, total } = iv;
  if (total === 0) return "—";
  const resolved = chain + vix + default_;
  if (resolved === 0) return `${pending} pending`;
  const parts: string[] = [];
  if (chain > 0) parts.push(`${chain}/${resolved} chain`);
  if (vix > 0) parts.push(`${vix} vix`);
  if (default_ > 0) parts.push(`${default_} default`);
  return parts.join(" · ");
}

function brokerLabel(broker: BrokerHealth): string {
  const ageLabel = formatAge(broker.ageSec);
  const extras: string[] = [];
  if (broker.collisions > 0) extras.push(`${broker.collisions} conId collision`);
  if (broker.orphans > 0) extras.push(`${broker.orphans} orphan`);
  return extras.length ? `${ageLabel} · ${extras.join(" · ")}` : ageLabel;
}

function driftLabel(drift: DriftHealth): string {
  if (drift.maxAbsDrift == null) return "—";
  const amt = `$${drift.maxAbsDrift.toFixed(2)}`;
  if (drift.level === "ok") return `max ${amt}`;
  return `${drift.worstStrategy ?? "?"} ${amt}`;
}

function Pill({
  label, value, level, onClick, title,
}: {
  label: string;
  value: string;
  level: "ok" | "warn" | "error" | "unknown";
  onClick: () => void;
  title: string;
}) {
  const c = COLOR[level];
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={`${label}: ${value}`}
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 12,
        border: `1px solid ${c.border}`,
        background: c.bg,
        color: c.fg,
        fontFamily: fonts.sans,
        fontSize: 11,
        cursor: "pointer",
      }}
    >
      <span style={{ fontWeight: 600, letterSpacing: 0.3 }}>{label}</span>
      <span style={{ fontFamily: fonts.mono, fontSize: 11 }}>
        {value}
      </span>
    </button>
  );
}

export function DCSystemHealthStrip({
  health, onClickIV, onClickBroker, onClickDrift,
}: Props) {
  return (
    <div
      role="group"
      aria-label="System health"
      // role="group" rather than role="status" (which implicitly has
      // aria-live="polite"): pill labels tick every poll ("9m ago" →
      // "10m ago") and a live region would announce the entire strip
      // to screen readers every 30s even when nothing is actually wrong.
      style={{
        display: "flex",
        gap: 8,
        padding: "6px 16px 8px",
        alignItems: "center",
        borderBottom: `1px solid ${colors.borderDim}`,
      }}
    >
      <Pill
        label="IV"
        value={ivLabel(health.iv)}
        level={health.iv.level}
        onClick={onClickIV}
        title="IV anchor used by strike resolvers this cycle. Amber = any VIX fallback; red = any default (cold-start). Click for the Signals tab."
      />
      <Pill
        label="Broker"
        value={brokerLabel(health.broker)}
        level={health.broker.level}
        onClick={onClickBroker}
        title="Broker sidecar freshness + any conId collisions or orphan legs. Amber >10min, red >30min or any collision. Click for the Positions tab."
      />
      <Pill
        label="Drift"
        value={driftLabel(health.drift)}
        level={health.drift.level}
        onClick={onClickDrift}
        title={`Max |debit drift| across open positions. Green < $${DRIFT_WARN.toFixed(2)} (commission noise); amber < $${DRIFT_ERROR.toFixed(2)} (wider spread); red ≥ $${DRIFT_ERROR.toFixed(2)} (investigate). Click for the Positions tab.`}
      />
    </div>
  );
}
