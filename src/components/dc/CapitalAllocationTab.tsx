/**
 * CapitalAllocationTab — dashboards the vega-prime research (CAPITAL_ALLOCATION.md).
 *
 * Four panels (order matters — reactive panels up top, static reference at bottom):
 *   A. PolicyPicker      — 4 validated policies + static_1ct baseline
 *   B. SizingGrid        — per-strategy contract counts at the user's capital
 *   C. CompoundingChart  — §10 Monte Carlo growth projection + jittered sample paths
 *   D. EVRankingPanel    — §4 EV/margin-day capital efficiency (reference, static)
 *
 * The allocation math is the same ``lib/dcSizing.ts`` used by StrategyMonitorCard's
 * Suggested row, so the Sizing Grid shows the exact numbers a live entry would
 * produce at each capital level.
 */

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";

import type {
  DCAllocationPolicy,
  DCCompoundingCurve,
  DCEVRankingRow,
  DCPosition,
  DCStrategySpec,
  PolicyKey,
} from "../../api/dcTypes";
import { useCapitalAllocation } from "../../hooks/useCapitalAllocation";
import { useCapitalSummary } from "../../hooks/useCapitalSummary";
import { useStrategySpecs } from "../../hooks/useStrategySpecs";
import { computeSuggestedContracts, SPX_MULTIPLIER } from "../../lib/dcSizing";
import { samplePaths } from "../../lib/dcPathSim";

interface Props {
  positions: DCPosition[];
}

export function CapitalAllocationTab({ positions }: Props) {
  const capital = useCapitalAllocation();
  const { summary, loading } = useCapitalSummary();
  const { specs } = useStrategySpecs();

  if (loading) {
    return (
      <div style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: 40 }}>
        Loading Capital Allocation research…
      </div>
    );
  }
  if (!summary) {
    return (
      <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: 40 }}>
        DC API unavailable — Capital Allocation research requires the daemon to be online.
      </div>
    );
  }

  const selectedPolicy = summary.policies.find((p) => p.key === capital.policyKey) ?? summary.policies[0];
  const selectedCurve =
    summary.compounding_curves[capital.policyKey] ??
    (Object.values(summary.compounding_curves)[0] as typeof summary.compounding_curves[PolicyKey] | undefined);
  if (!selectedPolicy || !selectedCurve) {
    return (
      <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: 40 }}>
        Capital Allocation payload is missing policy or curve data. Check the DC API's /capital/summary endpoint.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Sticky header: portfolio input + Apply-to-Signals toggle (drives every panel below) */}
      <HeaderBand
        portfolioSize={capital.portfolioSize}
        onPortfolioChange={capital.setPortfolioSize}
        policyKey={capital.policyKey}
        useCapitalForSignals={capital.useCapitalForSignals}
        onToggleUseForSignals={capital.setUseCapitalForSignals}
        source={summary.source}
      />

      {/* Panel A — pick a policy (reactive) */}
      <PolicyPicker
        policies={summary.policies}
        selectedKey={capital.policyKey}
        onSelect={capital.setPolicy}
        portfolioSize={capital.portfolioSize}
      />

      {/* Panel B — per-strategy sizing grid (reactive to policy + portfolio size) */}
      <SizingGrid
        specs={specs ?? []}
        policy={selectedPolicy}
        portfolioSize={capital.portfolioSize}
        positions={positions}
      />

      {/* Panel C — compounding projection (reactive to policy + portfolio size + jittered paths) */}
      <CompoundingChart
        curve={selectedCurve}
        policy={selectedPolicy}
        portfolioSize={capital.portfolioSize}
      />

      {/* Panel D — static EV reference (not affected by user's choice; parked at bottom) */}
      <EVRankingPanel rows={summary.ev_ranking} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function HeaderBand({
  portfolioSize,
  onPortfolioChange,
  policyKey,
  useCapitalForSignals,
  onToggleUseForSignals,
  source,
}: {
  portfolioSize: number;
  onPortfolioChange: (v: number) => void;
  policyKey: PolicyKey;
  useCapitalForSignals: boolean;
  onToggleUseForSignals: (v: boolean) => void;
  source: string;
}) {
  return (
    <div
      style={{
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: 6,
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        fontFamily: "Inter, sans-serif",
      }}
    >
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#94a3b8" }}>
        Portfolio size
        <span style={{ color: "#64748b" }}>$</span>
        <input
          type="number"
          min={1000}
          max={100_000_000}
          step={5000}
          value={portfolioSize}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onPortfolioChange(n);
          }}
          style={{
            fontSize: 13,
            fontFamily: "JetBrains Mono, monospace",
            color: "#e2e8f0",
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 4,
            padding: "4px 8px",
            width: 120,
          }}
        />
      </label>
      <span style={{ fontSize: 11, color: "#64748b" }}>
        Policy: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{POLICY_SHORT[policyKey]}</span>
      </span>

      {/* Type II opt-in: the user deliberately enables policy-driven sizing on the
          Signals tab. Default off — Signals stays in "raw-signal" display mode
          until the user makes a conscious choice here. */}
      <ApplyToSignalsToggle
        value={useCapitalForSignals}
        onChange={onToggleUseForSignals}
      />

      <span style={{ fontSize: 10, color: "#475569", marginLeft: "auto", fontStyle: "italic" }}>
        Source: {source}
      </span>
    </div>
  );
}

function ApplyToSignalsToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const track = value ? "#10b981" : "#334155";
  const knob = value ? "translateX(16px)" : "translateX(0)";
  const subtitle = value
    ? "Signals cards will show Suggested: N cts based on the selected policy"
    : "Signals cards show the daemon's raw signals only";
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      title={subtitle}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        fontFamily: "Inter, sans-serif",
      }}
      aria-pressed={value}
    >
      <span style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>Apply to Signals</span>
      <span
        style={{
          position: "relative",
          display: "inline-block",
          width: 34,
          height: 18,
          borderRadius: 9,
          background: track,
          transition: "background 150ms",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: 2,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#f8fafc",
            transform: knob,
            transition: "transform 150ms",
          }}
        />
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: value ? "#10b981" : "#64748b",
          letterSpacing: 0.5,
        }}
      >
        {value ? "ON" : "OFF"}
      </span>
    </button>
  );
}

const POLICY_SHORT: Record<PolicyKey, string> = {
  take_all: "Take-all",
  rec_60_10: "Recommended 60/10",
  cons_40_8: "Stricter 40/8",
  cop_cons_60_10: "Cop-Con 60/10",
  static_1ct: "Static 1 ct (baseline)",
};

// ---------------------------------------------------------------------------
// Panel A — PolicyPicker
// ---------------------------------------------------------------------------

function PolicyPicker({
  policies,
  selectedKey,
  onSelect,
  portfolioSize,
}: {
  policies: DCAllocationPolicy[];
  selectedKey: PolicyKey;
  onSelect: (k: PolicyKey) => void;
  portfolioSize: number;
}) {
  return (
    <Panel title="Allocation Policy" subtitle="Four validated combinations — pick one">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 10,
        }}
      >
        {policies.map((p) => (
          <PolicyCard
            key={p.key}
            policy={p}
            selected={p.key === selectedKey}
            onClick={() => onSelect(p.key)}
            portfolioSize={portfolioSize}
          />
        ))}
      </div>
    </Panel>
  );
}

