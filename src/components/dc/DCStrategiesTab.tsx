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
import type { DCSignalsResponse, DCStrategyStats } from "../../api/dcTypes";
import { StrategyCatalogCard } from "./StrategyCatalogCard";

interface Props {
  stats: DCStrategyStats[];
  signals: DCSignalsResponse | null;
}

const FAMILY_ORDER = ["short_dte", "hybrid_fm", "long_dte"] as const;
const FAMILY_HEADERS: Record<string, string> = {
  short_dte: "Short DTE",
  hybrid_fm: "Hybrid Fri-Mon",
  long_dte: "Long DTE",
};

export function DCStrategiesTab({ stats, signals }: Props) {
  const { specs, loading, error } = useStrategySpecs();
  const subs = useSubscriptions();

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
      {/* Subscription summary */}
      <div
        style={{
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: 6,
          padding: "8px 12px",
          fontSize: 12,
          color: "#94a3b8",
          fontFamily: "Inter, sans-serif",
        }}
      >
        Subscribed to <span style={{ color: "#3b82f6", fontWeight: 600 }}>{subs.count}</span> of{" "}
        {specs.length} strategies. Subscribed strategies appear in the Signals tab as live monitors.
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
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
