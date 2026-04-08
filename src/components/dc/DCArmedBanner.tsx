/**
 * DCArmedBanner — sticky banner that appears when subscribed strategies
 * are imminent or firing. Click to jump to the Signals tab.
 *
 * Hidden when no subscribed strategies are in the imminent/firing window.
 * Drives its own 1s tick so it stays accurate even when the user is on a
 * different tab (e.g., Positions or Strategies).
 */

import { useMemo } from "react";
import type { DCSignalsResponse } from "../../api/dcTypes";
import { useStrategySpecs } from "../../hooks/useStrategySpecs";
import { useSubscriptions } from "../../hooks/useSubscriptions";
import { useTick } from "../../hooks/useTick";
import { deriveLifecycle, formatCountdown } from "../../lib/dcLifecycle";

interface Props {
  signals: DCSignalsResponse | null;
  onClickJumpToSignals: () => void;
}

export function DCArmedBanner({ signals, onClickJumpToSignals }: Props) {
  const { specs } = useStrategySpecs();
  const subs = useSubscriptions();
  const nowMs = useTick(1000);

  const armed = useMemo(() => {
    if (!specs) return [];
    const now = new Date(nowMs);
    const featuresStale = signals?.features_stale ?? true;
    const signalByName = new Map<string, string>();
    for (const s of signals?.signals ?? []) signalByName.set(s.strategy_name, s.signal);

    const out: Array<{ name: string; state: string; secondsUntilNext: number | null; nextHHMM: string | null; signal: string | null }> = [];
    for (const spec of specs) {
      if (!subs.isSubscribed(spec.name)) continue;
      const signal = signalByName.get(spec.name) ?? null;
      const info = deriveLifecycle(spec, signal, featuresStale, now);
      if (info.state === "imminent" || info.state === "firing") {
        out.push({
          name: spec.name,
          state: info.state,
          secondsUntilNext: info.secondsUntilNext,
          nextHHMM: info.nextEntryHHMM,
          signal,
        });
      }
    }
    return out;
  }, [specs, subs, signals, nowMs]);

  if (armed.length === 0) return null;

  return (
    <button
      type="button"
      onClick={onClickJumpToSignals}
      aria-label={`${armed.length} subscribed strategies are armed — jump to Signals tab`}
      style={{
        background: "linear-gradient(90deg, #f59e0b18 0%, #f59e0b08 100%)",
        border: "1px solid #f59e0b66",
        borderRadius: 6,
        padding: "10px 14px",
        margin: "8px 12px 0",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        cursor: "pointer",
        fontFamily: "Inter, sans-serif",
        boxShadow: "0 0 12px #f59e0b22",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        width: "calc(100% - 24px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#f59e0b",
            background: "#f59e0b18",
            border: "1px solid #f59e0b66",
            padding: "2px 8px",
            borderRadius: 10,
            letterSpacing: 0.8,
          }}
        >
          ARMED
        </span>
        <span style={{ fontSize: 12, color: "#e2e8f0", fontFamily: "JetBrains Mono, monospace" }}>
          {armed
            .map((r) => {
              const tail =
                r.state === "firing"
                  ? "FIRING"
                  : r.secondsUntilNext != null
                    ? `in ${formatCountdown(r.secondsUntilNext)}`
                    : "imminent";
              return `${r.name} ${tail}`;
            })
            .join("  •  ")}
        </span>
      </div>
      <span style={{ fontSize: 11, color: "#94a3b8" }}>View Signals →</span>
    </button>
  );
}
