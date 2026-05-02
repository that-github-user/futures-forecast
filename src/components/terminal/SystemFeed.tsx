/**
 * SystemFeed — rolling event log per spec §4.3 ("editorial event log").
 *
 * Five event types, all derived frontend-side from cycle-over-cycle
 * snapshot deltas (no new backend signals required for the MVP):
 *
 *   TICK      — breadth.tick magnitude crosses the institutional-
 *               program threshold (|tick| ≥ TICK_THRESHOLD). Filled
 *               pulse mark (●) — high-importance.
 *   CREDIT    — breadth.hyg_lqd_lead_signal transitions between
 *               bullish/bearish/neutral. Hollow pulse (○) — medium.
 *   OVERRIDE  — synthesizer.overrides[] gains or loses an entry.
 *               Filled (●) — alerts to risk-flag firings.
 *   REGIME    — regime.regime_label changes between cycles. Hollow (○).
 *   BIAS      — synthesizer.bias changes between cycles. Hollow (○).
 *
 * Lanes scaffolded for backend deferrals (auto-activate when the
 * underlying data lands without requiring frontend code changes):
 *
 *   GAMMA     — flip-strike retest + dealer_posture transitions.
 *               Gated on `gex.available === true`. GEX feed is
 *               currently a third-party-deferred placeholder; events
 *               in this lane fire automatically once the backend flips
 *               `gex.available` to true.
 *
 * Vanna events (DEX-based dealer flow inference) are NOT scaffolded —
 * they require a paid feed (volsig / optionsdepth / spotgamma /
 * menthorq) for production-quality dealer-positioning models. Naive
 * compute from the IBKR option chain is feasible (~weeks of R&D, but
 * the dealer-positioning sign assumption is the proprietary secret
 * sauce of those providers — DIY produces a knowingly-degraded
 * signal). When a feed lands, add a VANNA event type and emit on
 * DEX trajectory changes.
 *
 * Detection runs in a useEffect on snapshot change, comparing the new
 * snapshot to a useRef-held prior. First snapshot of a session
 * produces no events (no prior to diff against — same pattern as
 * the trend-glyph in CardScore).
 *
 * Bounded to MAX_EVENTS most recent; older entries fade their color
 * `--ink-100` → `--ink-60` → `--ink-40` over FADE_WINDOW_MS per
 * spec §4.3 ("the feed *literally* fades from memory").
 */

import { useEffect, useRef, useState } from "react";
import type { TerminalSnapshot } from "../../api/terminalTypes";
import { useTick } from "../../hooks/useTick";

// ─── Configuration ───────────────────────────────────────────────────

/** NYSE TICK threshold for "institutional program" event. The design
 *  spec example was +1230; ±1000 is the textbook institutional-program
 *  cutoff. Tunable here without leaking strategy parameters since
 *  TICK is a public market-wide figure. */
const TICK_THRESHOLD = 1000;

/** Newest-first cap on the rendered list. §4.3 calls for "no load
 *  more — if it scrolled off, it's gone." Ten visible entries fit
 *  the 280px sidebar at the design's 13px Berkeley Mono / 1.5
 *  line-height without scrolling at 1080p. */
const MAX_EVENTS = 12;

/** Color-fade window (ms). Spec §4.3: "Older entries fade their type
 *  color from --ink-100 → --ink-60 → --ink-40 over ~5 minutes." */
const FADE_WINDOW_MS = 5 * 60 * 1000;

/** Per-(kind, subject-key) cooldown (ms). Suppresses repeat-fire of
 *  the same logical event within the window — protects against
 *  boundary-flicker spam (e.g. regime label oscillating across a
 *  threshold every cycle, an override clearing-and-re-firing at
 *  session close, the synthesizer bias jittering across a zero-
 *  crossing).
 *
 *  Granularity is (kind, destination-state) so distinct transitions
 *  remain visible — "regime → quiet" and "regime → mean_reverting"
 *  use different cooldown slots. The first transition of a flicker
 *  surfaces; subsequent same-direction repeats are suppressed.
 *
 *  TICK has cooldown=0 because its cross-threshold gate already
 *  handles deduping (the magnitude must dip below ±1000 before
 *  another fire can register). Distinct programs in opposite
 *  directions (+1200 then −1100) ARE both newsworthy and should
 *  surface; cross-threshold semantics permit that.
 *
 *  REGIME gets the longest cooldown because post-PR-#6 calibration
 *  put more strategies near boundary thresholds, raising the
 *  flicker risk. */
