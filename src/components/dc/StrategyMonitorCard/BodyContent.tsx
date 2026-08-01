/**
 * BodyContent — headline/subline body of a monitor card, driven by
 * the LifecycleInfo state machine. Each state has its own copy; the
 * shared <Body> primitive below handles layout + accent/large
 * variants. The gateSkipped prop overrides a handful of states when
 * S/L gate failed so the card doesn't misleadingly read "fired"
 * when the daemon actually bailed.
 */

import type { ReactNode } from "react";
import { colors, fonts } from "../../../styles/tokens";
import type { LifecycleInfo } from "../../../lib/dcLifecycle";
import { dowName, isRetiredNotTraded } from "../../../lib/dcLifecycle";
import type { DCStrategySpec } from "../../../api/dcTypes";
import { LiveCountdown } from "../LiveCountdown";

interface Props {
  spec: DCStrategySpec;
  signal: string | null;
  info: LifecycleInfo;
  formatTime: (hhmmET: string | null) => string;
  tzLabel: string;
  gateSkipped: boolean;
}

/** Renders the headline/subline body for a card, driven by lifecycle state.
 *  Each case delegates to the shared <Body> primitive. "gateSkipped" is
 *  set by the parent when S/L gate is FAILING — it overrides a handful
 *  of states to show "GATE FAIL" / "SKIPPED" copy instead of the
 *  default entered/firing copy, so viewers don't think the daemon
 *  entered when it actually bailed. */
export function BodyContent({ spec, signal, info, formatTime, tzLabel, gateSkipped }: Props) {
  // Broker-side fill failure: every signal-side gate cleared and the
  // daemon submitted the reprice ladder, but the broker didn't cross
  // (ladder exhausted / parked-no-fill). Lifecycle classifier still
  // routes this through firing / recently_fired / passed_will_fire
  // so the card stays highlighted for the 10-min post-entry window
  // — but the body copy must distinguish it from a real fill so the
  // operator isn't misled into thinking they hold a position.
  // Reason text comes from signal_events.outcome_reason via #277.
  const brokerNoFill = info.todayOutcome === "blocked_order";
  // DC entry retired (2026-08-01): the signal fired, we chose not to trade
  // it. These states are reached via shouldRenderAsFired, so the copy must
  // report a fired SIGNAL without implying an order was ever sent.
  const entriesDisabled = isRetiredNotTraded(info.todayOutcome ?? null);
  const noFillReason = info.todayOutcomeReason
    ?? "entry ladder exhausted with zero fills";

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
            info.nextEntryHHMM ? <>in <LiveCountdown targetHHMM={info.nextEntryHHMM} mode="until" /></> : ""
          }
          accent={colors.accentBlue}
        />
      );
    case "imminent":
      return (
        <Body
          headline={info.nextEntryHHMM ? `FIRES AT ${formatTime(info.nextEntryHHMM)} ${tzLabel}` : "FIRES IMMINENTLY"}
          subline={
            info.nextEntryHHMM ? <LiveCountdown targetHHMM={info.nextEntryHHMM} mode="until" /> : ""
          }
          accent={colors.accentAmber}
          large
        />
      );
    case "firing":
      return (
        <Body
          headline={entriesDisabled ? "SIGNAL FIRED" : "FIRING NOW"}
          subline={
            entriesDisabled
              ? "not traded — DC entry retired"
              : brokerNoFill
                ? <NoFillLine reason={noFillReason} />
                : formatTime(info.nextEntryHHMM ?? info.lastEntryHHMM)
          }
          accent={colors.accentGreen}
          large
        />
      );
    case "recently_fired":
      return gateSkipped ? (
        <Body
          headline={info.lastEntryHHMM ? `Skipped at ${formatTime(info.lastEntryHHMM)} ${tzLabel}` : "Skipped"}
          subline="S/L gate failed — daemon did not enter"
          accent={colors.accentRed}
        />
      ) : (
        <Body
          headline={
            entriesDisabled
              ? (info.lastEntryHHMM
                  ? `Signal fired at ${formatTime(info.lastEntryHHMM)} ${tzLabel}`
                  : "Signal fired")
              : info.lastEntryHHMM
                ? `Just fired at ${formatTime(info.lastEntryHHMM)} ${tzLabel}`
                : "Just fired"
          }
          // Broker-no-fill override: keep the green "fired" accent
          // (per operator request — don't gray out for an automation-
          // side failure), but replace the cheerful "signal was GO+"
          // subline with the no-fill reason so the operator can tell
          // a real fill apart from a ladder-exhausted attempt.
          subline={
            entriesDisabled
              ? <>{formatSignal(signal)} — not traded (DC entry retired)</>
              : brokerNoFill
                ? <NoFillLine reason={noFillReason} />
                : info.lastEntryHHMM
                  ? <><LiveCountdown targetHHMM={info.lastEntryHHMM} mode="since" /> ago — signal was {formatSignal(signal)}</>
                  : ""
          }
          accent={colors.accentGreen}
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
          accent={colors.accentRed}
        />
      ) : (
        <Body
          headline={
            entriesDisabled
              ? "Signal fired — not traded"
              : brokerNoFill
                ? "Fired — broker did not fill"
                : "Should have entered earlier"
          }
          subline={
            entriesDisabled
              ? (info.lastEntryHHMM
                  ? `${formatSignal(signal)} at ${formatTime(info.lastEntryHHMM)} ${tzLabel} — DC entry retired`
                  : `${formatSignal(signal)} — DC entry retired`)
              : brokerNoFill
                ? <NoFillLine reason={noFillReason} />
                : info.lastEntryHHMM
                  ? `Signal was ${formatSignal(signal)} at ${formatTime(info.lastEntryHHMM)} ${tzLabel}`
                  : `Signal was ${formatSignal(signal)} at fire time`
          }
          accent={colors.accentGreen}
        />
      );
    case "passed_skipped":
      return (
        <Body
          headline="No fire today"
          subline={
            // Prefer the daemon-authoritative reason from
            // signal_events.outcome_reason (#277) over the generic
            // "Signal was X at fire time" — operator sees the WHY
            // (e.g. "SL ratio 0.65 below 0.70 minimum") on hover.
            // Falls back to the legacy signal-only subline when the
            // API hasn't shipped #277 yet OR no entry evaluation
            // was recorded today (daemon down / not yet fired).
            info.todayOutcomeReason
              ? `${info.todayOutcomeReason} (${formatSignal(signal)})`
              : info.lastEntryHHMM
                ? `Signal was ${formatSignal(signal)} at ${formatTime(info.lastEntryHHMM)} ${tzLabel}`
                : `Signal was ${formatSignal(signal)} at fire time`
          }
          title={
            // Tooltip exposes the verbose-but-detailed combo for
            // operators who hover for context.
            info.todayOutcome
              ? `Daemon outcome: ${info.todayOutcome}${info.todayOutcomeReason ? ` — ${info.todayOutcomeReason}` : ""}`
              : undefined
          }
        />
      );
    case "not_fired_yet":
      return (
        <Body
          headline={`Watching — currently ${formatSignal(signal)}`}
          subline={
            info.nextEntryHHMM
              ? <>Next check: {formatTime(info.nextEntryHHMM)} {tzLabel} (<LiveCountdown targetHHMM={info.nextEntryHHMM} mode="until" />)</>
              : "Awaiting next entry window"
          }
        />
      );
    case "closed":
      return <Body headline="Closed for the day" subline="Resumes tomorrow if it's an entry day" />;
  }
}

