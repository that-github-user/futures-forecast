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
 *
 * Siblings (this folder):
 *   styles.ts            — STATE_STYLES + STATE_LABELS (lifecycle theming)
 *   BodyContent.tsx      — state-driven headline/subline switch + <Body>
 *   LegDetailBlock.tsx   — net-debit + leg table + S/L footer + IV badge
 *   SuggestedRow.tsx     — capital-allocation sizing recommendation
 */

import { memo } from "react";
import { colors, fonts } from "../../../styles/tokens";
import type {
  DCAllocationPolicy,
  DCPosition,
  DCStrategySpec,
} from "../../../api/dcTypes";
import type { LifecycleInfo } from "../../../lib/dcLifecycle";
import { formatEntryDays } from "../../../lib/dcLifecycle";
import { SignalBadge } from "../SignalBadge";
import { BodyContent } from "./BodyContent";
import { isActiveLifecycleState, LegDetailBlock } from "./LegDetailBlock";
import { shouldShowSuggested, SuggestedRow } from "./SuggestedRow";
import { STATE_LABELS, STATE_STYLES } from "./styles";
import type { LegData } from "./types";

// Re-export LegData so external consumers can keep importing it via
// `from "./StrategyMonitorCard"` (resolved through this index) without
// reaching into the internal sibling layout.
export type { LegData };

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

/** Card memoization — skip re-rendering when only transient time fields
 *  (`info.secondsUntilNext`, `info.secondsSinceLast`) changed. The parent
 *  DCSignalsTab ticks at 1Hz so those fields update every second, but the
 *  live countdown text lives inside `<LiveCountdown>` which has its own
 *  tick — the rest of the card only needs to reconcile on actual state
 *  transitions or payload changes. Fields compared structurally are the
 *  ones that actually drive styling and copy; everything else is reference
 *  compared (spec/legData/formatTime/tzLabel/policy are memoized by
 *  their hook owners, so reference equality is the right check). */
function propsEqual(prev: Props, next: Props): boolean {
  if (prev.spec !== next.spec) return false;
  if (prev.signal !== next.signal) return false;
  if (prev.legData !== next.legData) return false;
  if (prev.formatTime !== next.formatTime) return false;
  if (prev.tzLabel !== next.tzLabel) return false;
  if (prev.policy !== next.policy) return false;
  if (prev.portfolioSize !== next.portfolioSize) return false;
  if (prev.currentDalMult !== next.currentDalMult) return false;
  if (prev.openPositions !== next.openPositions) return false;
  const a = prev.info, b = next.info;
  if (a.state !== b.state) return false;
  if (a.windowKind !== b.windowKind) return false;
  if (a.nextEntryHHMM !== b.nextEntryHHMM) return false;
  if (a.lastEntryHHMM !== b.lastEntryHHMM) return false;
  if (a.isArmed !== b.isArmed) return false;
  if (a.firesToday !== b.firesToday) return false;
  if (a.nextEntryDow !== b.nextEntryDow) return false;
  // info.secondsUntilNext / secondsSinceLast deliberately ignored.
  return true;
}

function StrategyMonitorCardImpl({
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
              color: colors.textPrimary,
              fontFamily: fonts.sans,
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
            color: style.border === colors.borderDim ? colors.textMuted : style.border,
            border: `1px solid ${style.border}`,
            padding: "2px 6px",
            borderRadius: 6,
            fontFamily: fonts.sans,
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
          color: colors.textMuted,
          fontFamily: fonts.mono,
          borderTop: `1px solid ${colors.borderDim}`,
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

export const StrategyMonitorCard = memo(StrategyMonitorCardImpl, propsEqual);
