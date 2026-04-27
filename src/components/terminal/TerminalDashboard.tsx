/**
 * TerminalDashboard — 6-system ES futures terminal at #/app.
 *
 * PR β skeleton: implements the locked design spec §4 layout (headline
 * strip / chart+feed / 6 scorecards) with placeholder content. Real
 * data wires up in subsequent PRs:
 *   PR γ — VWAP / Levels / Breadth scorecards (frontend-computable)
 *   PR δ — Volatility Regime scorecard
 *   PR ε — GEX placeholder polish (third-party feed deferred)
 *   PR ζ — Synthesizer score chip + override flash + headline polish
 *   PR η — ML fan integration (toggleable chart overlay)
 *
 * Backend: vega-pilot/futures_terminal/ on terminal.denoisedalpha.com.
 */

import { useEffect, useRef, useState } from "react";
import { useTerminalSnapshot } from "../../hooks/useTerminalSnapshot";
import { useTimezone, type TZOption } from "../../hooks/useTimezone";
import {
  TerminalChartCanvas,
  VWAP_ANCHORS,
  type OverlayState,
  type Timeframe,
  type VwapAnchorKey,
  type VwapAnchorState,
  type VwapOverlayState,
  DEFAULT_OVERLAYS,
  DEFAULT_TIMEFRAME,
} from "./TerminalChartCanvas";

const TZ_OPTIONS: TZOption[] = ["ET", "CT", "MT", "PT", "local"];

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h"];
import type { SynthesizerContribution, TerminalSnapshot } from "../../api/terminalTypes";
import { RouteNav } from "../nav/RouteNav";
import "./TerminalDashboard.css";

const SYSTEM_LABELS = {
  volatility: "Volatility",
  gamma: "Gamma",
  structure: "Structure",
  levels: "Levels",
  breadth: "Breadth",
  synthesis: "Synthesis",
} as const;

// Per-system denominators are NOT hardcoded in the frontend — the
// underlying weights are architecturally-sensitive design values per
// the privacy threshold. Real values come from the backend response
// (eventually via SynthesizerContribution.share for proportional bar
// rendering). PR β renders "—" for the denominator everywhere.

export function TerminalDashboard() {
  const { data } = useTerminalSnapshot();

  return (
    <div className="terminal-root">
      <RouteNav current="terminal" />
      <HeadlineStrip data={data} />
      <MiddleBand data={data} />
      <ScorecardGrid data={data} />
    </div>
  );
}

/* ── Headline strip (spec §4.1) ──────────────────────────── */

