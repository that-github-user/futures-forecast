/**
 * TentChartModal — modal wrapper around TentChart with data fetch +
 * provenance display. Used by DCPositionsTab (real-position drill-
 * down), DCHistoryTab (closed-trade through-expiry view), and
 * PR 7's Tent tab small-multiples grid (when clicked-to-expand).
 *
 * Three target shapes via the `target` prop:
 *   - { kind: "position", positionUid }  → fetches frozen + live curves
 *   - { kind: "phantom",  positionUid }  → fetches phantom tent (live + frozen)
 *   - { kind: "trade",    tradeId }      → frozen only (trade_history
 *                                          lacks position_uid for the
 *                                          live-IV join)
 *
 * Provenance UI:
 *   - iv_source badge in the header ("Frozen / Live / Fallback /
 *     Intrinsic") tints the curve label to match the API response.
 *   - warnings array renders as an amber banner above the chart.
 *     Operator MUST see degradation reasons explicitly.
 *   - phantom positions get a dashed border + "AUTOMATION MISSED"
 *     pill so they don't blend with real positions.
 */

import { useEffect, useState } from "react";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import { dcApi } from "../../api/dcClient";
import type { DCTentResponse } from "../../api/dcTypes";
import { TentChart } from "./TentChart";


export type TentTarget =
  | { kind: "position"; positionUid: string }
  | { kind: "phantom"; positionUid: string }
  | { kind: "trade"; tradeId: number };


interface TentChartModalProps {
  target: TentTarget;
  /** Display name for the modal header (strategy name). */
  title: string;
  onClose: () => void;
}


async function fetchFrozen(target: TentTarget): Promise<DCTentResponse | null> {
  switch (target.kind) {
    case "position":
      return dcApi.positionTent(target.positionUid, { ivSource: "entry" });
    case "phantom":
      return dcApi.phantomTent(target.positionUid, { ivSource: "entry" });
    case "trade":
      return dcApi.tradeTent(target.tradeId);
  }
}


async function fetchLive(target: TentTarget): Promise<DCTentResponse | null> {
  switch (target.kind) {
    case "position":
      return dcApi.positionTent(target.positionUid, { ivSource: "latest" });
    case "phantom":
      return dcApi.phantomTent(target.positionUid, { ivSource: "latest" });
    case "trade":
      // Trade endpoint only supports iv_source=entry; live overlay
      // is intentionally unavailable.
      return null;
  }
}


