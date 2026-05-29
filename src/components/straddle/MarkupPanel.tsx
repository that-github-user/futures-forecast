/**
 * MarkupPanel — live market-maker MARKUP tell for /straddle. Replaces
 * the StrikeVelocityTape.
 *
 * Layout — one column of full-width panels:
 *   - Alert feed (strip): the directional calls (call-side markup → spot
 *     UP ▲, put-side → DOWN ▼) with the evidence (spread vs baseline, σ,
 *     ask jump). Newest pulses in + keeps a soft glow.
 *   - Three stacked graphs, full browser width:
 *       1. CALL gradient sparkline, 2. PUT gradient sparkline — each a
 *          rolling ~2-min (120s) bid/ask envelope where the ASK line is
 *          colored per-segment by steepness (dim → amber → hot-red): a
 *          calm market is a dim flat line; a markup ramps hot exactly
 *          where the ask runs away — the "gradient of intensity."
 *       3. SPX spot line with vertical alert markers, so the operator
 *          sees spot move right AFTER each σ blowout.
 *
 * Degrades: the page hides the panel when markup is null (off-hours /
 * cold start / offline); `stale` dims the whole panel without blanking.
 */

import type { MarkupAlert, MarkupBandStrike, MarkupState } from "../../api/terminalTypes";
import { colors, fonts, withAlpha } from "../../styles/tokens";
import {
  alertMarkerX,
  directionMeta,
  formatAlertEvidence,
  intensityColor,
  pickFeatured,
  relativeAge,
  sparkGeometry,
  spotLineGeometry,
  spreadHeat,
} from "./markupHelpers";
import "./MarkupPanel.css";

// Full-width sparkline coordinate space (stretched to the container via
// preserveAspectRatio="none" + CSS width:100%). Taller now that the
// graphs are full-width and stacked rather than side-by-side.
const SPARK_W = 720;
const SPARK_H = 96;

export function MarkupPanel({ markup }: { markup: MarkupState }) {
  const featured = pickFeatured(markup.band, markup.center_atm);

  return (
    <div
      className={`markup-panel${markup.stale ? " markup-panel--stale" : ""}`}
      style={{
        background: colors.bgPanel,
        border: `1px solid ${colors.borderDim}`,
        padding: 14,
        fontFamily: fonts.sans,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 12,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: fonts.mono,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.14em",
              color: colors.textSecondary,
            }}
          >
            MARKUP TELL
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
            ask runs from bid → leads spot
          </div>
        </div>
        <div style={{ textAlign: "right", display: "flex", gap: 10, alignItems: "center" }}>
          {markup.center_atm != null && (
            <span style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.textSecondary }}>
              ATM {markup.center_atm.toFixed(0)}
            </span>
          )}
          <FreshnessChip stale={markup.stale} age={markup.age_seconds} />
        </div>
      </header>

      <div className="markup-body">
        <AlertFeed alerts={markup.recent_alerts} />
        <GradientSpark entry={featured.call} strike={featured.strike} side="call" />
        <GradientSpark entry={featured.put} strike={featured.strike} side="put" />
        <SpotPanel
          series={markup.spot_series ?? []}
          alerts={markup.recent_alerts}
        />
      </div>
    </div>
  );
}

function FreshnessChip({ stale, age }: { stale: boolean; age: number | null }) {
  const color = stale ? colors.accentAmber : colors.accentGreen;
  const label = stale ? "STALE" : "LIVE";
  const ageStr = age != null ? ` ${Math.round(age)}s` : "";
  return (
    <span
      style={{
        fontFamily: fonts.mono,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        color,
        padding: "2px 7px",
        borderRadius: 4,
        border: `1px solid ${withAlpha(color, 0.45)}`,
        background: withAlpha(color, 0.1),
      }}
    >
      {label}
      {ageStr}
    </span>
  );
}