function HeadlineStrip({ data }: { data: TerminalSnapshot | null }) {
  const score = data?.synthesizer?.score;
  const hasScore = score !== undefined && score !== null && data?.synthesizer.bias !== "FLAT";
  // Per spec §4.1: the headline score is a 240px monumental Editorial
  // Italic glyph — meant to read as a sculptural object, not telemetry.
  // Integer rounding keeps the figure clean. The SynthesisCard body
  // shows the same number with one decimal where precision matters.
  const scoreDisplay = hasScore
    ? `${score! >= 0 ? "+" : ""}${Math.round(score!)}`
    : "—";

  const regimeLabel = data?.regime?.regime_label ?? "unknown";
  const hasRegime = regimeLabel !== "unknown";

  const overrides = data?.synthesizer?.overrides ?? [];
  const overridesBody = overrides.length === 0 ? "clear" : overrides.join(" · ");

  const price = data?.es_price;
  const change = data?.es_change ?? 0;
  const changePositive = change >= 0;

  return (
    <section className="terminal-headline">
      <div className="terminal-score-block">
        <span className={`terminal-score${hasScore ? "" : " placeholder"}`}>{scoreDisplay}</span>
        <span className="terminal-score-label">
          {hasScore ? (data!.synthesizer.bias === "LONG" ? "Buy" : "Sell") : "Awaiting"}
          <br />
          {hasScore ? "Bias" : "Data"}
        </span>
      </div>
      <div className={`terminal-regime${hasRegime ? "" : " placeholder"}`}>
        {hasRegime ? formatRegime(regimeLabel) : "—"}
      </div>
      <OverridesSection overrides={overrides} overridesBody={overridesBody} />
      <div className="terminal-price-block">
        <div className="terminal-price">
          <span className={`terminal-price-num${price == null ? " placeholder" : ""}`}>
            {price != null ? price.toFixed(2) : "—"}
          </span>
          <span
            className={`terminal-price-chg${
              price == null ? " placeholder" : changePositive ? " pos" : " neg"
            }`}
          >
            {price == null ? "—" : `${changePositive ? "▲" : "▼"} ${Math.abs(change).toFixed(2)}`}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ── Overrides section (with help popover) ─────────────────
 *
 * Native `title` tooltips don't fire on mobile-Firefox tap (the
 * primary surface), so the explanation is dead code without a tap-
 * triggered affordance. Instead: small `ⓘ` glyph next to the
 * "Overrides" label opens a popover with two-layer copy — plain
 * lead sentence first, then the named conditions for the user who
 * wants the full list.
 */
function OverridesSection({
  overrides,
  overridesBody,
}: {
  overrides: string[];
  overridesBody: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Acknowledge the overrides count in the help button's aria-label
  // so screen readers don't lose the state context when the popover
  // is closed. e.g. "Overrides: clear, what does this mean?"
  const stateAria = overrides.length === 0 ? "clear" : `${overrides.length} firing`;

  return (
    <div className="terminal-overrides" ref={wrapRef}>
      <span className="terminal-overrides-label">
        Overrides
        <button
          type="button"
          className="terminal-overrides-help-trigger"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="overrides-help-panel"
          aria-label={`Overrides ${stateAria}, what does this mean?`}
        >
          ⓘ
        </button>
      </span>
      <span className="terminal-overrides-body">{overridesBody}</span>
      {open && (
        <div
          id="overrides-help-panel"
          className="terminal-overrides-help-pop"
          role="dialog"
          aria-label="Overrides explained"
        >
          <p className="terminal-overrides-help-lead">
            Risk flags that invalidate the headline score.
            {" "}
            <strong>Clear</strong> means none are firing — read the
            score normally.
          </p>
          <p className="terminal-overrides-help-list">
            Conditions: gamma-flip lost · weekly VWAP lost ·
            backwardation · VIX spike. When one fires, the score
            dims and the flag appears in the body of this row.
          </p>
        </div>
      )}
    </div>
  );
}

function formatRegime(label: string): React.ReactNode {
  // "trending" → "TRENDING" with a tonal italic-serif word echo;
  // for PR β we keep it simple and uppercase the label
  return label.replace("_", " ").toUpperCase();
}

/* ── Middle band: chart + system feed (spec §4.2 + §4.3) ──── */

function MiddleBand({ data }: { data: TerminalSnapshot | null }) {
  const [overlays, setOverlays] = useState<OverlayState>(DEFAULT_OVERLAYS);
  const [timeframe, setTimeframe] = useState<Timeframe>(DEFAULT_TIMEFRAME);
  const { tz, setTz, formatChartTime, formatChartDay, tzLabel } = useTimezone();
  const toggleBool = (key: "pocVa" | "priorHlc" | "openingRange") =>
    setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));
  const setVwap = (next: VwapOverlayState) =>
    setOverlays((prev) => ({ ...prev, vwap: next }));

  return (
    <section className="terminal-middle">
      <div className="terminal-chart">
        <div className="terminal-chart-tf">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              className={`tf-pill${timeframe === tf ? " on" : ""}`}
              onClick={() => setTimeframe(tf)}
              aria-pressed={timeframe === tf}
            >
              {tf}
            </button>
          ))}
          <ChartTzSelector tz={tz} setTz={setTz} tzLabel={tzLabel} />
        </div>
        <div className="terminal-chart-toggles">
          <AvwapPopover vwap={overlays.vwap} setVwap={setVwap} />
          {/* Gamma Flip: no data yet (third-party feed), kept disabled. */}
          <span className="pill disabled">Gamma Flip</span>
          <ToggleButton active={overlays.pocVa} onClick={() => toggleBool("pocVa")}>
            POC / VAH / VAL
          </ToggleButton>
          <ToggleButton active={overlays.priorHlc} onClick={() => toggleBool("priorHlc")}>
            Prior Day HLC
          </ToggleButton>
          <ToggleButton active={overlays.openingRange} onClick={() => toggleBool("openingRange")}>
            Opening Range
          </ToggleButton>
          {/* ML Fan: PR η scope; kept disabled. */}
          <span className="pill disabled">ML Fan</span>
        </div>
        <TerminalChartCanvas
          snapshot={data}
          overlays={overlays}
          timeframe={timeframe}
          formatBarTime={formatChartTime}
          formatBarDay={formatChartDay}
          tzLabel={tzLabel}
        />
      </div>
      <aside className="terminal-feed">
        <div className="terminal-feed-title">System Feed</div>
        <div className="terminal-feed-empty">Awaiting events.</div>
      </aside>
    </section>
  );
}

