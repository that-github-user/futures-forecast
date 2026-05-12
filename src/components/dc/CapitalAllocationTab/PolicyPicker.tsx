/**
 * PolicyPicker — Panel A of the Capital tab. Renders a selectable grid
 * of DCAllocationPolicy cards. Each PolicyCard summarizes the policy
 * (name, description, recommended/baseline badge, terminal/PF/MaxDD
 * stats for ensemble-gate policies, or annual P/L / 2.91y terminal
 * for the linear-growth baseline). The `Stat` primitive here is private
 * to the card layout.
 */

import { colors, fonts, withAlpha, withAlphaByte } from "../../../styles/tokens";
import type { DCAllocationPolicy, PolicyKey } from "../../../api/dcTypes";
import { formatCompact, Panel } from "./shared";

export function PolicyPicker({
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
    <Panel title="Allocation Policy" subtitle="Live policy + 3 variants — pick one">
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
  const color = selected ? colors.accentBlue : policy.recommended ? colors.accentGreen : colors.borderMid;
  // Use `== null` (loose) not `=== null` — the backend's Optional fields can
  // serialize to either `null` or be entirely absent (→ `undefined` on the
  // frontend) depending on pydantic version or a stale dc-api deploy. A
  // strict `=== null` check lets `undefined` fall through into the compounding
  // branch, which then crashes on `policy.backtest.pf` because backtest is
  // actually undefined. That's a blank-page render error.
  const isBaseline = policy.backtest == null;
  return (
    <button
      onClick={onClick}
      style={{
        background: selected ? colors.borderDim : colors.bgInset,
        border: `2px solid ${color}`,
        borderRadius: 8,
        padding: 12,
        textAlign: "left",
        cursor: "pointer",
        fontFamily: fonts.sans,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{policy.name}</span>
        {policy.recommended && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: colors.accentGreen,
              background: withAlphaByte(colors.accentGreen, 0x18),
              border: `1px solid ${withAlpha(colors.accentGreen, 0.25)}`,
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
              color: colors.textMuted,
              background: colors.borderDim,
              border: `1px solid ${colors.borderMid}`,
              borderRadius: 4,
              padding: "1px 5px",
              letterSpacing: 0.5,
            }}
          >
            BASELINE
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: colors.textSecondary, lineHeight: 1.4 }}>{policy.description}</div>
      {policy.backtest == null ? (
        (() => {
          // static_1ct carries linear_growth parameters. These numbers are
          // UNSCALED: at 1 contract per entry, dollar P/L is identical whether
          // the user's account is $25K or $500K. Terminal adds that constant
          // gain to the user's starting equity over the 35-month (2.91y)
          // backtest window — the annualized P/L does not depend on size.
          const lg = policy.linear_growth;
          const annualPL = lg ? lg.monthly_pl * 12 : 0;
          const terminalLinear = lg ? portfolioSize + lg.monthly_pl * 35 : portfolioSize;
          return (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: 6,
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  marginTop: 4,
                }}
              >
                <Stat
                  label="~Annual P/L"
                  value={`$${formatCompact(annualPL)}`}
                  color={colors.textPrimary}
                />
                <Stat
                  label="2.91y terminal"
                  value={`$${formatCompact(terminalLinear)}`}
                />
              </div>
              <div style={{ fontSize: 10, color: colors.textDim, marginTop: 2 }}>
                1 contract per entry · linear growth (no compounding)
              </div>
            </>
          );
        })()
      ) : (
        (() => {
          // Alias narrowed inside the IIFE so subsequent accesses don't need
          // `policy.backtest!`. The `backtest === null` check above gives TS
          // the narrowing, but it doesn't flow through the `isBaseline` local.
          const bt = policy.backtest;
          const scale = portfolioSize / bt.start_equity;
          return (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 6,
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  marginTop: 4,
                }}
              >
                <Stat
                  label="Terminal"
                  value={`$${formatCompact(bt.terminal_equity * scale)}`}
                  color={colors.textPrimary}
                />
                <Stat label="PF" value={bt.pf.toFixed(2)} />
                <Stat label="MaxDD" value={`${bt.max_dd_pct.toFixed(1)}%`} />
              </div>
              <div style={{ fontSize: 10, color: colors.textDim, marginTop: 2 }}>
                {policy.monte_carlo
                  ? `MC median $${formatCompact(policy.monte_carlo.median * scale)} (${bt.years}y from $${formatCompact(portfolioSize)})`
                  : `${bt.years}y from $${formatCompact(portfolioSize)} · MC not documented`}
              </div>
            </>
          );
        })()
      )}
    </button>
  );
}

function Stat({ label, value, color = colors.textSecondary }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: fonts.sans }}>
        {label}
      </div>
      <div style={{ color, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
