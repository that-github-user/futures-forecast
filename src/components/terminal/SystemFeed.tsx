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

/** Two-sample crossing test for the TICK threshold. Fires when the
 *  new value's magnitude is ≥ threshold AND the prior was below.
 *  Avoids the "stays above threshold" → repeat-fire-every-cycle case. */
function tickCrossedThreshold(prev: number | null, cur: number | null): boolean {
  if (cur == null) return false;
  if (Math.abs(cur) < TICK_THRESHOLD) return false;
  if (prev == null) return false;  // first-cycle suppression
  return Math.abs(prev) < TICK_THRESHOLD;
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

function overrideEvent(
  override: string,
  fired: boolean,
  now: number,
  idCounter: number,
): FeedEvent {
  return {
    id: `${now}-override-${fired ? "fire" : "clear"}-${idCounter}`,
    timestamp: now,
    kind: "override",
    importance: "high",
    subject: "OVERRIDE",
    body: fired ? `${override} firing.` : `${override} cleared.`,
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

  useEffect(() => {
    if (data == null) return;
    const prev = prevRef.current;
    prevRef.current = data;
    if (prev == null) return;  // first-cycle suppression

    const now = Date.now();
    const newEvents: FeedEvent[] = [];

    // TICK — institutional-program threshold crossing
    if (tickCrossedThreshold(prev.breadth.tick, data.breadth.tick)) {
      newEvents.push(tickEvent(data.breadth.tick!, now, idCounterRef.current++));
    }

    // CREDIT — HYG/LQD lead signal transition
    if (
      data.breadth.hyg_lqd_lead_signal !== prev.breadth.hyg_lqd_lead_signal
      // Skip "unknown" transitions — they signal data unavailability,
      // not a real regime shift. Operator gets enough surface from
      // the breadth scorecard's own state without spamming the feed.
      && data.breadth.hyg_lqd_lead_signal !== "unknown"
      && prev.breadth.hyg_lqd_lead_signal !== "unknown"
    ) {
      newEvents.push(creditEvent(
        prev.breadth.hyg_lqd_lead_signal,
        data.breadth.hyg_lqd_lead_signal,
        now,
        idCounterRef.current++,
      ));
    }

    // OVERRIDE — set diff on synthesizer.overrides[]
    const prevOver = new Set(prev.synthesizer.overrides);
    const curOver = new Set(data.synthesizer.overrides);
    for (const ov of curOver) {
      if (!prevOver.has(ov)) {
        newEvents.push(overrideEvent(ov, true, now, idCounterRef.current++));
      }
    }
    for (const ov of prevOver) {
      if (!curOver.has(ov)) {
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
    ) {
      newEvents.push(regimeEvent(
        prev.regime.regime_label,
        data.regime.regime_label,
        now,
        idCounterRef.current++,
      ));
    }

    // BIAS — LONG/SHORT/FLAT transition
    if (data.synthesizer.bias !== prev.synthesizer.bias) {
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
      setEvents((prevList) =>
        // Newest first, bounded to MAX_EVENTS.
        [...newEvents.reverse(), ...prevList].slice(0, MAX_EVENTS),
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
            >
              <span className="feed-time">{formatTimestamp(ev.timestamp)}</span>
              <span className={`feed-pulse importance-${ev.importance}`}>
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