const COOLDOWN_MS: Record<EventKind, number> = {
  tick:     0,        // cross-threshold semantics handle dedupe
  credit:   60_000,   // HYG/LQD updates daily-ish, but cheap insurance
  override: 60_000,   // session-close VWAP flicker is the typical case
  regime:   90_000,   // boundary-threshold flicker most likely here
  bias:     60_000,   // synthesizer score zero-crossing flicker
};

// ─── Event types ─────────────────────────────────────────────────────

type EventKind = "tick" | "credit" | "override" | "regime" | "bias";
type EventImportance = "high" | "medium" | "low";

interface FeedEvent {
  /** Stable key for React. Composed of timestamp + kind + a counter so
   *  rapid same-cycle events don't collide. */
  id: string;
  /** Wall-clock ms at emit time. Used for both display ("HH:MM:SS")
   *  and the fade-from-memory color computation. */
  timestamp: number;
  kind: EventKind;
  importance: EventImportance;
  /** All-caps system-name word that follows the pulse mark. */
  subject: string;
  /** One-line body sentence. Mono register — the italic-serif lead-in
   *  the spec calls for is intentionally NOT applied here pending the
   *  broader LUMEN-vs-DC theming question; ship the structure now,
   *  layer the typography polish later if desired. */
  body: string;
}

const PULSE_MARK: Record<EventImportance, string> = {
  high: "●",
  medium: "○",
  low: "─",
};

// ─── Detection helpers ───────────────────────────────────────────────

/** Two-sample crossing test for the TICK threshold. Fires when:
 *    - magnitude crosses from below to ≥ threshold, OR
 *    - sign flips while still extreme (prev=+1050, cur=−1100 — an
 *      institutional program reversing direction is at least as
 *      newsworthy as a fresh program; the cross-only gate would
 *      have suppressed this case).
 *  Avoids the "stays above threshold same direction" → repeat-fire
 *  case. */
function tickCrossedThreshold(prev: number | null, cur: number | null): boolean {
  if (cur == null) return false;
  if (Math.abs(cur) < TICK_THRESHOLD) return false;
  if (prev == null) return false;  // first-cycle suppression
  if (Math.abs(prev) < TICK_THRESHOLD) return true;  // crossed up from below
  return Math.sign(prev) !== Math.sign(cur);  // sign-flip while extreme
}

function tickEvent(value: number, now: number, idCounter: number): FeedEvent {
  const sign = value >= 0 ? "+" : "−";  // Unicode minus for typographic parity
  const mag = Math.abs(Math.round(value));
  return {
    id: `${now}-tick-${idCounter}`,
    timestamp: now,
    kind: "tick",
    importance: "high",
    subject: "TICK",
    body: `Print of ${sign}${mag} indicates institutional program execution.`,
  };
}

function creditEvent(
  prev: TerminalSnapshot["breadth"]["hyg_lqd_lead_signal"],
  cur: TerminalSnapshot["breadth"]["hyg_lqd_lead_signal"],
  now: number,
  idCounter: number,
): FeedEvent {
  return {
    id: `${now}-credit-${idCounter}`,
    timestamp: now,
    kind: "credit",
    importance: "medium",
    subject: "CREDIT",
    body: `HYG/LQD lead signal ${prev} → ${cur}.`,
  };
}

/** Reformat backend kebab-case override names into trader vocabulary
 *  for the System Feed body. The backend emits names like
 *  `weekly-vwap-lost` for stable serialization + dashboard de-dup
 *  (see SynthesizerResponse.overrides), but raw kebab-case reads
 *  technical in operator copy. Map dash → space and uppercase the
 *  acronyms VWAP / VIX / GEX so the rendered body reads "weekly
 *  VWAP lost firing." instead of "weekly-vwap-lost firing."
 *
 *  Unknown names pass through with kebab→space only — better to ship
 *  ungainly text for a future override than to drop it silently. */
const _ACRONYMS = new Set(["vwap", "vix", "gex", "spx", "spy"]);
function formatOverrideName(raw: string): string {
  return raw
    .split("-")
    .map((word) => (_ACRONYMS.has(word) ? word.toUpperCase() : word))
    .join(" ");
}

