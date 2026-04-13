/**
 * DCStrategiesTab — strategy catalog (browse + subscribe).
 *
 * Lists every DC strategy as a card with full specs and a subscribe
 * checkbox. Subscribed strategies appear in the Signals tab as live
 * monitors. Historical performance stats are shown in the card footer
 * when available, but the primary purpose of this tab is for new viewers
 * to discover the strategies and pick which ones to follow.
 *
 * Specs are fetched once via useStrategySpecs and cached in memory.
 * Signals provide the current per-strategy state for the badge.
 */

import { useStrategySpecs } from "../../hooks/useStrategySpecs";
import { useSubscriptions } from "../../hooks/useSubscriptions";
import { useTimezone } from "../../hooks/useTimezone";
import type { DCSignalsResponse, DCStrategyStats } from "../../api/dcTypes";
import { StrategyCatalogCard } from "./StrategyCatalogCard";

interface Props {
  stats: DCStrategyStats[];
  signals: DCSignalsResponse | null;
}

const FAMILY_ORDER = ["short_dte", "hybrid_fm", "long_dte", "spy_short_puts", "spy_straddles"] as const;
const FAMILY_HEADERS: Record<string, string> = {
  short_dte: "Short DTE",
  hybrid_fm: "Hybrid Fri-Mon",
  long_dte: "Long DTE",
  spy_short_puts: "SPY Short Puts",
  spy_straddles: "SPY Straddles",
};

export function DCStrategiesTab({ stats, signals }: Props) {
  const { specs, loading, error } = useStrategySpecs();
  const subs = useSubscriptions();
  const { formatTime, tzLabel } = useTimezone();

  if (loading) {
    return (
      <div className="fade-in" style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: 40 }}>
        Loading strategy catalog…
      </div>
    );
  }

  if (error || !specs) {
    return (
      <div className="fade-in" style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: 40 }}>
        Strategy catalog unavailable. Ensure the DC API is reachable.
      </div>
    );
  }

  const statsByName = new Map(stats.map((s) => [s.strategy_name, s]));
  const signalByName = new Map(
    (signals?.signals ?? []).map((s) => [s.strategy_name, s.signal] as const),
  );

  const grouped = new Map<string, typeof specs>();
  for (const spec of specs) {
    const list = grouped.get(spec.family) ?? [];
    list.push(spec);
    grouped.set(spec.family, list);
  }

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Subscription controls */}
      <div
        style={{
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: 6,
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          fontFamily: "Inter, sans-serif",
        }}
      >
        <span style={{ fontSize: 12, color: "#94a3b8" }}>
          Subscribed to <span style={{ color: "#3b82f6", fontWeight: 600 }}>{subs.count}</span> of{" "}
          {specs.length} strategies.
        </span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <SubButton
            label="All"
            onClick={() => subs.setAll(specs.map((s) => s.name))}
            active={subs.count === specs.length}
          />
          {FAMILY_ORDER.map((family) => {
            const familyNames = (grouped.get(family) ?? []).map((s) => s.name);
            if (familyNames.length === 0) return null;
            const allIn = familyNames.every((n) => subs.isSubscribed(n));
            return (
              <SubButton
                key={family}
                label={FAMILY_HEADERS[family]}
                onClick={() => {
                  if (allIn) {
                    // Unsubscribe this group (keep others)
                    const remaining = [...subs.subscribed].filter((n) => !familyNames.includes(n));
                    subs.setAll(remaining);
                  } else {
                    // Add this group to existing subscriptions
                    const merged = new Set([...subs.subscribed, ...familyNames]);
                    subs.setAll([...merged]);
                  }
                }}
                active={allIn}
              />
            );
          })}
          {subs.count > 0 && (
            <SubButton label="Clear" onClick={() => subs.setAll([])} active={false} muted />
          )}
        </div>
      </div>

      {FAMILY_ORDER.map((family) => {
        const list = grouped.get(family);
        if (!list || list.length === 0) return null;
        return (
          <section key={family} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 11,
                fontWeight: 600,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: 0.8,
                fontFamily: "Inter, sans-serif",
              }}
            >
              {FAMILY_HEADERS[family]} ({list.length})
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                gap: 10,
              }}
            >
              {list.map((spec) => (
                <StrategyCatalogCard
                  key={spec.name}
                  spec={spec}
                  signal={signalByName.get(spec.name) ?? null}
                  isSubscribed={subs.isSubscribed(spec.name)}
                  onToggle={() => subs.toggle(spec.name)}
                  stats={statsByName.get(spec.name) ?? null}
                  formatTime={formatTime}
                  tzLabel={tzLabel}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SubButton({
  label,
  onClick,
  active,
  muted,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  muted?: boolean;
}) {
  const color = muted ? "#64748b" : active ? "#10b981" : "#3b82f6";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 10,
        fontWeight: 600,
        color,
        background: active ? color + "18" : "transparent",
        border: `1px solid ${color}${active ? "60" : "40"}`,
        borderRadius: 4,
        padding: "3px 8px",
        cursor: "pointer",
        fontFamily: "Inter, sans-serif",
        letterSpacing: 0.3,
      }}
    >
      {active && !muted ? `${label} \u2713` : label}
    </button>
  );
}