/* ── Timezone selector ─────────────────────────────────────────────
 *
 * Sits at the right end of the timeframe-pill row. Native <select>
 * styled to match the LUMEN tone (small-caps, paper-deep chip, ink-40
 * hairline). Reuses the shared `useTimezone` hook so the user's
 * timezone preference (storage key `dc.timezone`) flows across both
 * /dc and /app. "local" surfaces the browser's resolved abbreviation
 * (e.g. "PDT") in the option label.
 */
function ChartTzSelector({
  tz,
  setTz,
  tzLabel,
}: {
  tz: TZOption;
  setTz: (next: TZOption) => void;
  tzLabel: string;
}) {
  return (
    // Prefixing the closed-state value with "TZ · " makes the
    // affordance + category visible at a glance — the bare 2-letter
    // chip alongside 1m / 5m / 15m / 1h / 4h read as a sixth
    // timeframe pill in early review.
    <select
      className="terminal-chart-tz"
      value={tz}
      onChange={(e) => setTz(e.target.value as TZOption)}
      aria-label="Chart timezone"
      title={`Display chart times in ${tzLabel}`}
    >
      {TZ_OPTIONS.map((o) => (
        <option key={o} value={o}>
          {o === "local" ? `TZ · Local · ${tzLabel}` : `TZ · ${o}`}
        </option>
      ))}
    </select>
  );
}

/* ── AVWAP popover (multi-anchor checklist) ────────────────────────
 *
 * Replaces the Session-VWAP and AVWAP pills. Lets the operator turn
 * on any combination of {Week, Daily, RTH} × {VWAP, ±1σ, ±2σ}. The
 * pill reads "AVWAP · n" where n counts the number of currently-on
 * anchors (any series active under that anchor). Clicking outside
 * dismisses the popover.
 */