function overrideEvent(
  override: string,
  fired: boolean,
  now: number,
  idCounter: number,
): FeedEvent {
  const pretty = formatOverrideName(override);
  return {
    id: `${now}-override-${fired ? "fire" : "clear"}-${idCounter}`,
    timestamp: now,
    kind: "override",
    importance: "high",
    subject: "OVERRIDE",
    body: fired ? `${pretty} firing.` : `${pretty} cleared.`,
  };
}

function regimeEvent(
  prev: string,
  cur: string,
  now: number,
  idCounter: number,
): FeedEvent {
  return {
    id: `${now}-regime-${idCounter}`,
    timestamp: now,
    kind: "regime",
    importance: "medium",
    subject: "REGIME",
    body: `${prev.replace("_", " ")} → ${cur.replace("_", " ")}.`,
  };
}

function biasEvent(
  prev: string,
  cur: string,
  now: number,
  idCounter: number,
): FeedEvent {
  return {
    id: `${now}-bias-${idCounter}`,
    timestamp: now,
    kind: "bias",
    importance: "medium",
    subject: "BIAS",
    body: `${prev} → ${cur}.`,
  };
}

// ─── Render helpers ──────────────────────────────────────────────────

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Linear color interpolation across the fade window. 0..1/3 of the
 *  way through reads ink-100, 1/3..2/3 reads ink-60, 2/3..1.0 reads
 *  ink-40, beyond reads ink-40. Three discrete steps mirror the spec
 *  text "ink-100 → ink-60 → ink-40 over ~5 minutes". */
function ageClass(ageMs: number): string {
  if (ageMs < FADE_WINDOW_MS / 3) return "fresh";
  if (ageMs < (2 * FADE_WINDOW_MS) / 3) return "stale";
  return "faded";
}

// ─── Component ───────────────────────────────────────────────────────

