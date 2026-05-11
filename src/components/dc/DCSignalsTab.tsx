/**
 * DCSignalsTab — live monitor for subscribed DC strategies.
 *
 * Renders a StrategyMonitorCard for each subscribed strategy with
 * lifecycle-aware visuals (faded → primed → imminent → firing → recently
 * fired → passed → closed). Drives a 1s tick to keep countdowns live, and
 * fires browser notifications when subscribed strategies transition into
 * the imminent or firing windows.
 *
 * Below the monitor grid, the existing market features grid is preserved
 * as helpful context (ATR, BB, RSI, VIX regime, etc.).
 */

import { useEffect, useMemo, useRef } from "react";
import type {
  DCLegDetail,
  DCPosition,
  DCSignalsResponse,
  DCSnapshotInfo,
  DCStrategySpec,
  DCStrategyStats,
  LegName,
  PolicyKey,
} from "../../api/dcTypes";
import { useCapitalAllocation } from "../../hooks/useCapitalAllocation";
import { useCapitalSummary } from "../../hooks/useCapitalSummary";
import { useStrategySpecs } from "../../hooks/useStrategySpecs";
import { useSubscriptions } from "../../hooks/useSubscriptions";
import { useNotifications } from "../../hooks/useNotifications";
import { useTick } from "../../hooks/useTick";
import { useTimezone, type TZOption } from "../../hooks/useTimezone";
import { deriveLifecycle, daysUntilDow, type LifecycleInfo, type LifecycleState } from "../../lib/dcLifecycle";
import { colors, fonts, withAlpha, withAlphaByte } from "../../styles/tokens";
import { StrategyMonitorCard, type LegData } from "./StrategyMonitorCard";

interface Props {
  signals: DCSignalsResponse | null;
  strategies?: DCStrategyStats[];
  positions?: DCPosition[];
}

// Sort key — lower is more important / shown first.
const STATE_PRIORITY: Record<LifecycleState, number> = {
  firing: 0,
  imminent: 1,
  recently_fired: 2,
  primed: 3,
  not_fired_yet: 4,
  pre_features: 5,
  passed_will_fire: 6,
  passed_skipped: 7,
  inactive: 8,
  closed: 9,
};

