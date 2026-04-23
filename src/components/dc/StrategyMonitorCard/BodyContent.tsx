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
import { dowName } from "../../../lib/dcLifecycle";
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
      return <Body headline="FIRING NOW" subline={formatTime(info.nextEntryHHMM ?? info.lastEntryHHMM)} accent={colors.accentGreen} large />;
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
            info.lastEntryHHMM ? `Just fired at ${formatTime(info.lastEntryHHMM)} ${tzLabel}` : "Just fired"
          }
          subline={
            info.lastEntryHHMM
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
          headline="Should have entered earlier"
          subline={
            info.lastEntryHHMM
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

function Body({
  headline,
  subline,
  accent,
  large,
}: {
  headline: string;
  subline?: ReactNode;
  accent?: string;
  large?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
