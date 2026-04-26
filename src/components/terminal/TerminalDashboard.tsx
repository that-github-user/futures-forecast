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

import { useTerminalSnapshot } from "../../hooks/useTerminalSnapshot";
import type { TerminalSnapshot } from "../../api/terminalTypes";
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
      <MiddleBand />
      <ScorecardGrid data={data} />
    </div>
  );
}

/* ── Headline strip (spec §4.1) ──────────────────────────── */

function HeadlineStrip({ data }: { data: TerminalSnapshot | null }) {
  const score = data?.synthesizer?.score;
  const hasScore = score !== undefined && score !== null && data?.synthesizer.bias !== "FLAT";
  const scoreDisplay = hasScore
    ? `${score! >= 0 ? "+" : ""}${score!.toFixed(0)}`
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
      <div className="terminal-overrides">
        <span className="terminal-overrides-label">Overrides</span>
        <span className="terminal-overrides-body">{overridesBody}</span>
      </div>
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

function formatRegime(label: string): React.ReactNode {
  // "trending" → "TRENDING" with a tonal italic-serif word echo;
  // for PR β we keep it simple and uppercase the label
  return label.replace("_", " ").toUpperCase();
}

/* ── Middle band: chart + system feed (spec §4.2 + §4.3) ──── */

function MiddleBand() {
  return (
    <section className="terminal-middle">
      <div className="terminal-chart">
        <div className="terminal-chart-toggles">
          <span className="pill">Session VWAP</span>
          <span className="pill">AVWAP</span>
          <span className="pill">Gamma Flip</span>
          <span className="pill">POC / VAH / VAL</span>
          <span className="pill">Prior Day HLC</span>
          <span className="pill">Opening Range</span>
          <span className="pill">ML Fan</span>
        </div>
        <div className="terminal-chart-canvas">Awaiting live ES data — toggle pills activate when overlays land</div>
      </div>
      <aside className="terminal-feed">
        <div className="terminal-feed-title">System Feed</div>
        <div className="terminal-feed-empty">Awaiting events.</div>
      </aside>
    </section>
  );
}

/* ── Scorecard grid (spec §4.4 + §4.5) ───────────────────── */

function ScorecardGrid({ data }: { data: TerminalSnapshot | null }) {
  return (
    <section className="terminal-cards">
      <SystemCard system="volatility" />
      <GexPlaceholderCard data={data} />
      <SystemCard system="structure" />
      <LevelsCard data={data} />
      <BreadthCard data={data} />
      <SynthesisCard data={data} />
    </section>
  );
}

type InputSystem = "volatility" | "structure" | "levels" | "breadth";

function SystemCard({ system }: { system: InputSystem }) {
  // PR β: no per-system score logic yet — that lands when individual
  // systems wire up in PRs γ and δ. Denominator stays `—` until the
  // synthesizer endpoint exposes its share/contribution payload, since
  // raw weights aren't shipped through the API per the privacy threshold.
  return (
    <div className="terminal-card">
      <div className="terminal-card-title-row">
        <span className="terminal-card-title">{SYSTEM_LABELS[system]}</span>
        <span className="terminal-card-ts">—</span>
      </div>
      <div className="terminal-card-score">
        <span className="num placeholder">—</span>
        <span className="slash">⁄</span>
        <span className="denom">—</span>
      </div>
      <div className="terminal-card-body">
        <span className="empty">Awaiting data.</span>
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

function SynthesisCard({ data }: { data: TerminalSnapshot | null }) {
  const score = data?.synthesizer?.score;
  const hasScore = score !== undefined && score !== null && data?.synthesizer.bias !== "FLAT";
  const scoreDisplay = hasScore ? `${score! >= 0 ? "+" : ""}${score!.toFixed(0)}` : "—";

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
        <span className="empty">Awaiting input system scores.</span>
      </div>
    </div>
  );
}