function PolicyCard({
  policy,
  selected,
  onClick,
  portfolioSize,
}: {
  policy: DCAllocationPolicy;
  selected: boolean;
  onClick: () => void;
  portfolioSize: number;
}) {
  const color = selected ? "#3b82f6" : policy.recommended ? "#10b981" : "#334155";
  const isBaseline = policy.backtest === null;
  return (
    <button
      onClick={onClick}
      style={{
        background: selected ? "#1e293b" : "#0f172a",
        border: `2px solid ${color}`,
        borderRadius: 8,
        padding: 12,
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "Inter, sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{policy.name}</span>
        {policy.recommended && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "#10b981",
              background: "#10b98118",
              border: "1px solid #10b98140",
              borderRadius: 4,
              padding: "1px 5px",
              letterSpacing: 0.5,
            }}
          >
            REC
          </span>
        )}
        {isBaseline && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "#64748b",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 4,
              padding: "1px 5px",
              letterSpacing: 0.5,
            }}
          >
            BASELINE
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.4 }}>{policy.description}</div>
      {isBaseline ? (
        <>
          <div
            style={{
              fontSize: 11,
              color: "#64748b",
              fontStyle: "italic",
              fontFamily: "JetBrains Mono, monospace",
              marginTop: 4,
            }}
          >
            Baseline — no backtest applies
          </div>
          <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>
            Every entry: 1 contract regardless of capital or streak
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 6,
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 11,
              marginTop: 4,
            }}
          >
            <Stat
              label="Terminal"
              value={`$${formatCompact(policy.backtest!.terminal_equity * (portfolioSize / policy.backtest!.start_equity))}`}
              color="#e2e8f0"
            />
            <Stat label="PF" value={policy.backtest!.pf.toFixed(2)} />
            <Stat label="MaxDD" value={`${policy.backtest!.max_dd_pct.toFixed(1)}%`} />
          </div>
          <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>
            {policy.monte_carlo
              ? `MC median $${formatCompact(policy.monte_carlo.median * (portfolioSize / policy.backtest!.start_equity))} (${policy.backtest!.years}y from $${formatCompact(portfolioSize)})`
              : `${policy.backtest!.years}y from $${formatCompact(portfolioSize)} · MC not documented`}
          </div>
        </>
      )}
    </button>
  );
}

function Stat({ label, value, color = "#94a3b8" }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "Inter, sans-serif" }}>
        {label}
      </div>
      <div style={{ color, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel B — SizingGrid
// ---------------------------------------------------------------------------

function SizingGrid({
  specs,
  policy,
  portfolioSize,
  positions,
}: {
  specs: DCStrategySpec[];
  policy: DCAllocationPolicy;
  portfolioSize: number;
  positions: DCPosition[];
}) {
  // Only DC strategies (filter out SPY — not validated for the tab yet) that have avg_margin.
  const rows = useMemo(() => {
    const dcSpecs = specs.filter((s) => s.avg_margin != null && !s.family.startsWith("spy"));
    // Sort by margin ascending — cheapest first, matches §6 table.
    dcSpecs.sort((a, b) => (a.avg_margin ?? 0) - (b.avg_margin ?? 0));
    return dcSpecs.map((spec) => {
      const go = computeSuggestedContracts({
        spec,
        signal: "GO",
        portfolioSize,
        policy,
        currentDalMult: 1,
        openPositions: positions,
        marginPerContract: (spec.avg_margin ?? 0),
      });
      const dalCap = computeSuggestedContracts({
        spec,
        signal: "GO",
        portfolioSize,
        policy,
        currentDalMult: policy.dal_cap,
        openPositions: positions,
        marginPerContract: (spec.avg_margin ?? 0),
      });
      const goPlus = computeSuggestedContracts({
        spec,
        signal: "GO_PLUS",
        portfolioSize,
        policy,
        currentDalMult: 1,
        openPositions: positions,
        marginPerContract: (spec.avg_margin ?? 0),
      });
      return { spec, go, dalCap, goPlus };
    });
  }, [specs, policy, portfolioSize, positions]);

  const globalCap = portfolioSize * (policy.global_pct / 100);
  const stratCap = portfolioSize * (policy.per_strat_pct / 100);

  return (
    <Panel
      title="Per-Strategy Sizing Grid"
      subtitle={`At $${formatCompact(portfolioSize)}, ${policy.base_pct}% base allocation, ${policy.global_pct}% / ${policy.per_strat_pct}% caps`}
    >
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 12,
            color: "#e2e8f0",
          }}
        >
          <thead>
            <tr style={{ color: "#64748b", textAlign: "right" }}>
              <th style={{ textAlign: "left", padding: 6 }}>Strategy</th>
              <th style={{ padding: 6 }}>Margin / ct</th>
              <th style={{ padding: 6 }}>Base (DAl=1)</th>
              <th style={{ padding: 6 }}>DAl={policy.dal_cap}</th>
              <th style={{ padding: 6 }}>GO+ (DAl=1)</th>
              <th style={{ padding: 6 }}>Per-strat cap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ spec, go, dalCap, goPlus }) => {
              const maxAtCap = Math.floor(stratCap / (spec.avg_margin ?? 1));
              const capBinding = dalCap.marginTrimmed || dalCap.hardCapped;
              return (
                <tr key={spec.name} style={{ borderTop: "1px solid #1e293b" }}>
                  <td style={{ textAlign: "left", padding: 6, color: "#e2e8f0" }}>{spec.name}</td>
                  <td style={{ textAlign: "right", padding: 6 }}>${spec.avg_margin?.toFixed(0)}</td>
                  <td style={{ textAlign: "right", padding: 6 }}>{go.finalContracts}</td>
                  <td style={{ textAlign: "right", padding: 6, color: capBinding ? "#f59e0b" : "#e2e8f0" }}>
                    {dalCap.finalContracts}
                  </td>
                  <td style={{ textAlign: "right", padding: 6, color: "#10b981" }}>{goPlus.finalContracts}</td>
                  <td style={{ textAlign: "right", padding: 6, color: "#64748b" }}>
                    {maxAtCap} cts (${formatCompact(maxAtCap * (spec.avg_margin ?? 0))})
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "1px solid #334155", color: "#64748b" }}>
              <td colSpan={6} style={{ padding: 8 }}>
                Global cap: ${formatCompact(globalCap)} ({policy.global_pct}% of ${formatCompact(portfolioSize)})
                &middot; hard cap {policy.hard_cap} contracts/entry
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Panel C — EV/Margin-Day Ranking
// ---------------------------------------------------------------------------

