/**
 * PinCandidatesPanel — ranked list of EOD pin-candidate strikes.
 *
 * Each row shows:
 *   - The strike (large, mono)
 *   - A density bar (0..1 normalized) — visual rank cue
 *   - Distance from spot in pts (signed, so the side is obvious)
 *   - A "WITHIN EM" badge when the strike falls inside the EM band
 *
 * Top 5 candidates are surfaced (the spec — operators don't need
 * more). When the list is empty (cold-start or no qualifying strikes
 * yet), render an empty-state line so the column doesn't collapse.
 */

import { colors, fonts, withAlpha, withAlphaByte } from "../../styles/tokens";
import type { PinCandidate } from "../../api/terminalTypes";

interface Props {
  candidates: PinCandidate[];
  spot: number | null;
}

export function PinCandidatesPanel({ candidates, spot }: Props) {
  return (
    <div
      style={{
        background: colors.bgPanel,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 6,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontFamily: fonts.sans,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: colors.textMuted,
          textTransform: "uppercase",
        }}
      >
        Pin Candidates
      </div>
      {candidates.length === 0 && (
        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: 12,
            color: colors.textMuted,
            padding: "6px 0",
          }}
        >
          No pin candidates yet
        </div>
      )}
      {candidates.slice(0, 5).map((c) => {
        const distance = spot != null ? c.strike - spot : null;
        const distanceLabel = distance == null
          ? "—"
          : `${distance >= 0 ? "+" : ""}${distance.toFixed(1)}`;
        // Color the distance by side so it matches the chart's call /
        // put hue convention: call-side (above spot) → blue, put-side
        // (below spot) → amber, ATM (===0) → primary text.
        const distanceColor =
          distance == null
            ? colors.textSecondary
            : distance > 0
              ? colors.accentBlue
              : distance < 0
                ? colors.accentAmber
                : colors.textPrimary;
        return (
          <div
            key={c.strike}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              alignItems: "center",
              gap: 10,
              padding: "4px 0",
              borderTop: `1px solid ${colors.borderDim}`,
            }}
          >
            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: 15,
                fontWeight: 600,
                color: colors.textBright,
                minWidth: 56,
              }}
            >
              {c.strike.toFixed(0)}
            </div>
            <div
              style={{
                position: "relative",
                height: 6,
                background: colors.borderDim,
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${Math.max(0, Math.min(1, c.density_score)) * 100}%`,
                  background: c.within_em ? colors.accentGreen : colors.textMuted,
                  borderRadius: 3,
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 80,
                justifyContent: "flex-end",
              }}
            >
              <span
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  color: distanceColor,
                }}
              >
                {distanceLabel}
              </span>
              {c.within_em && (
                <span
                  style={{
                    fontFamily: fonts.sans,
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    color: colors.accentGreen,
                    padding: "1px 5px",
                    borderRadius: 8,
                    background: withAlphaByte(colors.accentGreen, 0x18),
                    border: `1px solid ${withAlpha(colors.accentGreen, 0.3)}`,
                  }}
                >
                  EM
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