export function DCSignalsTab({ signals, strategies = [], positions = [] }: Props) {
  const { specs, loading: specsLoading } = useStrategySpecs();
  const subs = useSubscriptions();
  const notifications = useNotifications();
  const nowMs = useTick(1000);
  const timezone = useTimezone();
  const now = useMemo(() => new Date(nowMs), [nowMs]);

  // Capital allocation inputs — driven by localStorage and a one-shot fetch
  // of the policies catalog from /dc-api/v1/capital/summary.
  const capital = useCapitalAllocation();
  const { findPolicy } = useCapitalSummary();
  const selectedPolicy = findPolicy(capital.policyKey);
  // Per-strategy D'Alembert multiplier lookup (from DCStrategyStats).
  const dalMultByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of strategies) m.set(s.strategy_name, s.current_mult);
    return m;
  }, [strategies]);

  const signalByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of signals?.signals ?? []) m.set(s.strategy_name, s.signal);
    return m;
  }, [signals]);

  // Signals-derived half of the per-strategy display bundle. The monitors loop
  // below overlays the spec-derived fields (profitTargetPct, usesSlRatio) to
  // form the full LegData.
  type LegDataBase = Omit<LegData, "profitTargetPct" | "usesSlRatio" | "entryDirection">;
  const legDataByName = useMemo(() => {
    const m = new Map<string, LegDataBase>();
    for (const s of signals?.signals ?? []) {
      m.set(s.strategy_name, {
        slRatio: s.sl_ratio ?? null,
        slRatioMeetsMin: s.sl_ratio_meets_min ?? null,
        legs: (s.legs ?? null) as Record<LegName, DCLegDetail> | null,
        netDebit: s.net_debit ?? null,
        entryNetDebit: s.entry_net_debit ?? null,
        snapshot: (s.snapshot ?? null) as DCSnapshotInfo | null,
        ivSource: s.iv_source ?? null,
        // Phase 3 live-tick fidelity surface (PR follow-up to #149).
        slRatioSource: s.sl_ratio_source ?? null,
        lastTickAgeMs: s.last_tick_age_ms ?? null,
        preEntryWindowActive: s.pre_entry_window_active ?? false,
        // Phase 4: shared response timestamp for client-side age recompute.
        responseComputedAt: signals?.computed_at ?? null,
      });
    }
    return m;
  }, [signals]);

  const featuresStale = signals?.features_stale ?? true;

  // Build the list of {spec, signal, info, legData} for subscribed strategies only.
  const monitors = useMemo(() => {
    if (!specs) return [];
    const list: Array<{
      spec: DCStrategySpec;
      signal: string | null;
      info: LifecycleInfo;
      legData: LegData;
    }> = [];
    for (const spec of specs) {
      if (!subs.isSubscribed(spec.name)) continue;
      const signal = signalByName.get(spec.name) ?? null;
      const info = deriveLifecycle(spec, signal, featuresStale, now);
      // Start from the signals-derived bundle (may be missing if no data yet),
      // then overlay per-strategy constants from the spec (profit target,
      // whether the strategy actually uses S/L as a criterion).
      const base = legDataByName.get(spec.name);
      const legData: LegData = {
        slRatio: base?.slRatio ?? null,
        slRatioMeetsMin: base?.slRatioMeetsMin ?? null,
        legs: base?.legs ?? null,
        netDebit: base?.netDebit ?? null,
        entryNetDebit: base?.entryNetDebit ?? null,
        snapshot: base?.snapshot ?? null,
        profitTargetPct: spec.profit_target_pct,
        usesSlRatio: spec.sl_ratio_min != null || spec.sl_ratio_exit != null,
        ivSource: base?.ivSource ?? null,
        slRatioSource: base?.slRatioSource ?? null,
        lastTickAgeMs: base?.lastTickAgeMs ?? null,
        preEntryWindowActive: base?.preEntryWindowActive ?? false,
        // Envelope timestamp is shared across all strategies in
        // the same /signals response; surfaced per-leg for the
        // LIVE-badge client-side age recompute. Falls back to
        // null on older daemons → badge shows static
        // server-computed lastTickAgeMs.
        responseComputedAt: signals?.computed_at ?? null,
        entryDirection: spec.entry_direction,
      };
      list.push({ spec, signal, info, legData });
    }
    // Sort: state priority → days until next entry → first entry time → name.
    // This ensures that after close, tomorrow's strategies sort above later days.
    const etParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
    }).formatToParts(new Date(nowMs));
    const weekdayStr = etParts.find((p) => p.type === "weekday")?.value ?? "Mon";
    const DOW_MAP: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    const currentDow = DOW_MAP[weekdayStr] ?? 0;

    list.sort((a, b) => {
      const pa = STATE_PRIORITY[a.info.state];
      const pb = STATE_PRIORITY[b.info.state];
      if (pa !== pb) return pa - pb;
      // Days until next entry (0 for active-today strategies, 1-7 for inactive/closed)
      const da = a.info.nextEntryDow === currentDow ? 0 : daysUntilDow(currentDow, a.info.nextEntryDow);
      const db = b.info.nextEntryDow === currentDow ? 0 : daysUntilDow(currentDow, b.info.nextEntryDow);
      if (da !== db) return da - db;
      // Within the same day: earlier entry time first
      const ta = a.spec.entry_times[0] ?? "";
      const tb = b.spec.entry_times[0] ?? "";
      if (ta !== tb) return ta.localeCompare(tb);
      return a.spec.name.localeCompare(b.spec.name);
    });
    return list;
  }, [specs, subs, signalByName, legDataByName, featuresStale, now]);

  // Compact projection of the fields that actually drive notification
  // transitions — (name, state). `monitors` itself gets a new reference
  // every 1s tick (deriveLifecycle returns fresh objects), which would
  // cause the notification effect below to run 60× per minute. Depending
  // on this projection instead means the effect only re-runs when a
  // strategy actually transitions into or out of a lifecycle state.
  //
  // The effect's body still reads `monitors` via closure for per-row
  // details (HH:MM target, S/L ratio, legData). That's safe: when the
  // projection changes, React reruns the effect with the freshly-rendered
  // `monitors`; when it doesn't change, the details would be identical
  // anyway.
  const monitorTransitionKey = useMemo(
    () => monitors.map((m) => `${m.spec.name}:${m.info.state}`).join("|"),
    [monitors],
  );

  // Detect lifecycle transitions to fire notifications. The first effect run
  // after mount is treated as a "seed pass" — we record the current state of
  // every subscribed strategy without firing notifications, so a tab remount
  // during an imminent window doesn't spam alerts for strategies that were
  // already imminent before we started watching.
  const lastStatesRef = useRef<Map<string, LifecycleState>>(new Map());
  const seededRef = useRef(false);
  useEffect(() => {
    const last = lastStatesRef.current;
    if (!seededRef.current) {
      for (const { spec, info } of monitors) last.set(spec.name, info.state);
      seededRef.current = true;
      return;
    }
    for (const { spec, info, legData } of monitors) {
      const prev = last.get(spec.name);
      const next = info.state;
      if (prev !== next) {
        // Build S/L gate suffix for the notification body so group members
        // know whether the entry criteria are actually passing or failing.
        const { slRatio, slRatioMeetsMin, usesSlRatio } = legData;
        let slSuffix = "";
        if (usesSlRatio && slRatio != null) {
          const gate = slRatioMeetsMin === true ? " PASS" : slRatioMeetsMin === false ? " FAIL" : "";
          slSuffix = ` — S/L: ${slRatio.toFixed(3)}${gate}`;
        }

        if (next === "imminent") {
          const key = `${spec.name}|${info.nextEntryHHMM ?? ""}|imminent`;
          notifications.notify(
            key,
            `${spec.name} is imminent`,
            `Fires at ${info.nextEntryHHMM ?? "—"} ET${slSuffix}`,
          );
        } else if (next === "firing") {
          const key = `${spec.name}|${info.nextEntryHHMM ?? info.lastEntryHHMM ?? ""}|firing`;
          notifications.notify(key, `${spec.name} is firing now`, slSuffix ? slSuffix.slice(3) : undefined);
        }
        last.set(spec.name, next);
      }
    }
    // `monitors` is read intentionally via closure; depending on
    // `monitorTransitionKey` is the whole point of the projection above.
    // (The rationale lives here as a block above the directive because
    // `eslint-disable-next-line` targets the immediately-following line,
    // and trailing `//` continuation lines would shield the real deps
    // line — defeating the suppression.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitorTransitionKey, notifications]);

  if (specsLoading) {
    return (
      <div className="fade-in" style={{ color: colors.textMuted, fontSize: 13, textAlign: "center", padding: 40 }}>
        Loading strategy catalog…
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header: subscription count + notification permission */}
      <div
        style={{
          background: colors.bgInset,
          border: `1px solid ${colors.borderDim}`,
          borderRadius: 6,
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          fontFamily: fonts.sans,
        }}
      >
        <span style={{ fontSize: 12, color: colors.textSecondary }}>
          Monitoring{" "}
          <span style={{ color: colors.accentBlue, fontWeight: 600 }}>{monitors.length}</span> strategies
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Portfolio + policy selectors only make sense when the user has
              opted into policy-driven sizing on the Capital tab. Hiding them
              when useCapitalForSignals is false avoids inviting the user to
              tune knobs that don't do anything here. */}
          {capital.useCapitalForSignals && (
            <>
              <PortfolioInput
                value={capital.portfolioSize}
                onChange={capital.setPortfolioSize}
              />
              <PolicySelector
                value={capital.policyKey}
                onChange={capital.setPolicy}
                policies={findPolicy}
              />
            </>
          )}
          <TimezoneSelector tz={timezone.tz} setTz={timezone.setTz} />
          <NotificationControl
            permission={notifications.permission}
            onRequest={notifications.requestPermission}
          />
        </div>
      </div>

      {/* Monitor cards */}
      {monitors.length === 0 ? (
        <div style={{ color: colors.textSecondary, fontSize: 13, textAlign: "center", padding: 40, background: colors.bgInset, border: `1px solid ${colors.borderDim}`, borderRadius: 6 }}>
          No strategies subscribed yet.
          <br />
          <span style={{ color: colors.textMuted, fontSize: 12 }}>
            Visit the Strategies tab and check the strategies you want to monitor.
          </span>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 10,
          }}
        >
          {monitors.map(({ spec, signal, info, legData }) => (
            <StrategyMonitorCard
              key={spec.name}
              spec={spec}
              signal={signal}
              info={info}
              legData={legData}
              formatTime={timezone.formatTime}
              tzLabel={timezone.tzLabel}
              policy={capital.useCapitalForSignals ? selectedPolicy : null}
              portfolioSize={capital.useCapitalForSignals ? capital.portfolioSize : undefined}
              currentDalMult={dalMultByName.get(spec.name) ?? 1}
              openPositions={positions}
            />
          ))}
        </div>
      )}

      {/* Market features context */}
      {signals?.features && (
        <div className="panel" style={{ padding: 12, marginTop: 8 }}>
          <div className="panel-header" style={{ marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
            <span className="panel-title">Market Features</span>
            {(signals.features.computed_date || signals.features.feature_date) && (
              <span
                style={{
                  fontSize: 11,
                  fontFamily: fonts.mono,
                  color: featuresStale ? colors.accentAmber : colors.textMuted,
                }}
                // The prior-day bar date is the causal-lag input — not a
                // staleness indicator. Surface it in the tooltip so the
                // context is available without cluttering the header.
                title={
                  signals.features.feature_date
                    ? `Causal features computed from ${signals.features.feature_date} close`
                    : undefined
                }
              >
                {featuresStale ? "STALE " : "As of "}
                {signals.features.computed_date || signals.features.feature_date}
              </span>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
            {/*
              Daemon already emits atr_pct / gap_pct / return_5d / vix_pctile in
              percentage points (0..100 scale, computed as `value / base * 100`
              in core/features.py). Display them as-is — do NOT multiply again.
            */}
            <FeatureCard
              label="ATR %"
              value={signals.features.atr_pct != null ? `${signals.features.atr_pct.toFixed(2)}%` : "—"}
            />
            <FeatureCard
              label="Gap %"
              value={signals.features.gap_pct != null ? `${signals.features.gap_pct.toFixed(2)}%` : "—"}
            />
            <FeatureCard
              label="BB Position"
              value={signals.features.bb_position != null ? signals.features.bb_position.toFixed(3) : "—"}
            />
            <FeatureCard
              label="RSI 14"
              value={signals.features.rsi_14 != null ? signals.features.rsi_14.toFixed(1) : "—"}
            />
            <FeatureCard
              label="Return 5D"
              value={signals.features.return_5d != null ? `${signals.features.return_5d.toFixed(2)}%` : "—"}
            />
            <FeatureCard
              label="VIX"
              value={signals.features.vix_close != null ? signals.features.vix_close.toFixed(2) : "—"}
            />
            <FeatureCard
              label="VIX %ile"
              value={signals.features.vix_pctile != null ? `${signals.features.vix_pctile.toFixed(0)}%` : "—"}
            />
            <FeatureCard
              label="Vol Regime"
              value={signals.features.vol_regime != null ? `R${signals.features.vol_regime}` : "—"}
            />
            <FeatureCard
              label="VIX/VIX3M"
              value={signals.features.vix_vix3m_ratio != null ? signals.features.vix_vix3m_ratio.toFixed(3) : "—"}
            />
            <FeatureCard
              label="VIX Chg %"
              value={signals.features.vix_change_pct != null ? `${signals.features.vix_change_pct.toFixed(2)}%` : "—"}
            />
            <FeatureCard
              label="Return 20D"
              value={signals.features.return_20d != null ? `${signals.features.return_20d.toFixed(2)}%` : "—"}
            />
            <FeatureCard
              label="Trend Score"
              value={signals.features.trend_score != null ? `${signals.features.trend_score.toFixed(0)}/4` : "—"}
            />
            <FeatureCard
              label="Px vs SMA50"
              value={signals.features.price_vs_sma50_pct != null ? `${signals.features.price_vs_sma50_pct.toFixed(2)}%` : "—"}
            />
            <FeatureCard
              label="Consec Days"
              value={signals.features.consecutive_days != null ? `${signals.features.consecutive_days > 0 ? "+" : ""}${signals.features.consecutive_days.toFixed(0)}` : "—"}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const TZ_OPTIONS: TZOption[] = ["ET", "CT", "MT", "PT", "local"];

function TimezoneSelector({ tz, setTz }: { tz: TZOption; setTz: (t: TZOption) => void }) {
  return (
    <select
      value={tz}
      onChange={(e) => setTz(e.target.value as TZOption)}
      style={{
        fontSize: 10,
        fontWeight: 600,
        fontFamily: fonts.sans,
        color: colors.textSecondary,
        background: colors.borderDim,
        border: `1px solid ${colors.borderMid}`,
        borderRadius: 4,
        padding: "3px 6px",
        cursor: "pointer",
      }}
    >
      {TZ_OPTIONS.map((o) => (
        <option key={o} value={o}>
          {o === "local" ? "Local" : o}
        </option>
      ))}
    </select>
  );
}

function NotificationControl({
  permission,
  onRequest,
}: {
  permission: ReturnType<typeof useNotifications>["permission"];
  onRequest: () => Promise<unknown>;
}) {
  if (permission === "unsupported") {
    return (
      <span style={{ fontSize: 11, color: colors.textMuted }}>
        Browser notifications not supported
      </span>
    );
  }
  if (permission === "needs-install") {
    // Safari iOS in a regular tab. The Notification API doesn't exist
    // here, but iOS exposes it once the site is installed as a PWA.
    // Surface the exact 3-tap path rather than dead-ending on a
    // generic "not supported" that would leave iPhone users stuck.
    return (
      <span
        title={
          "On iPhone/iPad Safari, tap the Share button (square with up-arrow), " +
          "scroll to 'Add to Home Screen', then launch this site from the new " +
          "Home Screen icon. Notifications will be available once you re-open " +
          "it that way."
        }
        style={{
          fontSize: 11,
          color: colors.accentAmber,
          cursor: "help",
          // 0x60 (96) — preserved exactly; 0.4 rounds to 0x66 and drifts.
          borderBottom: `1px dashed ${withAlphaByte(colors.accentAmber, 0x60)}`,
        }}
      >
        Tap Share → Add to Home Screen to enable alerts
      </span>
    );
  }
  if (permission === "granted") {
    return (
      <span style={{ fontSize: 11, color: colors.accentGreen }}>
        Desktop alerts enabled
      </span>
    );
  }
  if (permission === "denied") {
    return (
      <span style={{ fontSize: 11, color: colors.accentRed }}>
        Desktop alerts blocked (enable in browser settings)
      </span>
    );
  }
  return (
    <button
      onClick={onRequest}
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: colors.accentBlue,
        background: withAlphaByte(colors.accentBlue, 0x18),
        border: `1px solid ${withAlpha(colors.accentBlue, 0.25)}`,
        borderRadius: 6,
        padding: "4px 10px",
        cursor: "pointer",
        fontFamily: fonts.sans,
      }}
    >
      Enable desktop alerts
    </button>
  );
}

function FeatureCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: colors.bgPanel, border: `1px solid ${colors.borderDim}`, borderRadius: 6, padding: "8px 10px" }}>
      <div
        style={{
          fontSize: 9,
          color: colors.textMuted,
          fontFamily: fonts.sans,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          fontFamily: fonts.mono,
          color: colors.textPrimary,
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capital allocation header controls
// ---------------------------------------------------------------------------

function PortfolioInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        fontWeight: 600,
        color: colors.textSecondary,
        fontFamily: fonts.sans,
      }}
    >
      Portfolio
      <span style={{ color: colors.textMuted, marginLeft: 2 }}>$</span>
      <input
        type="number"
        min={1000}
        max={100_000_000}
        step={5000}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={{
          fontSize: 11,
          fontFamily: fonts.mono,
          color: colors.textPrimary,
          background: colors.borderDim,
          border: `1px solid ${colors.borderMid}`,
          borderRadius: 4,
          padding: "3px 6px",
          width: 90,
        }}
      />
    </label>
  );
}

const POLICY_LABEL: Record<PolicyKey, string> = {
  take_all: "Take-all",
  rec_60_10: "Recommended 60/10",
  cons_40_8: "Stricter 40/8",
  cop_cons_60_10: "Cop-Con 60/10",
  static_1ct: "Static 1 ct (baseline)",
};

function PolicySelector({
  value,
  onChange,
  policies,
}: {
  value: PolicyKey;
  onChange: (k: PolicyKey) => void;
  policies: (k: PolicyKey) => import("../../api/dcTypes").DCAllocationPolicy | null;
}) {
  const current = policies(value);
  const tooltip = !current
    ? undefined
    : current.backtest
    ? `${current.name} — backtest PF ${current.backtest.pf.toFixed(2)} / MaxDD ${current.backtest.max_dd_pct.toFixed(1)}% / $${(current.backtest.terminal_equity / 1e6).toFixed(1)}M at ${current.backtest.years}y from $${(current.backtest.start_equity / 1e3).toFixed(0)}K`
    : `${current.name} — baseline (no backtest). Always enters 1 contract.`;
  return (
    <select
      title={tooltip}
      value={value}
      onChange={(e) => onChange(e.target.value as PolicyKey)}
      style={{
        fontSize: 10,
        fontWeight: 600,
        fontFamily: fonts.sans,
        color: colors.textSecondary,
        background: colors.borderDim,
        border: `1px solid ${colors.borderMid}`,
        borderRadius: 4,
        padding: "3px 6px",
        cursor: "pointer",
      }}
    >
      {(Object.keys(POLICY_LABEL) as PolicyKey[])
        // Hide reference-only policies (take_all) — they render on the
        // Capital tab chart as overlays, not as selectable live policies.
        .filter((k) => !policies(k)?.reference_only)
        .map((k) => (
        <option key={k} value={k}>
          {POLICY_LABEL[k]}
        </option>
      ))}
    </select>
  );
}
