/**
 * StrategyMonitorCard — one subscribed strategy in the live Signals view.
 *
 * Visual treatment is driven entirely by the LifecycleInfo state machine
 * derived in lib/dcLifecycle.ts. Each state has its own copy and styling:
 *
 *   inactive          → faded, "Next entry day: Mon"
 *   pre_features      → normal, "Awaiting 9:32 AM features…"
 *   primed            → normal, signal badge + countdown
 *   imminent          → glow + large countdown
 *   firing            → strongest highlight, "FIRING NOW"
 *   recently_fired    → glow + "Just fired"
 *   passed_will_fire  → subdued, "Should have entered…"
 *   passed_skipped    → subdued, "No fire today (SKIP at entry)"
 *   not_fired_yet     → normal, "Watching — currently SKIP"
 *   closed            → fully faded, "Closed for the day"
 */

import type {
  DCAllocationPolicy,
  DCLegDetail,
  DCPosition,
  DCSnapshotInfo,
  DCStrategySpec,
  LegName,
} from "../../api/dcTypes";
import type { LifecycleInfo, LifecycleState } from "../../lib/dcLifecycle";
import { dowName, formatCountdown, formatEntryDays, formatExpiry } from "../../lib/dcLifecycle";
import { roundToSpxTick } from "../../lib/spxTick";
import {
  computeSizingBreakdown,
  computeSuggestedContracts,
  formatMarginUsage,
  SPX_MULTIPLIER,
} from "../../lib/dcSizing";
import { SignalBadge } from "./SignalBadge";

export interface LegData {
  slRatio: number | null;
  slRatioMeetsMin: boolean | null;
  legs: Record<LegName, DCLegDetail> | null;
  netDebit: number | null;
  entryNetDebit: number | null;
  snapshot: DCSnapshotInfo | null;
  profitTargetPct: number;  // from strategy spec — used to compute $ TP from net debit
  usesSlRatio: boolean;     // true if the daemon gates entry or exit on S/L — hides ratio display when false
  // Which IV anchor the daemon's last resolve used. Badge surfaces
  // near the Net Debit header so a silent fallback to VIX (the
  // pre-fix path that caused the 21/28 strike incident) is visible
  // without digging through logs. Null when no resolve has happened.
  ivSource: "chain" | "vix" | "default" | null;
}

interface Props {
  spec: DCStrategySpec;
  signal: string | null;
  info: LifecycleInfo;
  legData: LegData;
  formatTime: (hhmmET: string | null) => string;
  tzLabel: string;
  // Capital-allocation inputs (optional — cards still render without them).
  // Drives the "Suggested: N cts" row rendered before BodyContent.
  policy?: DCAllocationPolicy | null;
  portfolioSize?: number;
  currentDalMult?: number;       // from DCStrategyStats.current_mult for this strategy
  openPositions?: DCPosition[];  // for margin-budget math
}

interface StyleSet {
  border: string;
  background: string;
  opacity: number;
  glow: string;
}

const STATE_STYLES: Record<LifecycleState, StyleSet> = {
  inactive: {
    border: "#1e293b",
    background: "#0d1320",
    opacity: 0.4,
    glow: "none",
  },
  pre_features: {
    border: "#1e293b",
    background: "#111827",
    opacity: 0.85,
    glow: "none",
  },
  primed: {
    border: "#3b82f680",
    background: "#111827",
    opacity: 1,
    glow: "0 0 0 1px #3b82f640",
  },
  imminent: {
    border: "#f59e0b",
    background: "#1c1607",
    opacity: 1,
    glow: "0 0 12px #f59e0b66, 0 0 0 1px #f59e0b80",
  },
  firing: {
    border: "#10b981",
    background: "#062019",
    opacity: 1,
    glow: "0 0 18px #10b98199, 0 0 0 2px #10b981cc",
  },
  recently_fired: {
    border: "#10b98180",
    background: "#0a1814",
    opacity: 0.95,
    glow: "0 0 8px #10b98144",
  },
  passed_will_fire: {
    border: "#10b98140",
    background: "#0c1612",
    opacity: 0.7,
    glow: "none",
  },
  passed_skipped: {
    border: "#1e293b",
    background: "#10131c",
    opacity: 0.55,
    glow: "none",
  },
  not_fired_yet: {
    border: "#1e293b",
    background: "#111827",
    opacity: 0.85,
    glow: "none",
  },
  closed: {
    border: "#1e293b",
    background: "#0a0e17",
    opacity: 0.25,
    glow: "none",
  },
};

