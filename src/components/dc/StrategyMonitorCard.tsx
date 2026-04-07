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

import type { DCStrategySpec } from "../../api/dcTypes";
import type { LifecycleInfo, LifecycleState } from "../../lib/dcLifecycle";
import { dowName, formatCountdown, formatEntryDays } from "../../lib/dcLifecycle";
import { SignalBadge } from "./SignalBadge";

interface Props {
  spec: DCStrategySpec;
  signal: string | null;
  info: LifecycleInfo;
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

export function StrategyMonitorCard({ spec, signal, info }: Props) {
  const style = STATE_STYLES[info.state];

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
          {STATE_LABELS[info.state]}
        </span>
      </div>

      {/* Body: state-driven copy */}
      <BodyContent spec={spec} signal={signal} info={info} />

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
        <span>{spec.entry_times.join(", ")} ET</span>
      </div>
    </div>
  );
}

function BodyContent({ spec, signal, info }: Props) {
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
          headline={`Fires at ${info.nextEntryHHMM} ET`}
          subline={
            info.secondsUntilNext != null ? `in ${formatCountdown(info.secondsUntilNext)}` : ""
          }
          accent="#3b82f6"
        />
      );
    case "imminent":
      return (
        <Body
          headline={`FIRES AT ${info.nextEntryHHMM} ET`}
          subline={
            info.secondsUntilNext != null ? formatCountdown(info.secondsUntilNext) : ""
          }
          accent="#f59e0b"
          large
        />
      );
    case "firing":
      return <Body headline="FIRING NOW" subline={info.nextEntryHHMM ?? info.lastEntryHHMM ?? ""} accent="#10b981" large />;
    case "recently_fired":
      return (
        <Body
          headline={`Just fired at ${info.lastEntryHHMM} ET`}
          subline={
            info.secondsSinceLast != null
              ? `${formatCountdown(info.secondsSinceLast)} ago — signal was ${formatSignal(signal)}`
              : ""
          }
          accent="#10b981"
        />
      );
    case "passed_will_fire":
      return (
        <Body
          headline="Should have entered earlier"
          subline={
            info.lastEntryHHMM
              ? `Signal was ${formatSignal(signal)} at ${info.lastEntryHHMM} ET`
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
              ? `Signal was ${formatSignal(signal)} at ${info.lastEntryHHMM} ET`
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
              ? `Next check: ${info.nextEntryHHMM} ET (${formatCountdown(info.secondsUntilNext)})`
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
