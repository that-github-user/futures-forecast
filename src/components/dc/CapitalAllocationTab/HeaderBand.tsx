/**
 * HeaderBand — the sticky-looking control row at the top of the Capital
 * tab. Carries the portfolio-size input, shows the current policy
 * label, hosts the Apply-to-Signals opt-in toggle, and displays the
 * data source (api vs. mock).
 *
 * The Apply-to-Signals toggle is a Type-II opt-in: user deliberately
 * enables policy-driven sizing on the Signals tab. Default off.
 */

import { colors, fonts } from "../../../styles/tokens";
import type { PolicyKey } from "../../../api/dcTypes";

const POLICY_SHORT: Record<PolicyKey, string> = {
  live: "Live (recommended)",
  conservative: "Conservative 3%/40-8",
  go_only: "GO-only (no GO+ boost)",
  aggressive: "Aggressive 7%/70-12",
  static_1ct: "Static 1 ct (baseline)",
};

export function HeaderBand({
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
        background: colors.bgInset,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 6,
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        fontFamily: fonts.sans,
      }}
    >
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: colors.textSecondary }}>
        Portfolio size
        <span style={{ color: colors.textMuted }}>$</span>
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
            fontFamily: fonts.mono,
            color: colors.textPrimary,
            background: colors.borderDim,
            border: `1px solid ${colors.borderMid}`,
            borderRadius: 4,
            padding: "4px 8px",
            width: 120,
          }}
        />
      </label>
      <span style={{ fontSize: 11, color: colors.textMuted }}>
        Policy: <span style={{ color: colors.textPrimary, fontWeight: 600 }}>{POLICY_SHORT[policyKey]}</span>
      </span>

      {/* Type II opt-in: the user deliberately enables policy-driven sizing on the
          Signals tab. Default off — Signals stays in "raw-signal" display mode
          until the user makes a conscious choice here. */}
      <ApplyToSignalsToggle
        value={useCapitalForSignals}
        onChange={onToggleUseForSignals}
      />

      <span style={{ fontSize: 10, color: colors.textDim, marginLeft: "auto", fontStyle: "italic" }}>
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
  const track = value ? colors.accentGreen : colors.borderMid;
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
        fontFamily: fonts.sans,
      }}
      aria-pressed={value}
    >
      <span style={{ fontSize: 11, color: colors.textSecondary, whiteSpace: "nowrap" }}>Apply to Signals</span>
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
            background: colors.textBright,
            transform: knob,
            transition: "transform 150ms",
          }}
        />
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: value ? colors.accentGreen : colors.textMuted,
          letterSpacing: 0.5,
        }}
      >
        {value ? "ON" : "OFF"}
      </span>
    </button>
  );
}