function EVRankingPanel({ rows }: { rows: DCEVRankingRow[] }) {
  if (rows.length === 0) {
    return (
      <Panel
        title="Capital Efficiency — EV per Margin-Day"
        subtitle="No ranking data available"
      >
        <div style={{ color: "#64748b", fontSize: 12, padding: 20, textAlign: "center" }}>
          EV ranking unavailable — daemon may be offline.
        </div>
      </Panel>
    );
  }
  const maxEv = Math.max(...rows.map((r) => r.ev_mg_day));

  const chartOption = useMemo(
    () => ({
      grid: { left: 90, right: 40, top: 20, bottom: 20 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "#0f172a",
        borderColor: "#1e293b",
        textStyle: { color: "#e2e8f0", fontSize: 11 },
      },
      xAxis: {
        type: "value",
        axisLabel: { color: "#64748b", fontSize: 10, formatter: (v: number) => `$${v.toFixed(3)}` },
        splitLine: { lineStyle: { color: "#1e293b" } },
      },
      yAxis: {
        type: "category",
        data: [...rows].reverse().map((r) => r.strategy),
        axisLabel: { color: "#94a3b8", fontSize: 11, fontFamily: "JetBrains Mono, monospace" },
        axisLine: { lineStyle: { color: "#334155" } },
      },
      series: [
        {
          type: "bar",
          data: [...rows].reverse().map((r) => ({
            value: r.ev_mg_day,
            itemStyle: { color: r.ev_mg_day > maxEv / 2 ? "#10b981" : "#3b82f6" },
          })),
          barWidth: "65%",
          label: {
            show: true,
            position: "right",
            color: "#e2e8f0",
            fontSize: 10,
            formatter: (p: { value: number }) => `$${p.value.toFixed(4)}`,
          },
        },
      ],
    }),
    [rows, maxEv],
  );

  return (
    <Panel
      title="Capital Efficiency — EV per Margin-Day"
      subtitle="Expected dollars of profit per dollar of margin per day held (CAPITAL_ALLOCATION.md §4)"
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "#e2e8f0" }}>
            <thead>
              <tr style={{ color: "#64748b", textAlign: "right" }}>
                <th style={{ textAlign: "left", padding: 4 }}>#</th>
                <th style={{ textAlign: "left", padding: 4 }}>Strategy</th>
                <th style={{ padding: 4 }}>E[P/L]</th>
                <th style={{ padding: 4 }}>Margin</th>
                <th style={{ padding: 4 }}>Hold</th>
                <th style={{ padding: 4 }}>EV/MgDay</th>
                <th style={{ padding: 4 }}>PF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rank} style={{ borderTop: "1px solid #1e293b" }}>
                  <td style={{ padding: 4, color: "#64748b" }}>{r.rank}</td>
                  <td style={{ padding: 4, color: "#e2e8f0" }}>{r.strategy}</td>
                  <td style={{ textAlign: "right", padding: 4 }}>${r.e_pl.toFixed(0)}</td>
                  <td style={{ textAlign: "right", padding: 4 }}>${r.margin.toFixed(0)}</td>
                  <td style={{ textAlign: "right", padding: 4 }}>{r.avg_hold.toFixed(1)}d</td>
                  <td style={{ textAlign: "right", padding: 4, color: "#10b981" }}>${r.ev_mg_day.toFixed(4)}</td>
                  <td style={{ textAlign: "right", padding: 4 }}>{r.pf.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Bar chart */}
        <div style={{ height: 360 }}>
          <ReactECharts option={chartOption} style={{ height: "100%", width: "100%" }} />
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Panel D — Compounding Chart
// ---------------------------------------------------------------------------