export function TentChartModal({ target, title, onClose }: TentChartModalProps) {
  // Initial state is loading + no data, no error. The useEffect
  // below only mutates state in the async callbacks — never
  // synchronously in the effect body — to satisfy the
  // react-hooks/set-state-in-effect rule. Modal instances are
  // re-mounted on each open, so we don't need to handle the rare
  // case of `target` changing on an existing mount: useState's
  // initializer already gives the correct loading state on mount.
  const [frozen, setFrozen] = useState<DCTentResponse | null>(null);
  const [live, setLive] = useState<DCTentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchFrozen(target), fetchLive(target)])
      .then(([f, l]) => {
        if (cancelled) return;
        setFrozen(f);
        setLive(l);
        if (f == null) {
          setError("Tent data unavailable for this position");
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  // Escape-to-close. Backdrop click also closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isPhantom = frozen?.phantom === true;
  const ivSourceLabel = labelForIvSource(live?.iv_source ?? frozen?.iv_source ?? null);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.65)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(900px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          background: colors.bgPanel,
          border: isPhantom
            ? `2px dashed ${colors.accentAmber}`
            : `1px solid ${colors.borderMid}`,
          borderRadius: 8,
          padding: 20,
          fontFamily: fonts.sans,
          color: colors.textPrimary,
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 16, color: colors.textBright }}>
              Tent — {title}
            </h3>
            {isPhantom && <PhantomPill />}
            {ivSourceLabel && <IvSourceBadge label={ivSourceLabel} />}
          </div>
          <button
            onClick={onClose}
            aria-label="Close tent chart"
            style={{
              background: "transparent",
              border: `1px solid ${colors.borderMid}`,
              color: colors.textSecondary,
              padding: "4px 10px",
              borderRadius: 4,
              cursor: "pointer",
              fontFamily: fonts.sans,
            }}
          >
            Close
          </button>
        </div>

        {/* Warnings banner */}
        {frozen && frozen.warnings.length > 0 && (
          <div
            role="alert"
            style={{
              marginBottom: 12,
              padding: "8px 12px",
              background: withAlpha(colors.accentAmber, 0.1),
              border: `1px solid ${withAlpha(colors.accentAmber, 0.4)}`,
              borderRadius: 4,
              fontSize: 12,
              color: colors.accentAmber,
            }}
          >
            {frozen.warnings.map((w, i) => (
              <div key={i} style={{ marginTop: i > 0 ? 4 : 0 }}>
                ⚠ {w}
              </div>
            ))}
          </div>
        )}

        {/* Chart */}
        {loading && (
          <div style={{
            height: 340,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: colors.textMuted,
          }}>
            Loading tent data…
          </div>
        )}
        {!loading && error && (
          <div style={{
            height: 340,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: colors.accentRedLight,
          }}>
            {error}
          </div>
        )}
        {!loading && !error && (
          <TentChart frozenCurve={frozen} liveCurve={live} height={360} />
        )}

        {/* Footer metadata */}
        {frozen && (
          <div style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
            fontSize: 11,
            color: colors.textSecondary,
            fontFamily: fonts.mono,
          }}>
            <Stat label="Entry debit" value={`$${frozen.entry_debit.toFixed(2)}`} />
            <Stat
              label="Days in trade"
              value={frozen.days_in_trade.toFixed(1)}
            />
            <Stat
              label="Front DTE"
              value={frozen.days_to_front_exp.toFixed(1)}
            />
            <Stat
              label="Back DTE"
              value={frozen.days_to_back_exp.toFixed(1)}
            />
            <Stat
              label="BE low"
              value={
                frozen.breakeven_low != null
                  ? frozen.breakeven_low.toFixed(0)
                  : "—"
              }
            />
            <Stat
              label="BE high"
              value={
                frozen.breakeven_high != null
                  ? frozen.breakeven_high.toFixed(0)
                  : "—"
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}


function labelForIvSource(source: string | null): string | null {
  switch (source) {
    case "entry": return "Frozen IV";
    case "latest": return "Live IV";
    case "entry_fallback": return "Frozen (no snapshot yet)";
    case "intrinsic": return "Intrinsic only";
    default: return null;
  }
}


function IvSourceBadge({ label }: { label: string }) {
  const isWarning = label.startsWith("Intrinsic") || label.startsWith("Frozen (no");
  return (
    <span style={{
      fontSize: 10,
      padding: "2px 8px",
      borderRadius: 3,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      background: isWarning
        ? withAlpha(colors.accentAmber, 0.15)
        : withAlpha(colors.accentBlue, 0.15),
      color: isWarning ? colors.accentAmber : colors.accentBlue,
      border: `1px solid ${
        isWarning ? withAlpha(colors.accentAmber, 0.4) : withAlpha(colors.accentBlue, 0.4)
      }`,
      fontFamily: fonts.mono,
    }}>
      {label}
    </span>
  );
}


function PhantomPill() {
  return (
    <span style={{
      fontSize: 10,
      padding: "2px 8px",
      borderRadius: 3,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      background: withAlpha(colors.accentAmber, 0.15),
      color: colors.accentAmber,
      border: `1px solid ${colors.accentAmber}`,
      fontFamily: fonts.mono,
      fontWeight: 600,
    }}>
      Automation Missed
    </span>
  );
}


function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: colors.textPrimary, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}