export function SystemFeed({ data }: { data: TerminalSnapshot | null }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const prevRef = useRef<TerminalSnapshot | null>(null);
  const idCounterRef = useRef(0);
  // Tick the component every minute so the age-based color class
  // updates without waiting for a snapshot poll. The fade is the
  // visual cue that an event is "leaving memory."
  const nowMs = useTick(60_000);

  // Per-(kind, destination-state) cooldown timestamps. Survives
  // re-renders via useRef. See COOLDOWN_MS for window definitions
  // and rationale.
  const cooldownRef = useRef<Map<string, number>>(new Map());

  /** Returns true and records the emit if the (kind, key) pair is
   *  outside its cooldown window; false otherwise. Mutates
   *  cooldownRef as a side-effect when emitting is permitted.
   *
   *  Contract: call EXACTLY ONCE per (kind, key) per detection pass.
   *  A second call with the same args within one pass would see
   *  `now - last < window` (window is non-zero) and return false,
   *  silently dropping the event. The current detection code uses
   *  each tryEmit invocation as the inline gate of an `if (...)`
   *  branch — single-call by construction. Refactors that extract
   *  the call into a separate guard need to preserve this. */
  const tryEmit = (kind: EventKind, key: string, now: number): boolean => {
    const window = COOLDOWN_MS[kind];
    if (window === 0) return true;
    const fullKey = `${kind}:${key}`;
    const last = cooldownRef.current.get(fullKey);
    if (last != null && now - last < window) return false;
    cooldownRef.current.set(fullKey, now);
    return true;
  };

  useEffect(() => {
    if (data == null) return;
    const prev = prevRef.current;
    prevRef.current = data;
    if (prev == null) return;  // first-cycle suppression

    const now = Date.now();
    const newEvents: FeedEvent[] = [];

    // TICK — institutional-program threshold crossing.
    // Cooldown=0 by design; cross-threshold semantics handle dedupe.
    if (tickCrossedThreshold(prev.breadth.tick, data.breadth.tick)) {
      newEvents.push(tickEvent(data.breadth.tick!, now, idCounterRef.current++));
    }

    // CREDIT — HYG/LQD lead signal transition. Cooldown keys on the
    // destination state so bullish→bearish and bearish→bullish each
    // get their own slot ("transition into bearish" can't repeat
    // within 60s but a transition into bullish can fire freely).
    if (
      data.breadth.hyg_lqd_lead_signal !== prev.breadth.hyg_lqd_lead_signal
      // Skip "unknown" transitions — they signal data unavailability,
      // not a real regime shift. Operator gets enough surface from
      // the breadth scorecard's own state without spamming the feed.
      && data.breadth.hyg_lqd_lead_signal !== "unknown"
      && prev.breadth.hyg_lqd_lead_signal !== "unknown"
      && tryEmit("credit", data.breadth.hyg_lqd_lead_signal, now)
    ) {
      newEvents.push(creditEvent(
        prev.breadth.hyg_lqd_lead_signal,
        data.breadth.hyg_lqd_lead_signal,
        now,
        idCounterRef.current++,
      ));
    }

    // OVERRIDE — set diff on synthesizer.overrides[]. Cooldown keys
    // on (override-name, fire/clear) so each override flickering on
    // and off uses two distinct slots, but a single override
    // clearing-then-re-firing within the window collapses to one
    // event (the first one).
    const prevOver = new Set(prev.synthesizer.overrides);
    const curOver = new Set(data.synthesizer.overrides);
    for (const ov of curOver) {
      if (!prevOver.has(ov) && tryEmit("override", `${ov}:fire`, now)) {
        newEvents.push(overrideEvent(ov, true, now, idCounterRef.current++));
      }
    }
    for (const ov of prevOver) {
      if (!curOver.has(ov) && tryEmit("override", `${ov}:clear`, now)) {
        newEvents.push(overrideEvent(ov, false, now, idCounterRef.current++));
      }
    }

    // REGIME — regime_label transition. Skip "unknown" on either side
    // for the same reason as CREDIT: data-availability, not regime
    // shift.
    if (
      data.regime.regime_label !== prev.regime.regime_label
      && data.regime.regime_label !== "unknown"
      && prev.regime.regime_label !== "unknown"
      && tryEmit("regime", data.regime.regime_label, now)
    ) {
      newEvents.push(regimeEvent(
        prev.regime.regime_label,
        data.regime.regime_label,
        now,
        idCounterRef.current++,
      ));
    }

    // BIAS — LONG/SHORT/FLAT transition.
    if (
      data.synthesizer.bias !== prev.synthesizer.bias
      && tryEmit("bias", data.synthesizer.bias, now)
    ) {
      newEvents.push(biasEvent(
        prev.synthesizer.bias,
        data.synthesizer.bias,
        now,
        idCounterRef.current++,
      ));
    }

    // GAMMA lane (forward-compat, fires nothing today). When the GEX
    // backend feed lands and gex.available flips to true:
    //   - flip_strike retest events: detect when price crossed
    //     flip_strike between cycles
    //   - dealer_posture transitions: dampen ↔ amplify changes
    // TODO: wire when backend ships gex.available=true.
    //
    // VANNA lane: requires DEX feed (volsig / optionsdepth / etc.).
    // Deferred indefinitely pending subscription.

    if (newEvents.length > 0) {
      // Newest first, bounded to MAX_EVENTS. Within a single cycle
      // events are kept in detection order (TICK first → BIAS last)
      // — TICK is the highest-importance event class, so detection
      // order naturally puts the most-newsworthy item at the top of
      // the cycle's block.
      setEvents((prevList) =>
        [...newEvents, ...prevList].slice(0, MAX_EVENTS),
      );
    }
  }, [data]);

  if (events.length === 0) {
    return (
      <aside className="terminal-feed">
        <div className="terminal-feed-title">System Feed</div>
        <div className="terminal-feed-empty">Awaiting events.</div>
      </aside>
    );
  }

  return (
    <aside className="terminal-feed">
      <div className="terminal-feed-title">System Feed</div>
      <ul className="terminal-feed-list">
        {events.map((ev) => {
          const age = nowMs - ev.timestamp;
          return (
            <li
              key={ev.id}
              className={`terminal-feed-event ${ev.kind} ${ageClass(age)}`}
              aria-label={`${ev.importance} importance, ${ev.subject}: ${ev.body}`}
            >
              <span className="feed-time">{formatTimestamp(ev.timestamp)}</span>
              {/* Pulse marks are decorative carriers of `importance`.
                  Screen readers would otherwise announce "black
                  circle" / "white circle" / "horizontal bar" with no
                  context — the importance is on the <li>'s aria-label
                  instead. */}
              <span
                className={`feed-pulse importance-${ev.importance}`}
                aria-hidden="true"
              >
                {PULSE_MARK[ev.importance]}
              </span>
              <span className="feed-subject">{ev.subject}</span>
              <span className="feed-body">{ev.body}</span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