const N_SAMPLE_PATHS = 8;

function CompoundingChart({
  curve,
  policy,
  portfolioSize,
}: {
  curve: DCCompoundingCurve;
  policy: DCAllocationPolicy;
  portfolioSize: number;
}) {
  const option = useMemo(() => {
    const months = curve.months;
    const median = curve.median_multiplier.map((m) => Math.max(m * portfolioSize, 1));
    // p5/p95 arrays are empty for policies without documented Monte Carlo
    // (see CAPITAL_ALLOCATION.md §10 — only rec_60_10 has MC). Hide the band
    // in that case rather than showing fabricated data.
    const hasBand = curve.p5_multiplier.length === months.length && curve.p95_multiplier.length === months.length;
    const p5 = hasBand ? curve.p5_multiplier.map((m) => Math.max(m * portfolioSize, 1)) : [];
    const p95 = hasBand ? curve.p95_multiplier.map((m) => Math.max(m * portfolioSize, 1)) : [];

    // Client-side illustrative sample paths. Skip for the static_1ct baseline
    // (flat curve, no variance) and any policy missing backtest data.
    const showSamplePaths = policy.backtest !== null;
    const terminalMult = policy.backtest
      ? policy.backtest.terminal_equity / policy.backtest.start_equity
      : 1;
    const maxDdPct = policy.backtest?.max_dd_pct ?? 0;
    const horizonMonths = months.length - 1;
    const jitteredPaths = showSamplePaths
      ? samplePaths(policy.key, N_SAMPLE_PATHS, {
          horizonMonths,
          terminalMultiplier: terminalMult,
          maxDdPct,
        })
      : [];

    const series: Array<Record<string, unknown>> = [];

    // Jittered sample paths first (lowest z-index — behind the median + bands).
    for (const [idx, path] of jitteredPaths.entries()) {
      series.push({
        name: `Illustrative path ${idx + 1}`,
        type: "line",
        data: path.map((m) => Math.max(m * portfolioSize, 1)),
        lineStyle: { color: "#10b98128", width: 1 },
        symbol: "none",
        showInLegend: false,
        tooltip: { show: false },
        z: 0,
      });
    }

    series.push(
      {
        name: "Median",
        type: "line",
        data: median,
        lineStyle: { color: "#10b981", width: 2 },
        symbol: "none",
        z: 3,
      },
      {
        name: "Start",
        type: "line",
        data: months.map(() => portfolioSize),
        lineStyle: { color: "#475569", type: "dotted", width: 1 },
        symbol: "none",
        z: 0,
      },
    );
    if (hasBand) {
      series.push(
        {
          name: "p95",
          type: "line",
          data: p95,
          lineStyle: { color: "#10b98160", type: "dashed", width: 1 },
          symbol: "none",
          z: 2,
        },
        {
          name: "p5",
          type: "line",
          data: p5,
          lineStyle: { color: "#10b98160", type: "dashed", width: 1 },
          symbol: "none",
          z: 2,
        },
      );
    }

    return {
      grid: { left: 70, right: 40, top: 30, bottom: 40 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#0f172a",
        borderColor: "#1e293b",
        textStyle: { color: "#e2e8f0", fontSize: 11 },
        formatter: (params: Array<{ axisValue: number; seriesName: string; value: number }> | { axisValue: number; seriesName: string; value: number }) => {
          const arr = Array.isArray(params) ? params : [params];
          if (!arr.length) return "";
          // Skip the "Illustrative path N" series in the tooltip — there are 8
          // of them and they'd swamp the real signal (Median / p5 / p95).
          const filtered = arr.filter((p) => !p.seriesName.startsWith("Illustrative path"));
          if (!filtered.length) return "";
          const month = filtered[0].axisValue;
          const lines = [
            `<b>Month ${month}</b> (${(month / 12).toFixed(1)}y)`,
            ...filtered.map((p) => `${p.seriesName}: $${formatCompact(p.value)}`),
          ];
          return lines.join("<br/>");
        },
      },
      xAxis: {
        type: "category",
        data: months,
        name: "Months",
        nameLocation: "middle",
        nameGap: 25,
        nameTextStyle: { color: "#64748b", fontSize: 11 },
        axisLabel: { color: "#64748b", fontSize: 10, interval: 5 },
        axisLine: { lineStyle: { color: "#334155" } },
      },
      yAxis: {
        type: "log",
        name: "Equity ($)",
        nameLocation: "middle",
        nameGap: 55,
        nameTextStyle: { color: "#64748b", fontSize: 11 },
        axisLabel: { color: "#64748b", fontSize: 10, formatter: (v: number) => `$${formatCompact(v)}` },
        splitLine: { lineStyle: { color: "#1e293b" } },
      },
      series,
    };
  }, [curve, policy, portfolioSize]);

  // Milestone annotations (read directly off the computed median curve).
  const milestone = (m: number) => {
    const idx = curve.months.indexOf(m);
    if (idx < 0) return null;
    return curve.median_multiplier[idx] * portfolioSize;
  };
  const y1 = milestone(12);
  const y3 = milestone(36);

  const isBaseline = policy.backtest === null;
  const hasBand = curve.p5_multiplier.length === curve.months.length;
  const subtitle = isBaseline
    ? "Flat baseline — 1 contract per entry, no compounding."
    : hasBand
    ? `${policy.name}: solid median + p5/p95 Monte Carlo band + ${N_SAMPLE_PATHS} illustrative sample paths (client-side MaxDD-scaled GBM).`
    : `${policy.name}: deterministic median curve from §5 backtest + ${N_SAMPLE_PATHS} illustrative paths (no documented Monte Carlo).`;

  return (
    <Panel title="Compounding Growth Projection" subtitle={subtitle}>
      <div style={{ height: 360 }}>
        <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 8,
          marginTop: 10,
          fontFamily: "JetBrains Mono, monospace",
        }}
      >
        <Milestone label="1y median" value={y1} />
        <Milestone label="3y median" value={y3} />
        <Milestone
          label={policy.backtest ? `Historical ${policy.backtest.years}y` : "Baseline"}
          value={
            policy.backtest
              ? policy.backtest.terminal_equity * (portfolioSize / policy.backtest.start_equity)
              : portfolioSize
          }
          color="#3b82f6"
        />
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: "#64748b", fontStyle: "italic" }}>
        {isBaseline
          ? "Static 1-contract baseline. No research model — included as a comparison anchor."
          : `Based on ${policy.copeland_mode} Copeland gating + ${policy.global_pct}/${policy.per_strat_pct} margin budget. Hard contract cap: ${policy.hard_cap}. SPX multiplier: ${SPX_MULTIPLIER}. Past performance ≠ future results.`}
      </div>
    </Panel>
  );
}

function Milestone({ label, value, color = "#10b981" }: { label: string; value: number | null; color?: string }) {
  return (
    <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 6, padding: "6px 10px" }}>
      <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "Inter, sans-serif" }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: value != null ? color : "#475569" }}>
        {value != null ? `$${formatCompact(value)}` : "—"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared panel wrapper + utilities
// ---------------------------------------------------------------------------

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: 8,
        padding: 14,
        fontFamily: "Inter, sans-serif",
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function formatCompact(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}
