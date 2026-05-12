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
import { useDensity, type DensityOption } from "../../hooks/useDensity";
import {
  TerminalChartCanvas,
  VWAP_ANCHORS,
  OR_WINDOWS,
  type OverlayState,
  type Timeframe,
  type VwapAnchorKey,
  type VwapAnchorState,
  type VwapOverlayState,
  type OrOverlayState,
  type OrWindowKey,
  DEFAULT_OVERLAYS,
  DEFAULT_TIMEFRAME,
} from "./TerminalChartCanvas";

const TZ_OPTIONS: TZOption[] = ["ET", "CT", "MT", "PT", "local"];

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h"];
import type { SynthesizerContribution, TerminalSnapshot } from "../../api/terminalTypes";
import { deriveScoreRenderState } from "../../lib/synthesizerFlatState";
import { RouteNav } from "../nav/RouteNav";
import { SystemFeed } from "./SystemFeed";
import { OverlaysSheet } from "./OverlaysSheet";
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
  // Single source of truth for "directional" vs "flat-sub-state"
  // rendering. Shared with SynthesisCard so the two surfaces never
  // disagree about which chip to show (#276).
  const renderState = deriveScoreRenderState(data?.synthesizer);
  const isDirectional = renderState.kind === "directional";
  // Always show the score number when we have one — even at -0.24 the
  // operator wants to see proximity-to-threshold. Only the true
  // AWAITING (score null) state renders the em-dash placeholder.
  // Per spec §4.1: the headline score is a 240px monumental Editorial
  // Italic glyph — meant to read as a sculptural object, not telemetry.
  // Integer rounding keeps the figure clean. The SynthesisCard body
  // shows the same number with one decimal where precision matters.
  const isAwaiting = renderState.kind === "flat" && renderState.sub === "AWAITING";
  const scoreDisplay = isAwaiting
    ? "—"
    : `${score! >= 0 ? "+" : ""}${Math.round(score!)}`;

  const regimeLabel = data?.regime?.regime_label ?? "unknown";
  const hasRegime = regimeLabel !== "unknown";

  const overrides = data?.synthesizer?.overrides ?? [];
  const overridesBody = overrides.length === 0 ? "clear" : overrides.join(" · ");

  const price = data?.es_price;
  const change = data?.es_change ?? 0;
  const changePositive = change >= 0;

  // Headline-strip label copy for each render state. The placeholder
  // class de-emphasizes the glyph for non-directional states so the
  // sculptural element doesn't pretend to be actionable telemetry.
  // BLOCKED with an underlyingBias (#279) surfaces the would-be
  // direction in the bottom label so the operator can see WHAT the
  // synthesizer wanted to say despite the override — useful for
  // attribution and noticing over-firing overrides.
  const labelTop = isDirectional
    ? (renderState.bias === "LONG" ? "Buy" : "Sell")
    : renderState.sub === "AWAITING"
      ? "Awaiting"
      : renderState.sub === "BLOCKED"
        ? "Blocked"
        : renderState.sub === "MIXED"
          ? "Mixed"
          : "Neutral";
  const labelBottom = isDirectional
    ? "Bias"
    : renderState.sub === "AWAITING"
      ? "Data"
      : renderState.sub === "BLOCKED"
        ? renderState.underlyingBias === "LONG"
          ? "would-be Buy"
          : renderState.underlyingBias === "SHORT"
            ? "would-be Sell"
            : "Override"
        : renderState.sub === "MIXED"
          ? "Split"
          : "No signal";

  // Tint the headline label by sub-state so the 240px monumental
  // glyph isn't the only color cue (R2 nit). Headline glyph stays
  // ink-40 grayscale per the sculptural treatment; the small label
  // beneath picks up the chip color so glance-reading the headline
  // surfaces MIXED-vs-NEUTRAL-vs-BLOCKED without scanning to the
  // SynthesisCard.
  const labelClass = !isDirectional
    ? ` flat-${renderState.sub.toLowerCase()}`
    : "";

  return (
    <section className="terminal-headline">
      <div className="terminal-score-block">
        <span className={`terminal-score${isDirectional ? "" : " placeholder"}`}>{scoreDisplay}</span>
        <span className={`terminal-score-label${labelClass}`}>
          {labelTop}
          <br />
          {labelBottom}
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
  const [popPos, setPopPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The headline strip has `overflow: hidden` (load-bearing for the
  // sweep-line and brand-thesis chrome) — an `position: absolute`
  // popover anchored inside the strip gets clipped where it extends
  // below the strip into the chart pane. Position `fixed` escapes
  // any ancestor overflow / stacking context. Coords are computed
  // from the trigger's getBoundingClientRect at open time and clamped
  // to keep the panel inside the viewport with an 8px gutter.
  const POP_W = 320;
  const VIEWPORT_GUTTER = 8;
  const computePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const left = Math.max(
      VIEWPORT_GUTTER,
      Math.min(r.left, vw - POP_W - VIEWPORT_GUTTER),
    );
    const top = r.bottom + 6;
    setPopPos({ top, left });
  };

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
    // Re-anchor on viewport resize. On scroll, dismiss outright
    // (the trigger may have scrolled off-screen, leaving the
    // position-fixed popover orphaned at viewport coords). Capture
    // mode catches scrolls inside any inner-scrollable ancestor,
    // not just window-level scrolling.
    const onResize = () => computePos();
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
    };
  }, [open]);

  const handleToggle = () => {
    if (!open) computePos();
    setOpen((o) => !o);
  };

  const stateAria = overrides.length === 0 ? "clear" : `${overrides.length} firing`;

  return (
    <div className="terminal-overrides" ref={wrapRef}>
      <span className="terminal-overrides-label">
        Overrides
        <button
          ref={triggerRef}
          type="button"
          className="terminal-overrides-help-trigger"
          onClick={handleToggle}
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
          style={{ top: popPos.top, left: popPos.left }}
        >
          <p className="terminal-overrides-help-lead">
            Risk flags that invalidate the headline score.
            {" "}
            <strong>Clear</strong> means none are firing — read the
            score normally.
          </p>
          <p className="terminal-overrides-help-list">
            Conditions: weekly VWAP lost · backwardation · VIX spike ·
            credit divergence. (Gamma flip lost ships when the GEX
            feed lands — currently deferred.) Each condition requires
            sustained breach (multi-minute confirm) before firing —
            single-snapshot grazes don't dim the score.
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
  const { density, setDensity } = useDensity();
  // PR 2 of the mobile-chart series (AVWAP multi-anchor, Opening
  // Range bands, ETH session shading) is now live, so the AVWAP
  // and OR popovers render on mobile too — no isMobile gate needed.
  const toggleBool = (key: "pocVa" | "priorHlc") =>
    setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));
  const setVwap = (next: VwapOverlayState) =>
    setOverlays((prev) => ({ ...prev, vwap: next }));
  const setOpeningRange = (next: OrOverlayState) =>
    setOverlays((prev) => ({ ...prev, openingRange: next }));

  return (
    <section className="terminal-middle" data-density={density}>
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
          <DensitySelector density={density} setDensity={setDensity} />
        </div>
        {/* Desktop toolbar: inline pills + popovers. Hidden on
            mobile via CSS — the OverlaysSheet below replaces it. */}
        <div className="terminal-chart-toggles terminal-chart-toggles-desktop">
          <AvwapPopover vwap={overlays.vwap} setVwap={setVwap} />
          <ToggleButton active={overlays.pocVa} onClick={() => toggleBool("pocVa")}>
            POC / VAH / VAL
          </ToggleButton>
          <ToggleButton active={overlays.priorHlc} onClick={() => toggleBool("priorHlc")}>
            PDH / PDL / PDC
          </ToggleButton>
          <OpeningRangePopover or={overlays.openingRange} setOr={setOpeningRange} />
          {/* ML Fan: PR η scope; kept disabled. */}
          <span className="pill disabled">ML Fan</span>
        </div>
        {/* Mobile-only overlays trigger — opens the bottom sheet
            with all overlay controls in one tap-friendly stack.
            Hidden on desktop via CSS. */}
        <div className="terminal-chart-overlays-mobile">
          <OverlaysSheet
            overlays={overlays}
            setVwap={setVwap}
            setOpeningRange={setOpeningRange}
            togglePocVa={() => toggleBool("pocVa")}
            togglePriorHlc={() => toggleBool("priorHlc")}
          />
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
      <SystemFeed
        data={data}
        tz={tz}
        formatChartTime={formatChartTime}
        tzLabel={tzLabel}
      />
    </section>
  );
}