const STATE_LABELS: Record<LifecycleState, string> = {
  inactive: "INACTIVE",
  pre_features: "AWAITING FEATURES",
  primed: "PRIMED",
  imminent: "IMMINENT",
  firing: "FIRING",
  recently_fired: "JUST FIRED",
  passed_will_fire: "FIRED EARLIER",
  passed_skipped: "NO FIRE",
  not_fired_yet: "WATCHING",
  closed: "CLOSED",
};

export function StrategyMonitorCard({
  spec,
  signal,
  info,
  legData,
  formatTime,
  tzLabel,
  policy,
  portfolioSize,
  currentDalMult,
  openPositions,
}: Props) {
  // When the S/L gate is FAILING, override the visual so viewers don't think
  // the daemon entered. Before entry: "GATE FAIL". After entry: "SKIPPED".
  const slGateFailing =
    legData.usesSlRatio &&
    legData.slRatioMeetsMin === false &&
    (info.state === "imminent" || info.state === "firing" ||
     info.state === "recently_fired" || info.state === "passed_will_fire");

  const effectiveStyle = slGateFailing ? STATE_STYLES["not_fired_yet"] : STATE_STYLES[info.state];
  const effectiveLabel = slGateFailing
    ? (info.state === "recently_fired" || info.state === "passed_will_fire") ? "SKIPPED" : "GATE FAIL"
    : STATE_LABELS[info.state];
  const style = effectiveStyle;

  return (
    <div
      style={{
        background: style.background,
        border: `1px solid ${style.border}`,
        borderRadius: 8,
        padding: 14,
        opacity: style.opacity,
        boxShadow: style.glow,
        transition: "opacity 200ms, box-shadow 300ms",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Header: name + signal badge + state chip */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#e2e8f0",
              fontFamily: "Inter, sans-serif",
            }}
          >
            {spec.name}
          </span>
          <SignalBadge signal={signal} />
        </div>
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            color: style.border === "#1e293b" ? "#64748b" : style.border,
            border: `1px solid ${style.border}`,
            padding: "2px 6px",
            borderRadius: 6,
            fontFamily: "Inter, sans-serif",
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}
        >
          {effectiveLabel}
        </span>
      </div>

      {/* Suggested contracts row (capital allocation). Hidden when the
          capital-allocation context isn't plumbed in by the caller, or when
          the lifecycle state doesn't warrant it (no point showing a size
          recommendation on a strategy that's INACTIVE all day). */}
      {policy && portfolioSize != null && shouldShowSuggested(info.state, signal) && (
        <SuggestedRow
          spec={spec}
          signal={signal}
          policy={policy}
          portfolioSize={portfolioSize}
          currentDalMult={currentDalMult ?? 1}
          openPositions={openPositions ?? []}
          legData={legData}
        />
      )}

      {/* Body: state-driven copy */}
      <BodyContent spec={spec} signal={signal} info={info} formatTime={formatTime} tzLabel={tzLabel} gateSkipped={slGateFailing} />

      {/* Leg detail — net debit header + 4-leg table + S/L footer.
          Shown for all active entry-day states (incl. passed_* so late-joiners
          can still see snapshot drift after the entry time has passed). */}
      {isActiveLifecycleState(info.state) && <LegDetailBlock legData={legData} />}

      {/* Footer: entry days + times reference */}
      <div
        style={{
          fontSize: 10,
          color: "#64748b",
          fontFamily: "JetBrains Mono, monospace",
          borderTop: "1px solid #1e293b",
          paddingTop: 6,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{formatEntryDays(spec.entry_days)}</span>
        <span>{spec.entry_times.map(formatTime).join(", ")} {tzLabel}</span>
      </div>
    </div>
  );
}

function BodyContent({ spec, signal, info, formatTime, tzLabel, gateSkipped }: Pick<Props, "spec" | "signal" | "info" | "formatTime" | "tzLabel"> & { gateSkipped: boolean }) {
  switch (info.state) {
    case "inactive":
      return (
        <Body
          headline={`Next entry day: ${spec.entry_days.map(dowName).join(", ")}`}
          subline="Not firing today"
        />
      );
    case "pre_features":
      return (
        <Body
          headline="Awaiting 9:32 AM features…"
          subline="Signal will resolve after the daemon refreshes"
        />
      );
    case "primed":
      return (
        <Body
          headline={info.nextEntryHHMM ? `Fires at ${formatTime(info.nextEntryHHMM)} ${tzLabel}` : "Fires today"}
          subline={
            info.secondsUntilNext != null ? `in ${formatCountdown(info.secondsUntilNext)}` : ""
          }
          accent="#3b82f6"
        />
      );
    case "imminent":
      return (
        <Body
          headline={info.nextEntryHHMM ? `FIRES AT ${formatTime(info.nextEntryHHMM)} ${tzLabel}` : "FIRES IMMINENTLY"}
          subline={
            info.secondsUntilNext != null ? formatCountdown(info.secondsUntilNext) : ""
          }
          accent="#f59e0b"
          large
        />
      );
    case "firing":
      return <Body headline="FIRING NOW" subline={formatTime(info.nextEntryHHMM ?? info.lastEntryHHMM)} accent="#10b981" large />;
    case "recently_fired":
      return gateSkipped ? (
        <Body
          headline={info.lastEntryHHMM ? `Skipped at ${formatTime(info.lastEntryHHMM)} ${tzLabel}` : "Skipped"}
          subline="S/L gate failed — daemon did not enter"
          accent="#ef4444"
        />
      ) : (
        <Body
          headline={
            info.lastEntryHHMM ? `Just fired at ${formatTime(info.lastEntryHHMM)} ${tzLabel}` : "Just fired"
          }
          subline={
            info.secondsSinceLast != null
              ? `${formatCountdown(info.secondsSinceLast)} ago — signal was ${formatSignal(signal)}`
              : ""
          }
          accent="#10b981"
        />
      );
    case "passed_will_fire":
      return gateSkipped ? (
        <Body
          headline="Skipped — S/L gate failed"
          subline={
            info.lastEntryHHMM
              ? `Entry was at ${formatTime(info.lastEntryHHMM)} ${tzLabel} but gate was not met`
              : "S/L gate was not met at entry time"
          }
          accent="#ef4444"
        />
      ) : (
        <Body
          headline="Should have entered earlier"
          subline={
            info.lastEntryHHMM
              ? `Signal was ${formatSignal(signal)} at ${formatTime(info.lastEntryHHMM)} ${tzLabel}`
              : `Signal was ${formatSignal(signal)} at fire time`
          }
          accent="#10b981"
        />
      );
    case "passed_skipped":
      return (
        <Body
          headline="No fire today"
          subline={
            info.lastEntryHHMM
              ? `Signal was ${formatSignal(signal)} at ${formatTime(info.lastEntryHHMM)} ${tzLabel}`
              : `Signal was ${formatSignal(signal)} at fire time`
          }
        />
      );
    case "not_fired_yet":
      return (
        <Body
          headline={`Watching — currently ${formatSignal(signal)}`}
          subline={
            info.nextEntryHHMM && info.secondsUntilNext != null
              ? `Next check: ${formatTime(info.nextEntryHHMM)} ${tzLabel} (${formatCountdown(info.secondsUntilNext)})`
              : "Awaiting next entry window"
          }
        />
      );
    case "closed":
      return <Body headline="Closed for the day" subline="Resumes tomorrow if it's an entry day" />;
  }
}

function Body({
  headline,
  subline,
  accent,
  large,
}: {
  headline: string;
  subline?: string;
  accent?: string;
  large?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div
        style={{
          fontSize: large ? 18 : 13,
          fontWeight: large ? 700 : 600,
          color: accent ?? "#e2e8f0",
          fontFamily: "Inter, sans-serif",
          letterSpacing: large ? 0.5 : 0,
        }}
      >
        {headline}
      </div>
      {subline && (
        <div
          style={{
            fontSize: large ? 13 : 11,
            color: "#94a3b8",
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          {subline}
        </div>
      )}
    </div>
  );
}

function formatSignal(signal: string | null): string {
  if (!signal) return "—";
  return signal.replace("_", "+");
}

function SLRatioLine({ slRatio, meetsMin }: { slRatio: number | null; meetsMin: boolean | null }) {
  if (slRatio == null) {
    return (
      <div style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#475569" }}>
        S/L: --
      </div>
    );
  }

  let color: string;
  let suffix = "";
  if (meetsMin === true) {
    color = "#10b981";
    suffix = " PASS";
  } else if (meetsMin === false) {
    color = "#ef4444";
    suffix = " FAIL";
  } else {
    color = "#94a3b8"; // no gate for this strategy
  }

  return (
    <div style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", fontWeight: 600, color }}>
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

const ACTIVE_STATES = new Set<LifecycleState>([
  "primed",
  "imminent",
  "firing",
  "recently_fired",
  "not_fired_yet",
  "passed_will_fire",
  "passed_skipped",
]);

function isActiveLifecycleState(state: LifecycleState): boolean {
  return ACTIVE_STATES.has(state);
}

const LEG_ORDER: LegName[] = ["front_put", "front_call", "back_put", "back_call"];
const LEG_LABELS: Record<LegName, string> = {
  front_put: "Front P",
  front_call: "Front C",
  back_put: "Back P",
  back_call: "Back C",
};

function LegDetailBlock({ legData }: { legData: LegData }) {
  const { legs, netDebit, entryNetDebit, snapshot, slRatio, slRatioMeetsMin, profitTargetPct, usesSlRatio, ivSource } = legData;

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
      />
      <ProfitTargetLine
        netDebit={netDebit}
        entryNetDebit={entryNetDebit}
        profitTargetPct={profitTargetPct}
      />

      {/* Leg table */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto 1fr 1fr 1fr",
          gap: "3px 8px",
          fontSize: 11,
          fontFamily: "JetBrains Mono, monospace",
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
}: {
  netDebit: number | null;
  entryNetDebit: number | null;
  snapshotTime: string | null;
  ivSource: "chain" | "vix" | "default" | null;
}) {
  if (netDebit == null) {
    // Review N1: after a daemon restart the SL worker resolves legs
    // (ivSource populated) before the first ratio poll produces
    // netDebit. Render a minimal header anyway so the IV-anchor
    // badge is visible during that window — exactly when an operator
    // may be watching for the fix to engage after a restart.
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: 10,
                    fontSize: 12, color: "#64748b",
                    fontFamily: "JetBrains Mono, monospace" }}>
        <span>Debit: --</span>
        <IVSourceBadge source={ivSource} />
      </div>
    );
  }

  const hasSnapshot = entryNetDebit != null;
  const delta = hasSnapshot ? netDebit - entryNetDebit : null;
  // Net debit: positive delta = more expensive → red. Negative delta = cheaper → green.
  const deltaColor = delta == null ? "#94a3b8" : delta > 0 ? "#ef4444" : delta < 0 ? "#10b981" : "#94a3b8";
  const deltaStr = delta == null ? "" : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        flexWrap: "wrap",
        fontFamily: "JetBrains Mono, monospace",
      }}
    >
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "Inter, sans-serif" }}>
        Net Debit
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: "#e2e8f0" }}>
        ${netDebit.toFixed(2)}
      </div>
      {hasSnapshot && (
        <div style={{ fontSize: 10, color: "#64748b", display: "flex", alignItems: "baseline", gap: 4 }}>
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
          bg: "rgba(16, 185, 129, 0.12)",
          border: "rgba(16, 185, 129, 0.45)",
          color: "#10b981",
          title: "BS inverter is using live chain-sampled ATM IV — the fix is engaged for this strategy.",
        };
      case "vix":
        return {
          label: "IV vix",
          bg: "rgba(245, 158, 11, 0.14)",
          border: "rgba(245, 158, 11, 0.45)",
          color: "#f59e0b",
          title: "BS inverter fell back to VIX-scaled IV — the chain sample failed. Strikes may drift from market 20Δ; investigate if persistent.",
        };
      case "default":
        return {
          label: "IV default",
          bg: "rgba(239, 68, 68, 0.14)",
          border: "rgba(239, 68, 68, 0.45)",
          color: "#ef4444",
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
        fontFamily: "Inter, sans-serif",
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
}: {
  netDebit: number | null;
  entryNetDebit: number | null;
  profitTargetPct: number;
}) {
  // Debit DC profit = spread widening. Target close value = basis × (1 + pct).
  // e.g. entry $11.90 + 40% TP → close at $16.66.
  //
  // Pre-entry (potential): basis = current net debit (moves with prices). If a
  //   viewer were to enter RIGHT NOW at the live debit, this is the target
  //   close they'd watch for.
  // Post-entry (locked): basis = snapshot entry_net_debit. This is the fixed
  //   close target the daemon is watching for.
  const entered = entryNetDebit != null;
  const basisDebit = entered ? entryNetDebit : netDebit;

  if (basisDebit == null) {
    return null;
  }

  // SPX/SPXW options trade in $0.10 tick increments above $3 ($0.05
  // below). The raw math basis × (1 + pct) usually lands off-tick —
  // e.g. $9.40 × 1.30 = $12.22 but a TP order would submit at $12.20.
  // Round to the tick grid the broker actually accepts so the UI shows
  // exactly what the daemon would put on the broker ticket.
  const ptTarget = roundToSpxTick(basisDebit * (1 + profitTargetPct));
  const pctLabel = `${(profitTargetPct * 100).toFixed(0)}%`;
  const statusLabel = entered ? "locked" : "potential";
  const statusColor = entered ? "#10b981" : "#94a3b8";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        flexWrap: "wrap",
        fontFamily: "JetBrains Mono, monospace",
        marginTop: -4,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "#64748b",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          fontFamily: "Inter, sans-serif",
        }}
      >
        TP {pctLabel} close
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>
        ${ptTarget.toFixed(2)}
      </div>
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
          fontFamily: "Inter, sans-serif",
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
        color: "#64748b",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        fontFamily: "Inter, sans-serif",
        textAlign: align,
        borderBottom: "1px solid #1e293b",
        paddingBottom: 2,
      }}
    >
      {text}
    </div>
  );
}

