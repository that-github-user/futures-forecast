/**
 * LegDetailBlock — net-debit header + IV-source badge + profit-target
 * line + 4-leg table + optional S/L footer. Rendered by
 * StrategyMonitorCard for every lifecycle state where leg data makes
 * sense (see isActiveLifecycleState below).
 */

import { colors, fonts, withAlpha } from "../../../styles/tokens";
import type { DCLegDetail, LegName } from "../../../api/dcTypes";
import type { LifecycleState } from "../../../lib/dcLifecycle";
import { formatExpiry } from "../../../lib/dcLifecycle";
import { roundToSpxTick, roundToSpyTick } from "../../../lib/spxTick";
import type { LegData } from "./types";

const ACTIVE_STATES = new Set<LifecycleState>([
  "primed",
  "imminent",
  "firing",
  "recently_fired",
  "not_fired_yet",
  "passed_will_fire",
  "passed_skipped",
]);

/** True when the card's lifecycle state warrants showing the leg-detail
 *  block. "Active" covers every entry-day state after pre-features,
 *  including passed_* so late-joiners can still see snapshot drift
 *  after the entry time has passed. */
export function isActiveLifecycleState(state: LifecycleState): boolean {
  return ACTIVE_STATES.has(state);
}

const LEG_ORDER: LegName[] = ["front_put", "front_call", "back_put", "back_call"];
const LEG_LABELS: Record<LegName, string> = {
  front_put: "Front P",
  front_call: "Front C",
  back_put: "Back P",
  back_call: "Back C",
};

export function LegDetailBlock({ legData }: { legData: LegData }) {
  const { legs, netDebit, entryNetDebit, snapshot, slRatio, slRatioMeetsMin, profitTargetPct, usesSlRatio, ivSource, entryDirection } = legData;

  // No leg data yet (worker hasn't polled or this strategy isn't eligible).
  // Fall back to just the S/L line for strategies that use it; otherwise render nothing.
  if (!legs) {
    return usesSlRatio ? <SLRatioLine slRatio={slRatio} meetsMin={slRatioMeetsMin} /> : null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Net debit header + profit target line */}
      <NetDebitHeader
        netDebit={netDebit}
        entryNetDebit={entryNetDebit}
        snapshotTime={snapshot?.entry_time ?? null}
        ivSource={ivSource}
        entryDirection={entryDirection}
      />
      <ProfitTargetLine
        netDebit={netDebit}
        entryNetDebit={entryNetDebit}
        profitTargetPct={profitTargetPct}
        entryDirection={entryDirection}
      />

      {/* Leg table */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto 1fr 1fr 1fr",
          gap: "3px 8px",
          fontSize: 11,
          fontFamily: fonts.mono,
          alignItems: "center",
        }}
      >
        {/* Header row */}
        <TableHeader text="Leg" align="left" />
        <TableHeader text="Exp" align="left" />
        <TableHeader text="Now" align="right" />
        <TableHeader text="Entry" align="right" />
        <TableHeader text="Δ" align="right" />

        {LEG_ORDER.map((legName) => {
          const leg = legs[legName];
          if (!leg) return null; // defensive — backend currently always builds all 4
          return <LegRow key={legName} label={LEG_LABELS[legName]} leg={leg} />;
        })}
      </div>

      {/* S/L footer — suppressed for strategies that don't use S/L as an entry or exit criterion */}
      {usesSlRatio && <SLRatioLine slRatio={slRatio} meetsMin={slRatioMeetsMin} />}
    </div>
  );
}

function NetDebitHeader({
  netDebit,
  entryNetDebit,
  snapshotTime,
  ivSource,
  entryDirection,
}: {
  netDebit: number | null;
  entryNetDebit: number | null;
  snapshotTime: string | null;
  ivSource: "chain" | "vix" | "default" | null;
  entryDirection: "debit" | "credit";
}) {
  const isCredit = entryDirection === "credit";
  const label = isCredit ? "Net Credit" : "Net Debit";

  if (netDebit == null) {
    // Review N1: after a daemon restart the SL worker resolves legs
    // (ivSource populated) before the first ratio poll produces
    // netDebit. Render a minimal header anyway so the IV-anchor
    // badge is visible during that window — exactly when an operator
    // may be watching for the fix to engage after a restart.
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: 10,
                    fontSize: 12, color: colors.textMuted,
                    fontFamily: fonts.mono }}>
        <span>{isCredit ? "Credit" : "Debit"}: --</span>
        <IVSourceBadge source={ivSource} />
      </div>
    );
  }

  const hasSnapshot = entryNetDebit != null;
  const delta = hasSnapshot ? netDebit - entryNetDebit : null;
  // Post-entry (hasSnapshot): color by P/L — "in our favor" = green, "against us" = red.
  //   Debit (we paid): mark rising above entry = profit → green.
  //   Credit (we collected): mark falling below entry = decay = profit → green.
  // Pre-entry (no snapshot): color by cost-to-enter. Debit rising = more expensive → red;
  //   credit rising = better fill → green. Keeps the "rising number = pay more" intuition
  //   before any position is open.
  let deltaColor: string = colors.textSecondary;
  if (delta != null && delta !== 0) {
    const favorable = hasSnapshot
      ? (isCredit ? delta < 0 : delta > 0)
      : (isCredit ? delta > 0 : delta < 0);
    deltaColor = favorable ? colors.accentGreen : colors.accentRed;
  }
  const deltaStr = delta == null ? "" : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        flexWrap: "wrap",
        fontFamily: fonts.mono,
      }}
    >
      <div style={{ fontSize: 10, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: fonts.sans }}>
        {label}
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: colors.textPrimary }}>
        ${netDebit.toFixed(2)}
      </div>
      {hasSnapshot && (
        <div style={{ fontSize: 10, color: colors.textMuted, display: "flex", alignItems: "baseline", gap: 4 }}>
          <span>entry {snapshotTime} ${entryNetDebit!.toFixed(2)}</span>
          <span style={{ color: deltaColor, fontWeight: 700 }}>({deltaStr})</span>
        </div>
      )}
      <IVSourceBadge source={ivSource} />
    </div>
  );
}