function AlertFeed({ alerts }: { alerts: MarkupAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: SPARK_H + 28,
          color: colors.textMuted,
          fontSize: 12,
          textAlign: "center",
          border: `1px dashed ${colors.borderDim}`,
          borderRadius: 6,
          padding: 12,
        }}
      >
        No markups yet — watching the band for an ask runaway.
      </div>
    );
  }
  // Backend appends newest last; show newest first.
  const ordered = [...alerts].reverse();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", maxHeight: 180 }}>
      {ordered.map((a, i) => {
        const dir = directionMeta(a.direction);
        const fresh = i === 0;
        const sideLetter = a.side === "call" ? "C" : "P";
        return (
          <div
            key={`${a.ts}-${a.strike}-${a.side}`}
            className={`markup-alert${fresh ? " markup-alert--fresh" : ""}`}
            style={{
              borderColor: fresh ? withAlpha(dir.color, 0.5) : "transparent",
              background: fresh ? withAlpha(dir.color, 0.08) : colors.bgInset,
            }}
          >
            <span className="markup-glyph" style={{ color: dir.color }}>
              {dir.glyph}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
                {a.strike != null ? a.strike.toFixed(0) : "—"}
                {sideLetter}{" "}
                <span style={{ color: dir.color }}>→ spot {dir.label}</span>
              </div>
              <div
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  color: colors.textSecondary,
                  marginTop: 1,
                }}
              >
                {formatAlertEvidence(a)}
              </div>
              <div style={{ fontSize: 10, color: colors.textDim, marginTop: 1 }}>
                {relativeAge(a.ts)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GradientSpark({
  entry,
  strike,
  side,
}: {
  entry: MarkupBandStrike | null;
  strike: number | null;
  side: "call" | "put";
}) {
  const sideLetter = side === "call" ? "C" : "P";
  const accent = side === "call" ? colors.accentGreen : colors.accentRed;
  const geo = entry
    ? sparkGeometry(entry.series, SPARK_W, SPARK_H, 3, entry.baseline_spread)
    : null;

  return (
    <div
      style={{
        background: colors.bgInset,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 6,
        padding: "8px 10px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
          fontFamily: fonts.mono,
          fontSize: 11,
        }}
      >
        <span style={{ color: colors.textSecondary }}>
          {strike != null ? strike.toFixed(0) : "—"}
          <span style={{ color: accent, fontWeight: 700 }}> {sideLetter}</span>
        </span>
        <span style={{ color: colors.textMuted }}>
          {entry?.spread != null ? `spread $${entry.spread.toFixed(2)}` : "—"}
        </span>
      </div>
      {geo == null ? (
        <div
          style={{
            height: SPARK_H,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: colors.textDim,
            fontSize: 11,
          }}
        >
          warming up…
        </div>
      ) : (
        <Spark geo={geo} entry={entry!} />
      )}
    </div>
  );
}

function Spark({
  geo,
  entry,
}: {
  geo: NonNullable<ReturnType<typeof sparkGeometry>>;
  entry: MarkupBandStrike;
}) {
  const heat = spreadHeat(entry.spread, entry.baseline_spread);
  const lastAsk = geo.ask[geo.ask.length - 1];
  const lastSeg = geo.segments[geo.segments.length - 1];
  const lastIntensity = lastSeg?.intensity ?? 0;
  return (
    <svg
      className="markup-spark"
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      height={SPARK_H}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${entry.strike} ${entry.side} bid/ask gradient`}
    >
      {/* spread fill — fans open + heats up as the ask runs away */}
      <path d={geo.fillPath} fill={intensityColor(heat)} fillOpacity={0.1 + heat * 0.22} />
      {/* baseline-spread reference */}
      {geo.baselineY != null && (
        <line
          x1={0}
          x2={SPARK_W}
          y1={geo.baselineY}
          y2={geo.baselineY}
          stroke={colors.textDim}
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.5}
        />
      )}
      {/* bid line — dim reference */}
      <polyline
        points={geo.bid.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
        fill="none"
        stroke={colors.textDim}
        strokeWidth={1}
        opacity={0.7}
      />
      {/* ask line — per-segment steepness gradient (the signal) */}
      {geo.segments.map((s, i) => (
        <line
          key={i}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke={intensityColor(s.intensity)}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      ))}
      {/* leading-edge dot — pulses while the ask is actively steepening */}
      <circle
        className={lastIntensity > 0.4 ? "markup-live-dot" : undefined}
        cx={lastAsk.x}
        cy={lastAsk.y}
        r={2.6}
        fill={intensityColor(lastIntensity)}
      />
    </svg>
  );
}

function SpotPanel({
  series,
  alerts,
}: {
  series: [string, number][];
  alerts: MarkupAlert[];
}) {
  const geo = spotLineGeometry(series, SPARK_W, SPARK_H, 3);
  const last = series.length > 0 ? series[series.length - 1][1] : null;
  return (
    <div
      style={{
        background: colors.bgInset,
        border: `1px solid ${colors.borderDim}`,
        borderRadius: 6,
        padding: "8px 10px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
          fontFamily: fonts.mono,
          fontSize: 11,
        }}
      >
        <span style={{ color: colors.textSecondary }}>
          SPX spot <span style={{ color: colors.textDim }}>· 2-min · markers = markups</span>
        </span>
        <span style={{ color: colors.textMuted }}>{last != null ? last.toFixed(2) : "—"}</span>
      </div>
      {geo == null ? (
        <div
          style={{
            height: SPARK_H,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: colors.textDim,
            fontSize: 11,
          }}
        >
          spot warming up…
        </div>
      ) : (
        <svg
          className="markup-spark"
          viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
          height={SPARK_H}
          preserveAspectRatio="none"
          role="img"
          aria-label="SPX spot with markup alert markers"
        >
          {/* alert markers — a dir-colored dashed vertical at each in-window
              markup, so spot's move reads right after the σ blowout */}
          {alerts.map((a) => {
            const x = alertMarkerX(a.ts, geo.tMin, geo.tMax, SPARK_W, 3);
            if (x == null) return null;
            const dir = directionMeta(a.direction);
            return (
              <line
                key={`${a.ts}-${a.strike}-${a.side}`}
                x1={x}
                x2={x}
                y1={0}
                y2={SPARK_H}
                stroke={dir.color}
                strokeWidth={1}
                strokeDasharray="2 2"
                opacity={0.55}
              />
            );
          })}
          <polyline
            points={geo.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
            fill="none"
            stroke={colors.textSecondary}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
          <circle
            cx={geo.points[geo.points.length - 1].x}
            cy={geo.points[geo.points.length - 1].y}
            r={2.4}
            fill={colors.textBright}
          />
        </svg>
      )}
    </div>
  );
}
