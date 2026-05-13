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


/**
 * The modal hits a single bundled API endpoint (vega-pilot PR #178)
 * that returns all 4 tent curves in one response. No need to plumb
 * front_exp through anymore — the backend computes all evolution
 * as_of values from the position's own row.
 */
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


/**
 * Single bundled fetch — replaces the 4-separate-fetches pattern.
 * Backend serves all 4 tent curves in one response served from
 * SQLite precompute cache (see vega-pilot PR #178). Wall time:
 * one Cloudflare Tunnel roundtrip ≈ 100-500ms vs the prior
 * 20-second compound from 4 sequential CFT requests.
 */
async function fetchBundle(target: TentTarget) {
  switch (target.kind) {
    case "position":
      return dcApi.positionTentBundle(target.positionUid);
    case "phantom":
      return dcApi.phantomTentBundle(target.positionUid);
    case "trade":
      return dcApi.tradeTentBundle(target.tradeId);
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
  // Evolution overlays — same iv_source as live (latest snapshot) but
  // with as_of advanced to midway/at-expiry. Lets operators see how
  // the tent shape evolves over time, especially the "two tents"
  // double-peak at front expiry. Optional — null until phase 2 fetch
  // completes, or stays null when front expiry is too close to render
  // meaningful evolution curves.
  const [halfway, setHalfway] = useState<DCTentResponse | null>(null);
  const [atExpiry, setAtExpiry] = useState<DCTentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Single bundled fetch — backend returns all 4 tent curves in
    // one response served from SQLite precompute cache. Replaces
    // the pre-#189 4-fetch-with-phase-2 pattern that compounded
    // Cloudflare Tunnel latency into 20s of perceived wait.
    fetchBundle(target).then((bundle) => {
      if (cancelled) return;
      if (bundle == null) {
        setError("Tent data unavailable for this position");
        setLoading(false);
        return;
      }
      setFrozen(bundle.frozen);
      setLive(bundle.today);
      setHalfway(bundle.halfway);
      setAtExpiry(bundle.at_expiry);
      // No primary curve present at all → error state. If at least
      // one of frozen/today rendered, the chart is usable.
      if (bundle.frozen == null && bundle.today == null) {
        setError("Tent data unavailable for this position");
      }
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

  // Filter the API's warnings array for the modal. When the frozen
  // fetch resolved to "intrinsic" (legacy position with no entry IVs)
  // the API correctly emits "no implied vol data available — tent
  // curve is intrinsic-only" — but that's only true of the FROZEN
  // overlay. If the live curve is rendering successfully, showing
  // that warning verbatim is misleading (operator sees a real tent
  // AND a "no IV data" warning, which contradicts). Suppress the
  // frozen-intrinsic warning in that case and replace it with a
  // more accurate one that names the actual degradation.
  const liveIsRendering =
    live != null && live.iv_source === "latest" && live.points.length > 0;
  const adjustedWarnings = (() => {
    const raw = frozen?.warnings ?? [];
    if (!liveIsRendering || frozen?.iv_source !== "intrinsic") return raw;
    // Drop the API's intrinsic-only banner (identified by stable
    // substring — same wording is pinned by backend tests) and
    // prepend a more honest replacement.
    const filtered = raw.filter((w) => !w.includes("intrinsic-only"));
    return [
      "Frozen-IV (entry) overlay unavailable — this legacy position " +
        "predates entry-IV capture (PR #170). Live IV is rendering " +
        "below; you're seeing the current curve only, not a drift " +
        "comparison vs entry.",
      ...filtered,
    ];
  })();

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

        {/* Warnings banner — uses `adjustedWarnings` which suppresses
            the API's "intrinsic-only" message when Live IV is
            rendering (the warning was correct of the frozen overlay
            but contradicted the rendered live curve). See the
            comment near `adjustedWarnings` for the rationale. */}
        {adjustedWarnings.length > 0 && (
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
            {adjustedWarnings.map((w, i) => (
              <div key={i} style={{ marginTop: i > 0 ? 4 : 0 }}>
                ⚠ {w}
              </div>
            ))}
          </div>
        )}

        {/* Phantom action hint. Sits below the (optional) warnings
            banner so the operator knows what — if anything — to do
            about a would-have-entered trade. Followers entered
            manually based on the daemon's signal; this row is the
            historical record of what would have happened. R2#S3. */}
        {isPhantom && (
          <div
            style={{
              marginBottom: 12,
              padding: "8px 12px",
              background: withAlpha(colors.accentRed, 0.08),
              border: `1px solid ${withAlpha(colors.accentRed, 0.3)}`,
              borderRadius: 4,
              fontSize: 12,
              color: colors.textPrimary,
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: colors.accentRed }}>Phantom:</strong>{" "}
            the daemon's entry-fill phase failed (ladder exhausted /
            parked-at-ask without fill) after every signal-side gate
            cleared. Followers got the GO signal manually; this row
            preserves the would-have-entered trade so the tent
            tracker stays honest. No action required on this row;
            check the daemon's entry-ladder logs if the pattern
            repeats.
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
          <TentChart
            frozenCurve={frozen}
            liveCurve={live}
            halfwayCurve={halfway}
            atExpiryCurve={atExpiry}
            height={360}
          />
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
      {/* `⚠` prefix matches the warnings-banner visual language so the
          amber-degraded variant reads as "warning" to a first-time
          operator without relying on color intuition alone. R2#S4 fix. */}
      {isWarning ? `⚠ ${label}` : label}
    </span>
  );
}


function PhantomPill() {
  // Red (not amber) so the pill pops against the modal's dashed-amber
  // container border. "Automation missed entry" is closer to a regret
  // signal than a warning — amber is reserved for IV-degradation
  // warnings; red here unambiguously marks "automation did not act
  // when the followers were told to." R2#S2 fix.
  return (
    <span style={{
      fontSize: 10,
      padding: "2px 8px",
      borderRadius: 3,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      background: withAlpha(colors.accentRed, 0.15),
      color: colors.accentRed,
      border: `1px solid ${colors.accentRed}`,
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