/** Small indicator showing which IV anchor seeded the resolver's
 *  BS inverter this cycle. Green = chain (good), amber = vix
 *  (pre-fix fallback; silent fallbacks here caused the 21/28 strike
 *  incident), red = default (cold-start). Null renders nothing. */
function IVSourceBadge({
  source,
}: {
  source: "chain" | "vix" | "default" | null;
}) {
  if (source === null) return null;
  const { label, bg, border, color, title } = (() => {
    switch (source) {
      case "chain":
        return {
          label: "IV chain",
          bg: withAlpha(colors.accentGreen, 0.12),
          border: withAlpha(colors.accentGreen, 0.45),
          color: colors.accentGreen,
          title: "BS inverter is using live chain-sampled ATM IV — the fix is engaged for this strategy.",
        };
      case "vix":
        return {
          label: "IV vix",
          bg: withAlpha(colors.accentAmber, 0.14),
          border: withAlpha(colors.accentAmber, 0.45),
          color: colors.accentAmber,
          title: "BS inverter fell back to VIX-scaled IV — the chain sample failed. Strikes may drift from market 20Δ; investigate if persistent.",
        };
      case "default":
        return {
          label: "IV default",
          bg: withAlpha(colors.accentRed, 0.14),
          border: withAlpha(colors.accentRed, 0.45),
          color: colors.accentRed,
          title: "BS inverter has neither a chain sample nor VIX — using hardcoded 20% default. Cold-start or feature-refresh failure.",
        };
    }
  })();

  return (
    <span
      role="img"
      aria-label={`IV source: ${source}`}
      title={title}
      style={{
        fontSize: 9,
        fontFamily: fonts.sans,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        padding: "1px 6px",
        borderRadius: 3,
        background: bg,
        border: `1px solid ${border}`,
        color,
        fontWeight: 600,
        marginLeft: "auto",
      }}
    >
      {label}
    </span>
  );
}

function ProfitTargetLine({
  netDebit,
  entryNetDebit,
  profitTargetPct,
  entryDirection,
}: {
  netDebit: number | null;
  entryNetDebit: number | null;
  profitTargetPct: number;
  entryDirection: "debit" | "credit";
}) {
  // Debit: profit = mark rises. Target close value = basis × (1 + pct).
  //   e.g. entry $11.90 + 40% TP → close at $16.66.
  // Credit: profit = mark decays. Target close value = basis × (1 − pct).
  //   e.g. entry $3.00 − 25% TP → close at $2.25.
  //
  // Pre-entry (potential): basis = current net mark (moves with prices). If a
  //   viewer were to enter RIGHT NOW at the live mark, this is the target
  //   close they'd watch for.
  // Post-entry (locked): basis = snapshot entry_net_debit. This is the fixed
  //   close target the daemon is watching for.
  const entered = entryNetDebit != null;
  const basisDebit = entered ? entryNetDebit : netDebit;

  if (basisDebit == null) {
    return null;
  }

  const isCredit = entryDirection === "credit";
  // profit_target_pct = 1.0 is the "hold to expiration / no PT" sentinel
  // (SPY 7d short puts). Rendering it as "TP 100% decay $0.00 locked"
  // reads as a broken field; show the intent instead.
  const holdToExpiration = profitTargetPct >= 1.0;

  // Tick grid differs by underlying. SPX/SPXW: $0.05 under $3, $0.10
  // above. SPY (penny pilot): $0.01 under $3, $0.05 above. Today credit
  // strategies are all SPY and debit strategies are all SPX, so
  // entry_direction is a reliable proxy. This coupling will need to be
  // formalized (e.g. an explicit underlying field on the spec) if a
  // credit SPX structure or a debit SPY structure ever joins the mix.
  const multiplier = isCredit ? 1 - profitTargetPct : 1 + profitTargetPct;
  const ptTarget = isCredit
    ? roundToSpyTick(basisDebit * multiplier)
    : roundToSpxTick(basisDebit * multiplier);
  const pctLabel = `${(profitTargetPct * 100).toFixed(0)}%`;
  const targetLabel = holdToExpiration
    ? "Hold to expiration"
    : isCredit
      ? `TP ${pctLabel} decay`
      : `TP ${pctLabel} close`;
  const statusLabel = entered ? "locked" : "potential";
  const statusColor = entered ? colors.accentGreen : colors.textSecondary;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        flexWrap: "wrap",
        fontFamily: fonts.mono,
        marginTop: -4,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: colors.textMuted,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          fontFamily: fonts.sans,
        }}
      >
        {targetLabel}
      </div>
      {!holdToExpiration && (
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>
          ${ptTarget.toFixed(2)}
        </div>
      )}
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: statusColor,
          background: statusColor + "18",
          border: `1px solid ${statusColor}40`,
          padding: "1px 5px",
          borderRadius: 4,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          fontFamily: fonts.sans,
        }}
      >
        {statusLabel}
      </div>
    </div>
  );
}