function AvwapPopover({
  vwap,
  setVwap,
}: {
  vwap: VwapOverlayState;
  setVwap: (next: VwapOverlayState) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Use pointerdown (not mousedown) so iOS/Android touch dismiss
    // fires before the chart's gesture handlers steal the event.
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const activeAnchorCount = VWAP_ANCHORS.reduce((n, a) => {
    const s = vwap[a.key];
    return n + (s.vwap || s.band1 || s.band2 ? 1 : 0);
  }, 0);
  const anyOn = activeAnchorCount > 0;

  const setAnchorField = (
    anchor: VwapAnchorKey,
    field: keyof VwapAnchorState,
    value: boolean,
  ) => {
    setVwap({ ...vwap, [anchor]: { ...vwap[anchor], [field]: value } });
  };

  return (
    <div className="avwap-pop-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`pill${anyOn ? " on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="avwap-pop-panel"
      >
        AVWAP{anyOn ? ` · ${activeAnchorCount}` : ""}
      </button>
      {open && (
        <div
          className="avwap-pop"
          id="avwap-pop-panel"
          role="dialog"
          aria-label="AVWAP overlays"
        >
          <div className="avwap-pop-head">
            <span className="avwap-pop-anchor-col">Anchor</span>
            <span>VWAP</span>
            <span>±1σ</span>
            <span>±2σ</span>
          </div>
          {VWAP_ANCHORS.map(({ key, label }) => {
            const state = vwap[key];
            return (
              <div className="avwap-pop-row" key={key}>
                <span className="avwap-pop-anchor-col">{label}</span>
                <AvwapCheck
                  checked={state.vwap}
                  onChange={(v) => setAnchorField(key, "vwap", v)}
                  ariaLabel={`${label} VWAP line`}
                />
                <AvwapCheck
                  checked={state.band1}
                  onChange={(v) => setAnchorField(key, "band1", v)}
                  ariaLabel={`${label} ±1σ band`}
                />
                <AvwapCheck
                  checked={state.band2}
                  onChange={(v) => setAnchorField(key, "band2", v)}
                  ariaLabel={`${label} ±2σ band`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AvwapCheck({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      className={`avwap-pop-check${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      aria-label={ariaLabel}
    >
      {checked ? "✓" : ""}
    </button>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`pill${active ? " on" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

/* ── Scorecard grid (spec §4.4 + §4.5) ───────────────────── */

function ScorecardGrid({ data }: { data: TerminalSnapshot | null }) {
  return (
    <section className="terminal-cards">
      <RegimeCard data={data} />
      <GexPlaceholderCard data={data} />
      <VwapCard data={data} />
      <LevelsCard data={data} />
      <BreadthCard data={data} />
      <SynthesisCard data={data} />
    </section>
  );
}

function RegimeCard({ data }: { data: TerminalSnapshot | null }) {
  const regime = data?.regime;
  const hasAny =
    regime != null &&
    (regime.vix != null ||
      regime.sqn != null ||
      regime.regime_label !== "unknown" ||
      regime.divergence_flag !== "none");

  const label = regime?.regime_label ?? "unknown";
  const labelClass =
    label === "volatile"
      ? "neg"
      : label === "trending"
        ? "pos"
        : label === "quiet"
          ? "neutral"
          : "neutral";

  const div = regime?.divergence_flag ?? "none";
  const divClass = div === "positive" ? "neg" : div === "negative" ? "pos" : "neutral";

  return (
    <div className="terminal-card">
      <div className="terminal-card-title-row">
        <span className="terminal-card-title">{SYSTEM_LABELS.volatility}</span>
        <span className="terminal-card-ts">—</span>
      </div>
      <div className="terminal-card-score">
        <span className="num placeholder">—</span>
        <span className="slash">⁄</span>
        <span className="denom">—</span>
      </div>
      <div className="terminal-card-body">
        {hasAny ? (
          <ul className="levels-list breadth-list">
            <LevelRow label="VIX" value={regime!.vix} />
            <li className="levels-row">
              <span className="levels-label">SQN</span>
              <span
                className={`levels-value${regime!.sqn == null ? " placeholder" : ""}`}
              >
                {regime!.sqn != null
                  ? `${regime!.sqn >= 0 ? "+" : ""}${regime!.sqn.toFixed(2)}`
                  : "—"}
              </span>
            </li>
            <li className="levels-row">
              <span className="levels-label">Regime</span>
              <span
                className={`levels-value lead-${labelClass}${
                  label === "unknown" ? " placeholder" : ""
                }`}
              >
                {formatRegimeLabel(label)}
              </span>
            </li>
            <li className="levels-row" title={divergenceHoverHint(div)}>
              <span className="levels-label">ES/VIX</span>
              <span
                className={`levels-value lead-${divClass}${
                  div === "none" ? " placeholder" : ""
                }`}
              >
                {formatDivergence(div)}
              </span>
            </li>
          </ul>
        ) : (
          <span className="empty">Awaiting data.</span>
        )}
      </div>
    </div>
  );
}

function formatRegimeLabel(label: string): string {
  // Vocabulary mirrors the design spec §4.1 headline-strip set
  // (TREND / RANGE / VOLATILE) with "Quiet" as the carved-out
  // sub-state when both VIX and SQN read calm.
  if (label === "trending") return "Trend";
  if (label === "mean_reverting") return "Range";
  if (label === "volatile") return "Volatile";
  if (label === "quiet") return "Quiet";
  return "—";
}

function divergenceHoverHint(d: string): string {
  if (d === "positive") return "Positive divergence — ES + VIX both rising, distribution warning";
  if (d === "negative") return "Negative divergence — ES + VIX both falling, capitulation hint";
  if (d === "none") return "ES and VIX moving inversely (normal regime)";
  return "";
}

function formatDivergence(d: string): string {
  // Spec speaks "positive/negative divergence". We keep that
  // vocabulary on the card; the risk-aware coloring (positive →
  // persimmon because positive divergence is a distribution warning,
  // negative → cream because it's a capitulation hint) is encoded in
  // `divClass` above. Title attribute on the row provides the long
  // form for hover.
  if (d === "positive") return "Positive";
  if (d === "negative") return "Negative";
  if (d === "none") return "Aligned";
  return "—";
}

function VwapCard({ data }: { data: TerminalSnapshot | null }) {
  const vwap = data?.vwap;
  // Open the populated body only when at least one VWAP value is present.
  // An anchored[] full of {value: null} entries shouldn't render a wall
  // of dashes — fall back to the empty state.
  const hasAny =
    vwap != null &&
    (vwap.session_vwap != null ||
      vwap.anchored.some((a) => a.value != null));

  return (
    <div className="terminal-card">
      <div className="terminal-card-title-row">
        <span className="terminal-card-title">{SYSTEM_LABELS.structure}</span>
        <span className="terminal-card-ts">—</span>
      </div>
      <div className="terminal-card-score">
        <span className="num placeholder">—</span>
        <span className="slash">⁄</span>
        <span className="denom">—</span>
      </div>
      <div className="terminal-card-body">
        {hasAny ? (
          <ul className="levels-list">
            <LevelRow label="Session VWAP" value={vwap!.session_vwap} />
            {vwap!.anchored.map((a) => (
              <LevelRow key={a.name} label={a.name} value={a.value} />
            ))}
            <li className="levels-row">
              <span className="levels-label">VWAP Confluence</span>
              <span
                className={`levels-value${
                  vwap!.confluence_count >= 2 ? "" : " placeholder"
                }`}
              >
                {vwap!.confluence_count >= 2 && vwap!.confluence_price != null
                  ? `≥${vwap!.confluence_count} @ ${vwap!.confluence_price.toFixed(2)}`
                  : "—"}
              </span>
            </li>
          </ul>
        ) : (
          <span className="empty">Awaiting data.</span>
        )}
      </div>
    </div>
  );
}

function LevelsCard({ data }: { data: TerminalSnapshot | null }) {
  const levels = data?.levels;
  const hasAny =
    levels != null &&
    (levels.pd_high != null ||
      levels.pd_low != null ||
      levels.pd_close != null ||
      levels.poc != null ||
      levels.vah != null ||
      levels.val != null ||
      levels.or_high != null ||
      levels.or_low != null);

  return (
    <div className="terminal-card">
      <div className="terminal-card-title-row">
        <span className="terminal-card-title">{SYSTEM_LABELS.levels}</span>
        <span className="terminal-card-ts">—</span>
      </div>
      <div className="terminal-card-score">
        <span className="num placeholder">—</span>
        <span className="slash">⁄</span>
        <span className="denom">—</span>
      </div>
      <div className="terminal-card-body">
        {hasAny ? (
          <ul className="levels-list">
            <LevelRow label="POC" value={levels!.poc} />
            <LevelRow label="VAH" value={levels!.vah} />
            <LevelRow label="VAL" value={levels!.val} />
            <LevelRow label="Prior H" value={levels!.pd_high} />
            <LevelRow label="Prior L" value={levels!.pd_low} />
            <LevelRow label="Prior C" value={levels!.pd_close} />
            <LevelRow label="OR High" value={levels!.or_high} />
            <LevelRow label="OR Low" value={levels!.or_low} />
          </ul>
        ) : (
          <span className="empty">Awaiting data.</span>
        )}
      </div>
    </div>
  );
}

function LevelRow({ label, value }: { label: string; value: number | null }) {
  return (
    <li className="levels-row">
      <span className="levels-label">{label}</span>
      <span className={`levels-value${value == null ? " placeholder" : ""}`}>
        {value != null ? value.toFixed(2) : "—"}
      </span>
    </li>
  );
}

function BreadthCard({ data }: { data: TerminalSnapshot | null }) {
  const breadth = data?.breadth;
  // Open the populated body only when at least one numeric field is
  // present. A stray "neutral" lead-signal with all numerics null is a
  // degenerate state and should fall back to "Awaiting data."
  const hasAny =
    breadth != null &&
    (breadth.tick != null ||
      breadth.trin != null ||
      breadth.hyg_lqd_ratio != null);

  const lead = breadth?.hyg_lqd_lead_signal ?? "unknown";
  const leadClass =
    lead === "bullish" ? "pos" : lead === "bearish" ? "neg" : "neutral";

  return (
    <div className="terminal-card">
      <div className="terminal-card-title-row">
        <span className="terminal-card-title">{SYSTEM_LABELS.breadth}</span>
        <span className="terminal-card-ts">—</span>
      </div>
      <div className="terminal-card-score">
        <span className="num placeholder">—</span>
        <span className="slash">⁄</span>
        <span className="denom">—</span>
      </div>
      <div className="terminal-card-body">
        {hasAny ? (
          <ul className="levels-list breadth-list">
            <BreadthRow
              label="TICK"
              display={
                breadth!.tick != null
                  ? `${breadth!.tick > 0 ? "+" : ""}${breadth!.tick}`
                  : null
              }
            />
            <BreadthRow
              label="TRIN"
              display={breadth!.trin != null ? breadth!.trin.toFixed(2) : null}
            />
            <BreadthRow
              label="HYG/LQD"
              display={
                breadth!.hyg_lqd_ratio != null
                  ? breadth!.hyg_lqd_ratio.toFixed(4)
                  : null
              }
            />
            <li className="levels-row">
              <span className="levels-label">Credit Lead</span>
              <span className={`levels-value lead-${leadClass}`}>
                {formatLead(lead)}
              </span>
            </li>
          </ul>
        ) : (
          <span className="empty">Awaiting data.</span>
        )}
      </div>
    </div>
  );
}

function BreadthRow({ label, display }: { label: string; display: string | null }) {
  return (
    <li className="levels-row">
      <span className="levels-label">{label}</span>
      <span className={`levels-value${display == null ? " placeholder" : ""}`}>
        {display ?? "—"}
      </span>
    </li>
  );
}

// Backend speaks bullish/bearish for the HYG/LQD lead signal; the more
// natural framing for a credit-spread proxy is risk-on/risk-off, so we
// remap at the display boundary. Keep the backend vocabulary intact —
// the mapping is purely cosmetic.
function formatLead(lead: string): string {
  if (lead === "bullish") return "Risk-on";
  if (lead === "bearish") return "Risk-off";
  if (lead === "neutral") return "Neutral";
  return "—";
}

function GexPlaceholderCard({ data }: { data: TerminalSnapshot | null }) {
  const message = data?.gex?.message ?? "GEX placeholder.";
  return (
    <div className="terminal-card gex-placeholder">
      <div className="terminal-card-title-row">
        <span className="terminal-card-title">{SYSTEM_LABELS.gamma}</span>
        <span className="terminal-card-ts">—</span>
      </div>
      <div className="terminal-card-score">
        <span className="num placeholder">—</span>
        <span className="slash">⁄</span>
        <span className="denom">—</span>
      </div>
      <div className="terminal-card-body">
        <span className="placeholder-msg">{message}</span>
      </div>
    </div>
  );
}

// SYNTHESIS card body is the weighted-contribution matrix — bias /
// conviction / overrides live in the headline strip (§4.1), not here.
// The card is just the score number reduction + the 5-row contribution
// bars.
//
// PRIVACY DEVIATION FROM SPEC §4.5: spec mandates label format
// "{system_short} · {weight}" with the actual numeric weight visible
// (e.g. "Vol · 3"). We render only the system_short — the weights are
// the synthesizer's "alpha" (the design's opinion of which signals
// matter most), and exposing them in the public bundle is a leak of
// proprietary research. The right-column numeric contribution still
// shows magnitude per system; the operator can see relative
// importance from contribution sizes without seeing the raw weight.
const SYSTEM_SHORT: Record<string, string> = {
  volatility: "Vol",
  gamma: "Gam",
  structure: "Str",
  levels: "Lvl",
  breadth: "Brd",
};

function SynthesisCard({ data }: { data: TerminalSnapshot | null }) {
  const synth = data?.synthesizer;
  const score = synth?.score ?? null;
  const bias = synth?.bias ?? "FLAT";
  const contributions = synth?.contributions ?? [];

  const hasScore = score != null && bias !== "FLAT";
  // Per spec §4.5: SYNTHESIS card score uses Editorial Italic at 64px,
  // mirroring the headline. Float-format with one decimal here since
  // the card's smaller size benefits from precision; headline keeps
  // its integer monumental glyph.
  const scoreDisplay = hasScore
    ? `${score! >= 0 ? "+" : ""}${score!.toFixed(1)}`
    : score === 0
      ? "0.0"
      : "—";

  return (
    <div className="terminal-card synthesis">
      <div className="terminal-card-title-row">
        <span className="terminal-card-title">{SYSTEM_LABELS.synthesis}</span>
        <span className="terminal-card-ts">—</span>
      </div>
      <div className="terminal-card-score">
        <span className={`num${hasScore ? "" : " placeholder"}`}>{scoreDisplay}</span>
      </div>
      <div className="terminal-card-body">
        {synth != null && contributions.length > 0 ? (
          <ul className="synth-contributions">
            {contributions.map((c) => (
              <ContributionBar key={c.system} contribution={c} />
            ))}
          </ul>
        ) : (
          <span className="empty">Awaiting input system scores.</span>
        )}
      </div>
    </div>
  );
}

function ContributionBar({ contribution }: { contribution: SynthesizerContribution }) {
  const { system, contribution: value, share } = contribution;
  const widthPct = Math.abs(share) * 50; // share in [-1,1] → 0..50% of half-width
  const direction = share >= 0 ? "pos" : "neg";
  const label = SYSTEM_SHORT[system] ?? system;
  const valueDisplay =
    value === 0
      ? "0.0"
      : `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
  const valueClass = value > 0 ? "pos" : value < 0 ? "neg" : "zero";
  return (
    <li className="synth-contribution-row">
      <span className="synth-contribution-label">{label}</span>
      <div className="synth-contribution-track">
        <div className="synth-contribution-centerline" />
        <div
          className={`synth-contribution-fill ${direction}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span className={`synth-contribution-value ${valueClass}`}>{valueDisplay}</span>
    </li>
  );
}
