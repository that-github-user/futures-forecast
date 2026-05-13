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
 * `frontExp` (YYYYMMDD) is optional but strongly recommended. When
 * present, the modal fires all 4 tent fetches (frozen + live + halfway
 * + at-expiry) in parallel from mount — halving wall time vs the
 * 2-phase fallback that has to wait for the live response's
 * `days_to_front_exp` field before kicking off the evolution fetches.
 * Callers without easy access to the date (very old trade rows where
 * front_exp is null) can omit and accept the slower path.
 */
export type TentTarget =
  | { kind: "position"; positionUid: string; frontExp?: string }
  | { kind: "phantom"; positionUid: string; frontExp?: string }
  | { kind: "trade"; tradeId: number; frontExp?: string };


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


async function fetchLive(
  target: TentTarget, asOf?: string,
): Promise<DCTentResponse | null> {
  const opts = asOf ? { ivSource: "latest" as const, asOf } : { ivSource: "latest" as const };
  switch (target.kind) {
    case "position":
      return dcApi.positionTent(target.positionUid, opts);
    case "phantom":
      return dcApi.phantomTent(target.positionUid, opts);
    case "trade":
      // Trade endpoint only supports iv_source=entry; live overlay
      // is intentionally unavailable.
      return null;
  }
}


/**
 * Compute ISO timestamps for the evolution-overlay fetches.
 *
 * Returns:
 *   - halfwayAsOf: midway between now and front expiration. Bridge
 *     curve showing how the tent reshapes mid-life.
 *   - atExpiryAsOf: just before front expiration (subtract a small
 *     epsilon so T_front isn't exactly 0 — the BS pricer collapses
 *     to intrinsic at T_front=0 and a near-expiry curve renders the
 *     "tent peaks at strikes" shape more faithfully than the strictly-
 *     intrinsic version).
 *
 * Returns null when `daysToFrontExp` isn't usable (negative, NaN,
 * or so small the evolution curves would overlap today's curve).
 */
function computeEvolutionAsOfs(
  daysToFrontExp: number, now: Date = new Date(),
): { halfwayAsOf: string; atExpiryAsOf: string } | null {
  if (!Number.isFinite(daysToFrontExp) || daysToFrontExp <= 0.5) return null;
  const MS_PER_DAY = 86_400_000;
  const halfway = new Date(now.getTime() + (daysToFrontExp / 2) * MS_PER_DAY);
  // 4 hours before front expiry. Avoids T_front=0 edge case + lands
  // inside a real trading session so the curve is operationally meaningful.
  const atExpiry = new Date(now.getTime() + (daysToFrontExp - 4 / 24) * MS_PER_DAY);
  return {
    halfwayAsOf: halfway.toISOString(),
    atExpiryAsOf: atExpiry.toISOString(),
  };
}


/**
 * Convert a YYYYMMDD front-expiration string to "days from now"
 * (real-numbered, e.g. 9.68). Returns null on parse failure so the
 * caller can fall back to the 2-phase pull-from-response path.
 *
 * Treats front expiry as 16:00 ET on the date (SPX/SPXW PM-settled
 * cash expiration) — close enough for as_of calculations; the API
 * also uses 16:00 ET as the canonical expiration moment.
 */
function daysToFrontExpFromString(
  frontExp: string | undefined | null, now: Date = new Date(),
): number | null {
  if (!frontExp || frontExp.length !== 8) return null;
  const y = Number(frontExp.slice(0, 4));
  const m = Number(frontExp.slice(4, 6));
  const d = Number(frontExp.slice(6, 8));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  // 20:00 UTC = 16:00 ET (during EDT). Slight offset during EST but
  // immaterial for as_of calculations on intraday-resolution curves.
  const expDate = new Date(Date.UTC(y, m - 1, d, 20, 0, 0));
  const deltaMs = expDate.getTime() - now.getTime();
  return deltaMs / 86_400_000;
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
    // Fetch strategy:
    //   Fast path (target.frontExp present): compute as_ofs locally
    //     from front_exp and fire ALL 4 fetches in parallel from t=0.
    //     Wall time = max(single roundtrip) ≈ 50ms.
    //   Slow path (target.frontExp missing): 2-phase — fetch frozen +
    //     live first, read days_to_front_exp from live response, then
    //     fire halfway + at-expiry. Wall time = 2× roundtrip ≈ 100ms.
    //     Only triggers for very old trade rows where front_exp is
    //     null on the DCTrade record.
    //
    // Promise.allSettled (not Promise.all): dcClient.dcGet already
    // catches fetch rejections and returns null, so .all-vs-allSettled
    // is moot today but safer for a future refactor that bubbles errors.
    const dteFromTarget = daysToFrontExpFromString(target.frontExp);
    const asOfsFromTarget =
      dteFromTarget != null ? computeEvolutionAsOfs(dteFromTarget) : null;

    if (asOfsFromTarget != null) {
      // FAST PATH — all 4 in parallel.
      Promise.allSettled([
        fetchFrozen(target),
        fetchLive(target),
        fetchLive(target, asOfsFromTarget.halfwayAsOf),
        fetchLive(target, asOfsFromTarget.atExpiryAsOf),
      ]).then((results) => {
        if (cancelled) return;
        const [frozenResult, liveResult, halfwayResult, atExpiryResult] = results;
        const f = frozenResult.status === "fulfilled" ? frozenResult.value : null;
        const l = liveResult.status === "fulfilled" ? liveResult.value : null;
        const h = halfwayResult.status === "fulfilled" ? halfwayResult.value : null;
        const a = atExpiryResult.status === "fulfilled" ? atExpiryResult.value : null;
        setFrozen(f);
        setLive(l);
        setHalfway(h);
        setAtExpiry(a);
        if (f == null) setError("Tent data unavailable for this position");
        setLoading(false);
      });
    } else {
      // SLOW PATH — 2-phase fallback (no front_exp available from caller).
      Promise.allSettled([fetchFrozen(target), fetchLive(target)])
        .then((results) => {
          if (cancelled) return;
          const [frozenResult, liveResult] = results;
          const f = frozenResult.status === "fulfilled" ? frozenResult.value : null;
          const l = liveResult.status === "fulfilled" ? liveResult.value : null;
          setFrozen(f);
          setLive(l);
          if (f == null) setError("Tent data unavailable for this position");
          setLoading(false);
          if (l != null) {
            const asOfs = computeEvolutionAsOfs(l.days_to_front_exp);
            if (asOfs != null) {
              Promise.allSettled([
                fetchLive(target, asOfs.halfwayAsOf),
                fetchLive(target, asOfs.atExpiryAsOf),
              ]).then((evResults) => {
                if (cancelled) return;
                const [hResult, aResult] = evResults;
                setHalfway(hResult.status === "fulfilled" ? hResult.value : null);
                setAtExpiry(aResult.status === "fulfilled" ? aResult.value : null);
              });
            }
          }
        });
    }
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