function TableHeader({ text, align }: { text: string; align: "left" | "right" }) {
  return (
    <div
      style={{
        fontSize: 9,
        color: colors.textMuted,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        fontFamily: fonts.sans,
        textAlign: align,
        borderBottom: `1px solid ${colors.borderDim}`,
        paddingBottom: 2,
      }}
    >
      {text}
    </div>
  );
}

function LegRow({ label, leg }: { label: string; leg: DCLegDetail }) {
  const actionColor = leg.action === "STO" ? colors.accentGreen : colors.accentRed; // green = credit side, red = debit side
  const currentStr = leg.mid != null ? leg.mid.toFixed(2) : "--";
  const entryStr = leg.entry_mid != null ? leg.entry_mid.toFixed(2) : "";
  const hasBoth = leg.mid != null && leg.entry_mid != null;
  const delta = hasBoth ? leg.mid! - leg.entry_mid! : null;

  // STO legs: positive delta = more credit = BETTER → green
  // BTO legs: positive delta = more debit = WORSE → red
  let deltaColor: string = colors.textSecondary;
  let deltaStr = "";
  if (delta != null) {
    if (delta === 0) {
      deltaColor = colors.textSecondary;
      deltaStr = "0.00";
    } else if (leg.action === "STO") {
      deltaColor = delta > 0 ? colors.accentGreen : colors.accentRed;
      deltaStr = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
    } else {
      deltaColor = delta > 0 ? colors.accentRed : colors.accentGreen;
      deltaStr = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
    }
  }

  return (
    <>
      <div style={{ color: colors.textPrimary, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
        <span>{label}</span>
        <span
          style={{
            fontSize: 8,
            fontWeight: 700,
            color: actionColor,
            padding: "1px 3px",
            borderRadius: 2,
            background: actionColor + "18",
            letterSpacing: 0.3,
          }}
        >
          {leg.action}
        </span>
        <span style={{ color: colors.textMuted }}>{leg.strike}</span>
      </div>
      <div style={{ color: colors.textSecondary, fontSize: 10 }}>{formatExpiry(leg.expiry)}</div>
      <div style={{ color: leg.mid != null ? colors.textPrimary : colors.textDim, textAlign: "right" }}>{currentStr}</div>
      <div style={{ color: leg.entry_mid != null ? colors.textSecondary : colors.textDim, textAlign: "right" }}>
        {entryStr || "—"}
      </div>
      <div style={{ color: deltaColor, textAlign: "right", fontWeight: 600 }}>{deltaStr}</div>
    </>
  );
}

function SLRatioLine({ slRatio, meetsMin }: { slRatio: number | null; meetsMin: boolean | null }) {
  if (slRatio == null) {
    return (
      <div style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.textDim }}>
        S/L: --
      </div>
    );
  }

  let color: string;
  let suffix = "";
  if (meetsMin === true) {
    color = colors.accentGreen;
    suffix = " PASS";
  } else if (meetsMin === false) {
    color = colors.accentRed;
    suffix = " FAIL";
  } else {
    color = colors.textSecondary; // no gate for this strategy
  }

  return (
    <div style={{ fontSize: 12, fontFamily: fonts.mono, fontWeight: 600, color }}>
      S/L: {slRatio.toFixed(3)}
      {suffix && (
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            marginLeft: 6,
            padding: "1px 5px",
            borderRadius: 4,
            background: color + "18",
            border: `1px solid ${color}40`,
            letterSpacing: 0.5,
          }}
        >
          {suffix}
        </span>
      )}
    </div>
  );
}