/* ── Timezone selector ─────────────────────────────────────────────
 *
 * Sits at the right end of the timeframe-pill row. Native <select>
 * stripped of UA chrome (small-caps, bg-inset chip, ink-40 hairline)
 * to match the surrounding pill grammar. Reuses the shared
 * `useTimezone` hook so the user's
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

/* ── Density selector ──────────────────────────────────────────────
 *
 * Two-state typography density toggle for the sidebar surfaces
 * (System Feed live event log, Active Now, Upcoming 24h calendar).
 * Default "compact" matches the trader-terminal aesthetic with
 * maximum information density. "Comfortable" bumps font sizes ~+2px
 * and loosens line-height for readability — addresses the "too
 * small" complaint without forcing the change on operators who
 * prefer the dense view.
 *
 * Persisted via `useDensity` (storage key `dc.density`); the parent
 * MiddleBand applies `data-density` on the `.terminal-middle` root
 * so CSS overrides can target the sidebar surfaces with a single
 * `[data-density="comfortable"] ...` selector. No prop drilling
 * needed beyond the dashboard root.
 */
function DensitySelector({
  density,
  setDensity,
}: {
  density: DensityOption;
  setDensity: (next: DensityOption) => void;
}) {
  return (
    <select
      className="terminal-chart-tz"
      value={density}
      onChange={(e) => setDensity(e.target.value as DensityOption)}
      aria-label="Sidebar density"
      title={
        density === "compact"
          ? "Switch to comfortable (larger sidebar text)"
          : "Switch to compact (denser sidebar text)"
      }
    >
      <option value="compact">Density · Compact</option>
      <option value="comfortable">Density · Comfortable</option>
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

/* ── Opening Range popover (multi-window checklist) ────────────────
 *
 * Replaces the single Opening-Range pill. Lets the operator turn on
 * any combination of {1m, 5m, 15m} OR windows. Pill reads
 * "OR · n" where n counts active windows; click outside or press
 * Escape to dismiss.
 */
function OpeningRangePopover({
  or,
  setOr,
}: {
  or: OrOverlayState;
  setOr: (next: OrOverlayState) => void;
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

  const activeCount = OR_WINDOWS.reduce((n, w) => n + (or[w.key] ? 1 : 0), 0);
  const anyOn = activeCount > 0;

  const setWindowOn = (key: OrWindowKey, value: boolean) => {
    setOr({ ...or, [key]: value });
  };

  return (
    <div className="avwap-pop-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`pill${anyOn ? " on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="or-pop-panel"
      >
        Opening Range{anyOn ? ` · ${activeCount}` : ""}
      </button>
      {open && (
        <div
          className="avwap-pop or-pop"
          id="or-pop-panel"
          role="dialog"
          aria-label="Opening range overlays"
        >
          <div className="avwap-pop-head">
            <span className="avwap-pop-anchor-col">Window</span>
            <span>Show</span>
          </div>
          {OR_WINDOWS.map(({ key, label }) => (
            <div className="avwap-pop-row" key={key}>
              <span className="avwap-pop-anchor-col">{label}</span>
              <AvwapCheck
                checked={or[key]}
                onChange={(v) => setWindowOn(key, v)}
                ariaLabel={`${label} opening range`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
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

/* ── Card score helper ───────────────────────────────────────────
 *
 * Per spec §4.5: card score format is "{score} ⁄ {weight}". The
 * numerator is the system's INTERNAL signed score (not the weighted
 * contribution to the synthesizer total). Showing `contribution`
 * (= score × weight) here would leak more about the weights than
 * showing `score` alone, since a competitor replicating a canonical
 * scoring formula could regress contribution against derived
 * inputs. Showing raw score reveals only the system's signal
 * magnitude — which is what the operator actually wants to read.
 *
 * Per the privacy threshold, the denominator stays "—" because
 * synthesizer weights are proprietary alpha.
 */
function getSystemScore(
  data: TerminalSnapshot | null,
  system: "volatility" | "gamma" | "structure" | "levels" | "breadth",
): number | null {
  const c = data?.synthesizer?.contributions?.find((x) => x.system === system);
  return c ? c.score : null;
}

function CardScore({ value }: { value: number | null }) {
  const has = value != null;
  const display = has
    ? `${value! >= 0 ? "+" : ""}${value!.toFixed(1)}`
    : "—";
  const cls = has ? (value! > 0 ? "pos" : value! < 0 ? "neg" : "zero") : "placeholder";

  // Trend glyph in the slot where spec §4.4's denominator used to live.
  // The original quantitative sketch (main-page-redesign-sketch.md, line 99)
  // intended the denom to be the per-system max — which is exactly the
  // weight the privacy carve-out (PR ζ, 2026-04-25) keeps off the public
  // bundle. Displaying a per-system trend signal honors §4.4's two-glyph
  // grammar without leaking weights.
  //
  // Deadband: tied to displayed precision (one decimal). The glyph fires
  // only when the rendered value would actually change — `+1.24 → +1.27`
  // both display as "+1.2" and produce a flat trend; `+1.24 → +1.31`
  // crosses the digit boundary and produces ▲. Keeps the glyph from
  // jittering on sub-display-precision noise.
  //
  // Per-instance useRef: each <CardScore> in the JSX tree gets its own
  // hook state, so the 5 input scorecards each remember their own prior
  // value without needing a system-key prop.
  const prevDisplayedRef = useRef<number | null>(null);
  let trend: "up" | "down" | "flat" = "flat";
  if (has && prevDisplayedRef.current != null) {
    const cur = Math.round(value! * 10);
    const prev = prevDisplayedRef.current;
    if (cur > prev) trend = "up";
    else if (cur < prev) trend = "down";
  }
  useEffect(() => {
    if (has) prevDisplayedRef.current = Math.round(value! * 10);
  }, [has, value]);

  // First render (prev null) and unchanged-value renders both produce
  // a `flat` trend. Render the glyph slot only when there's a real
  // ▲ or ▼ to show — flat reads cleaner as a single number than as
  // "+1.2 ·" with a dot.
  const glyph = trend === "up" ? "▲" : trend === "down" ? "▼" : null;

  return (
    <div className="terminal-card-score">
      <span className={`num ${cls}`}>{display}</span>
      {glyph && (
        <span
          className={`trend ${trend}`}
          aria-label={trend === "up" ? "score rising" : "score falling"}
          title={trend === "up" ? "Score rose since last cycle" : "Score fell since last cycle"}
        >
          {glyph}
        </span>
      )}
    </div>
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
      <CardScore value={getSystemScore(data, "volatility")} />
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
      <CardScore value={getSystemScore(data, "structure")} />
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
      levels.or_5m_high != null ||
      levels.or_5m_low != null ||
      levels.or_1m_high != null ||
      levels.or_15m_high != null);

  return (
    <div className="terminal-card">
      <div className="terminal-card-title-row">
        <span className="terminal-card-title">{SYSTEM_LABELS.levels}</span>
        <span className="terminal-card-ts">—</span>
      </div>
      <CardScore value={getSystemScore(data, "levels")} />
      <div className="terminal-card-body">
        {hasAny ? (
          <ul className="levels-list">
            <LevelRow label="POC" value={levels!.poc} />
            <LevelRow label="VAH" value={levels!.vah} />
            <LevelRow label="VAL" value={levels!.val} />
            <LevelRow label="PDH" value={levels!.pd_high} />
            <LevelRow label="PDL" value={levels!.pd_low} />
            <LevelRow label="PDC" value={levels!.pd_close} />
            <LevelRow label="OR-1 H" value={levels!.or_1m_high} />
            <LevelRow label="OR-1 L" value={levels!.or_1m_low} />
            <LevelRow label="OR-5 H" value={levels!.or_5m_high} />
            <LevelRow label="OR-5 L" value={levels!.or_5m_low} />
            <LevelRow label="OR-15 H" value={levels!.or_15m_high} />
            <LevelRow label="OR-15 L" value={levels!.or_15m_low} />
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
      <CardScore value={getSystemScore(data, "breadth")} />
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
      <CardScore value={getSystemScore(data, "gamma")} />
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
  const contributions = synth?.contributions ?? [];

  // Same render-state derivation as the headline strip (#276) so the
  // two surfaces never disagree about which chip to show. Score number
  // is always shown when score != null (even at -0.24 in NEUTRAL/MIXED)
  // — operator wants to see proximity-to-threshold instead of "—".
  const renderState = deriveScoreRenderState(synth);
  const isDirectional = renderState.kind === "directional";
  const isAwaiting = renderState.kind === "flat" && renderState.sub === "AWAITING";

  // Per spec §4.5: SYNTHESIS card score uses Editorial Italic at 64px,
  // mirroring the headline. Float-format with one decimal here since
  // the card's smaller size benefits from precision; headline keeps
  // its integer monumental glyph.
  const scoreDisplay = isAwaiting
    ? "—"
    : `${score! >= 0 ? "+" : ""}${score!.toFixed(1)}`;

  return (
    <div className="terminal-card synthesis">
      <div className="terminal-card-title-row">
        <span className="terminal-card-title">{SYSTEM_LABELS.synthesis}</span>
        <span className="terminal-card-ts">—</span>
      </div>
      <div className="terminal-card-score">
        <span className={`num${isDirectional ? "" : " placeholder"}`}>{scoreDisplay}</span>
        {renderState.kind === "flat" && renderState.sub !== "AWAITING" && (
          <FlatSubStateChip
            subState={renderState.sub}
            overrides={synth?.overrides ?? []}
            underlyingBias={renderState.underlyingBias}
          />
        )}
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

/** Small chip rendered next to the SYNTHESIS card's score number when
 *  bias is not directional (#276). Distinct color + copy for each
 *  sub-state so the operator can tell at a glance whether the system
 *  is "no signal" (NEUTRAL), "systems disagree" (MIXED), or "override
 *  is suppressing actionability" (BLOCKED). AWAITING is suppressed by
 *  the caller — the em-dash placeholder is signal enough. */
function FlatSubStateChip({
  subState,
  overrides,
  underlyingBias,
}: {
  subState: "BLOCKED" | "MIXED" | "NEUTRAL";
  overrides: string[];
  underlyingBias?: "LONG" | "SHORT";
}) {
  const className = `flat-sub-chip ${subState.toLowerCase()}`;
  // Tooltips lead with what the operator should DO (R2 nit) — not
  // just describe the mechanism. The "no edge" language pairs with
  // the broader trader vocabulary (vs telemetry-speak like "no
  // directional signal").
  // For BLOCKED with an underlying directional lean (#279), append
  // the would-be direction so the operator can see WHAT the
  // synthesizer wanted to say despite the override — useful for
  // attribution and for spotting overrides that may be over-firing.
  const blockedSuffix =
    underlyingBias === "LONG"
      ? " The synthesizer's underlying view would have been LONG (Buy)."
      : underlyingBias === "SHORT"
        ? " The synthesizer's underlying view would have been SHORT (Sell)."
        : "";
  const title =
    subState === "BLOCKED"
      ? `Override active: ${overrides.join(", ")}. Do not trade off the score — the synthesizer's directional view is being suppressed by a hard-stop condition.${blockedSuffix}`
      : subState === "MIXED"
        ? "Sub-systems disagree (large contributions in opposing directions); score nets near zero. Wait for resolution before sizing — one tick could flip the bias."
        : "All sub-systems near zero; no edge. Stand down until a directional setup forms.";
  // Compact inline "BLOCKED → BUY" treatment when an underlying bias
  // exists, so the operator sees the would-be direction at a glance
  // even without hovering. ASCII arrow keeps glyph weight light.
  const chipText =
    subState === "BLOCKED" && underlyingBias
      ? `${subState} → ${underlyingBias === "LONG" ? "BUY" : "SELL"}`
      : subState;
  return (
    <span className={className} title={title}>
      {chipText}
    </span>
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