/** Subline override for broker-no-fill (blocked_order). Renders an
 *  amber "NO FILL" pill + a NEUTRAL pointer so the operator drilling
 *  into a still-highlighted card can tell a real fill apart from a
 *  no-fill attempt — WITHOUT the raw broker-plumbing reason string
 *  cluttering this high-level anticipation surface. The verbose
 *  categorized detail (LADDER / PARKED, the full outcome_reason) lives
 *  in its purpose-built homes: the Events tab and the Tent tab's
 *  alpha-plays panel. The reason is still discoverable here on hover
 *  via the title tooltip.
 *
 *  Amber accent is reserved for the pill — the surrounding card stays
 *  green so the card itself remains visually "fired" per the operator
 *  feedback that automation-side failures should not gray out viewing.
 */
function NoFillLine({ reason }: { reason: string }) {
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      title={reason}
    >
      <span style={{
        fontSize: 9,
        fontFamily: fonts.mono,
        color: colors.accentAmber,
        background: "rgba(245, 158, 11, 0.12)",
        border: "1px solid rgba(245, 158, 11, 0.4)",
        borderRadius: 2,
        padding: "1px 5px",
        letterSpacing: 0.6,
        fontWeight: 600,
      }}>
        NO FILL
      </span>
      <span>broker did not fill — see Events</span>
    </span>
  );
}


function Body({
  headline,
  subline,
  accent,
  large,
  title,
}: {
  headline: string;
  subline?: ReactNode;
  accent?: string;
  large?: boolean;
  title?: string;
}) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 2 }}
      title={title}
    >
      <div
        style={{
          fontSize: large ? 18 : 13,
          fontWeight: large ? 700 : 600,
          color: accent ?? colors.textPrimary,
          fontFamily: fonts.sans,
          letterSpacing: large ? 0.5 : 0,
        }}
      >
        {headline}
      </div>
      {subline && (
        <div
          style={{
            fontSize: large ? 13 : 11,
            color: colors.textSecondary,
            fontFamily: fonts.mono,
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