function LegRow({ label, leg }: { label: string; leg: DCLegDetail }) {
  const actionColor = leg.action === "STO" ? "#10b981" : "#ef4444"; // green = credit side, red = debit side
  const currentStr = leg.mid != null ? leg.mid.toFixed(2) : "--";
  const entryStr = leg.entry_mid != null ? leg.entry_mid.toFixed(2) : "";
  const hasBoth = leg.mid != null && leg.entry_mid != null;
  const delta = hasBoth ? leg.mid! - leg.entry_mid! : null;

  // STO legs: positive delta = more credit = BETTER → green
  // BTO legs: positive delta = more debit = WORSE → red
  let deltaColor = "#94a3b8";
  let deltaStr = "";
  if (delta != null) {
    if (delta === 0) {
      deltaColor = "#94a3b8";
      deltaStr = "0.00";
    } else if (leg.action === "STO") {
      deltaColor = delta > 0 ? "#10b981" : "#ef4444";
      deltaStr = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
    } else {
      deltaColor = delta > 0 ? "#ef4444" : "#10b981";
      deltaStr = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
    }
  }

  return (
    <>
      <div style={{ color: "#e2e8f0", display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
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
        <span style={{ color: "#64748b" }}>{leg.strike}</span>
      </div>
      <div style={{ color: "#94a3b8", fontSize: 10 }}>{formatExpiry(leg.expiry)}</div>
      <div style={{ color: leg.mid != null ? "#e2e8f0" : "#475569", textAlign: "right" }}>{currentStr}</div>
      <div style={{ color: leg.entry_mid != null ? "#94a3b8" : "#475569", textAlign: "right" }}>
        {entryStr || "—"}
      </div>
      <div style={{ color: deltaColor, textAlign: "right", fontWeight: 600 }}>{deltaStr}</div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Suggested contracts row (capital allocation)
// ---------------------------------------------------------------------------

function shouldShowSuggested(state: LifecycleState, signal: string | null): boolean {
  // Hide when there's no meaningful GO/GO+ signal — no point recommending a
  // size on a SKIP. Also hide when the lifecycle state is fully inactive
  // (not firing today) or closed (already fired / exited).
  const activeEnough =
    state === "primed" ||
    state === "imminent" ||
    state === "firing" ||
    state === "recently_fired" ||
    state === "passed_will_fire";
  const hasGoSignal = signal === "GO" || signal === "GO_PLUS";
  return activeEnough && hasGoSignal;
}

function SuggestedRow({
  spec,
  signal,
  policy,
  portfolioSize,
  currentDalMult,
  openPositions,
  legData,
}: {
  spec: DCStrategySpec;
  signal: string | null;
  policy: DCAllocationPolicy;
  portfolioSize: number;
  currentDalMult: number;
  openPositions: DCPosition[];
  legData: LegData;
}) {
  const sizedSignal: "GO" | "GO_PLUS" = signal === "GO_PLUS" ? "GO_PLUS" : "GO";
  // Prefer the live entry debit from the snapshot when present — more accurate
  // than spec.avg_margin. Falls back to spec.avg_margin inside the helper.
  const liveDebit = legData.snapshot?.net_debit ?? legData.netDebit ?? null;
  const marginPerContract =
    liveDebit != null ? liveDebit * SPX_MULTIPLIER : (spec.avg_margin ?? null);

  const result = computeSuggestedContracts({
    spec,
    signal: sizedSignal,
    portfolioSize,
    policy,
    currentDalMult,
    openPositions,
    marginPerContract,
  });

  // Color treatment:
  //   green  — sized ok
  //   amber  — sized but margin-trimmed or hard-capped
  //   red    — skipped
  const zero = result.finalContracts === 0;
  const trimmed = !zero && (result.marginTrimmed || result.hardCapped);
  const color = zero ? "#ef4444" : trimmed ? "#f59e0b" : "#10b981";
  const bg = color + "14";
  const border = color + "40";

  const breakdown = computeSizingBreakdown(result, sizedSignal);
  const marginLine = formatMarginUsage(result);

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        padding: "6px 8px",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 11,
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ color, fontWeight: 700 }}>
          {zero
            ? `Suggested: skip — ${result.reasonIfZero ?? "over budget"}`
            : `Suggested: ${result.finalContracts} cts`}
        </span>
        {!zero && (
          <span style={{ color: "#64748b", fontSize: 10 }}>{breakdown}</span>
        )}
      </div>
      {!zero && (
        <div style={{ color: "#64748b", fontSize: 10 }}>
          {trimmed && (
            <span style={{ color: "#f59e0b", marginRight: 6 }}>
              {result.marginTrimmed
                ? `trimmed from ${result.goPlusContracts} (margin cap)`
                : `capped from ${result.goPlusContracts} (hard cap)`}
            </span>
          )}
          {marginLine}
        </div>
      )}
    </div>
  );
}
