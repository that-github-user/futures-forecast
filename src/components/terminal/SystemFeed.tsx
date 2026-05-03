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

/** Number of consecutive same-direction ±1000 prints required to fire
 *  the TICK persistent advisory. Trader literature
 *  (Raschke / Fisher convention) treats 2-3 extreme prints as a
 *  divergence-flag candidate and 5+ as an institutional-day
 *  signature; 4 is the floor of "sustained" without firing on every
 *  echoed program. At ~30s snapshot cadence, 4 = ~2 minutes of
 *  one-sided pressure minimum.
 *
 *  Fired exactly once per streak (transition from count=N-1 → N);
 *  does not repeat-fire as the streak extends past N. Tunable here
 *  without leaking strategy parameters since TICK is a public
 *  market-wide figure. */
const TICK_PERSISTENT_THRESHOLD = 4;

/** Maximum acceptable age of the breadth feed before the streak
 *  counter resets. A weekend-spanning streak (Fri close +1200 →
 *  Sun reopen +1100) is not a real signal — the gap means the prior
 *  count was for a different session. 120s = two snapshot cycles
 *  of staleness, which catches genuine data gaps without resetting
 *  on a single missed poll. */
const TICK_STALE_RESET_SECONDS = 120;

/** RTH gate for the streak counter. NYSE TICK is published only
 *  during 09:30-16:00 ET; outside that window the IBKR ticker holds
 *  the prior RTH close as a frozen `last` value — the streak counter
 *  would happily increment it indefinitely across overnight polls
 *  ("3 consecutive +1100 prints" while the same +1100 frozen value
 *  is observed across 4 cycles). The single-print TICK event is
 *  immune because `tickCrossedThreshold` returns false when both
 *  prev and cur are at the same level. The streak counter has no
 *  equivalent gate, so we add an explicit RTH check.
 *
 *  Pre-market early-close days (post-Thanksgiving 13:00 close, etc.)
 *  are NOT specially handled here — the worst case is a few extra
 *  legitimate-but-low-participation post-1pm advisories on those
 *  days, which is acceptable. */
const RTH_OPEN_HHMM = 9 * 60 + 30;   // 09:30 ET
const RTH_CLOSE_HHMM = 16 * 60;      // 16:00 ET

function isWithinRth(timestampIso: string): boolean {
  const ms = Date.parse(timestampIso);
  if (!Number.isFinite(ms)) return false;
  // Convert UTC milliseconds to ET wall-clock minutes-since-midnight
  // via Intl. The browser's Intl.DateTimeFormat handles DST
  // (EDT/EST) transitions correctly without a tz library — the
  // alternative was importing a 30-50KB tz package for one
  // boundary check.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wkd = get("weekday");
  // Weekend short — NYSE never opens. Sat / Sun.
  if (wkd === "Sat" || wkd === "Sun") return false;
  // 'hour' from hour12: false renders 00-23. Convert to minutes.
  const hh = parseInt(get("hour"), 10);
  const mm = parseInt(get("minute"), 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false;
  const minutes = hh * 60 + mm;
  return minutes >= RTH_OPEN_HHMM && minutes < RTH_CLOSE_HHMM;
}

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
  advisory: 60_000,   // mirrors override; backend hysteresis provides
                      //   primary smoothing but cooldown insurance
                      //   handles any frontend-side dedup gaps
  regime:   90_000,   // boundary-threshold flicker most likely here
  bias:     60_000,   // synthesizer score zero-crossing flicker
};

// ─── Event types ─────────────────────────────────────────────────────

type EventKind = "tick" | "credit" | "override" | "advisory" | "regime" | "bias";
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

function tickPersistentEvent(
  streakLen: number,
  sign: 1 | -1,
  now: number,
  idCounter: number,
): FeedEvent {
  // "TICK ×N" subject differentiates from single-print TICK events
  // (which use subject="TICK"). Operator scanning the System Feed
  // can spot the persistent advisory at a glance even though both
  // events share the same kind/pulse-mark color tier.
  const sideLabel = sign > 0 ? "+1000" : "−1000";
  const flowLabel = sign > 0 ? "buying" : "selling";
  return {
    id: `${now}-tick-persistent-${idCounter}`,
    timestamp: now,
    kind: "tick",
    importance: "high",
    subject: `TICK ×${streakLen}`,
    body: `${streakLen} consecutive prints ≥ ${sideLabel} — sustained institutional ${flowLabel}.`,
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

/** Reformat backend names into trader vocabulary for the System Feed
 *  body. Handles two name shapes:
 *
 *  1. Override names (kebab-case, no namespace): `weekly-vwap-lost`
 *     → `"weekly VWAP lost"`. Same backend-to-display mapping used
 *     since PR #123.
 *
 *  2. Advisory names (namespaced, snake_case + dotted): the Tier 2
 *     advisory system uses names like `levels.gap_failed.rth` or
 *     `micro.range_expansion`. The leading namespace is routing
 *     metadata (which system computed it); strip it. Sub-namespaces
 *     after the action (e.g. `.rth`, `.eth_5pm`, `.sun_open`) are
 *     contextual and surface as parenthetical suffixes.
 *
 *  Unknown shapes pass through with token-replacement only — better
 *  to ship ungainly text for a future name than drop it silently.
 *  Acronym uppercase applied at the end so VWAP / VIX / GEX read
 *  correctly regardless of source style. */
// Acronyms preserved as ALL-CAPS in the rendered display string. Both
// override and advisory namespaces draw from this set; tokens not
// listed render in their original lowercase form (with first-char
// capitalization where appropriate). Trader-vocabulary set:
//   vwap/vix/gex/spx/spy — index + derived
//   rth/eth                — session-window discriminators in
//                            advisory sub-namespaces
//   fomc                   — econ-calendar landmark
//   or                     — opening range
//   poc / hvn / lvn         — Market Profile (point of control,
//                            high-volume node, low-volume node)
//   va / vah / val          — Market Profile (value area + high/low)
//   ib                     — initial balance (first-hour range)
const _ACRONYMS = new Set([
  "vwap", "vix", "gex", "spx", "spy",
  "rth", "eth", "fomc", "or",
  "poc", "hvn", "lvn", "va", "vah", "val", "ib",
  // Macro-event acronyms (calendar.imminent.* slug formatting).
  "cpi", "ppi", "pce", "nfp", "ism", "jolts", "adp", "gdp", "pmi",
]);

function _prettifyToken(token: string): string {
  return _ACRONYMS.has(token) ? token.toUpperCase() : token;
}

function formatOverrideName(raw: string): string {
  // Override names: kebab-case, no namespace.
  return raw.split("-").map(_prettifyToken).join(" ");
}

function formatAdvisoryName(raw: string): string {
  // Advisory names: dotted namespace + snake_case action. Examples:
  //   "micro.range_expansion"      → "Range expansion"
  //   "levels.gap_rth_failed"      → "Gap RTH failed"
  //   "levels.gap_eth_5pm_failed"  → "Gap ETH 5pm failed"
  //   "levels.gap_sun_failed"      → "Gap sun failed"
  //   "levels.poc_shift"           → "POC shift"
  //   "vwap.retest_after_break"    → "VWAP retest after break"
  //   "calendar.imminent.3.cpi"    → "Imminent: CPI"
  //
  // The first dot-segment (the source-system namespace) is dropped
  // unless its token is an acronym we want to surface (vwap → VWAP).
  // Three-segment names (legacy shape used during scaffold drafting,
  // before the gap-fail trio was flattened) still parse correctly:
  // any segment beyond [0,1] becomes a parenthetical suffix. No
  // current planned advisory exercises that branch but it stays as
  // forward-compat for any future genuinely-hierarchical name.

  // Special-case `calendar.imminent.{vol}.{slug}` — rendered as
  // "Imminent: <Pretty Name>" with the vol stripped (importance is
  // conveyed by the SystemFeed pulse mark already; the full event
  // name + tier is still visible in the upcoming-events section).
  if (raw.startsWith("calendar.imminent.")) {
    const tail = raw.split(".").slice(3).join("_");
    if (tail) {
      const pretty = tail.split("_").map(_prettifyToken).join(" ");
      return `Imminent: ${pretty.charAt(0).toUpperCase()}${pretty.slice(1)}`;
    }
  }

  // Special-case `gap_fill.{opened,failed,filled}` — the underscore in
  // the namespace prefix would otherwise be split on the dot and the
  // generic formatter would drop "gap_fill" (not in _ACRONYMS), leaving
  // just "Opened" / "Failed" / "Filled" — unrecognizable as a gap event
  // in the live feed. Render the full "Gap fill <state>" instead.
  // Trader-vocabulary phrasing per R2 review:
  //   gap_fill.opened → "Open gap" (state: there's a currently-open gap)
  //   gap_fill.filled → "Gap filled" (the gap closed)
  //   gap_fill.failed → "Gap fill failed" (gap unfilled at RTH open)
  if (raw === "gap_fill.opened") return "Open gap";
  if (raw === "gap_fill.filled") return "Gap filled";
  if (raw === "gap_fill.failed") return "Gap fill failed";

  const parts = raw.split(".");
  if (parts.length === 0) return raw;

  // Decide whether to keep the leading namespace token. Drop generic
  // routing names ("micro", "levels", "calendar"); keep acronyms
  // because they're semantically meaningful (vwap → "VWAP retest").
  const firstToken = parts[0];
  const keepFirst = _ACRONYMS.has(firstToken);

  let action: string;
  let suffix: string | null = null;

  if (parts.length === 1) {
    action = parts[0];
  } else if (parts.length === 2) {
    action = keepFirst ? `${firstToken}.${parts[1]}` : parts[1];
  } else {
    // 3+ parts: namespace, action, sub-namespace
    action = keepFirst ? `${firstToken}.${parts[1]}` : parts[1];
    suffix = parts.slice(2).join(" ");
  }

  // Format the action: snake_case → space, prettify each token.
  // Capitalize the first character so it reads as a sentence.
  const actionFormatted = action
    .split(/[._]/)
    .map(_prettifyToken)
    .join(" ");
  const head = actionFormatted.charAt(0).toUpperCase() + actionFormatted.slice(1);

  if (suffix == null) return head;
  // Pretty-print suffix tokens too (handles 'sun_open' → 'Sun open').
  const suffixFormatted = suffix
    .split(/[._\s]+/)
    .map((t, i) => (i === 0 ? _prettifyToken(t).replace(/^./, (c) => c.toUpperCase()) : _prettifyToken(t)))
    .join(" ");
  return `${head} (${suffixFormatted})`;
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

function advisoryEvent(
  advisory: string,
  fired: boolean,
  now: number,
  idCounter: number,
): FeedEvent {
  const pretty = formatAdvisoryName(advisory);
  return {
    id: `${now}-advisory-${fired ? "fire" : "clear"}-${idCounter}`,
    timestamp: now,
    kind: "advisory",
    // Medium importance vs override's high — advisories are
    // noteworthy but don't desaturate the score. Hollow pulse mark
    // (○) at the existing medium tier visually differentiates from
    // the filled (●) override pulse.
    importance: "medium",
    subject: "ADVISORY",
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

  // TICK persistent advisory state — tracks consecutive same-direction
  // ±TICK_THRESHOLD prints. Resets when a print drops below the
  // threshold, flips sign, or the breadth feed goes stale beyond
  // TICK_STALE_RESET_SECONDS (handles weekend-spanning streaks).
  // Fires once when the streak reaches TICK_PERSISTENT_THRESHOLD
  // (strict equality on the transition); does NOT repeat-fire as the
  // streak extends further. Counts every snapshot whose breadth.tick
  // is non-null — including the very first one a session sees, so
  // 4 consecutive snapshots actually fires on the 4th, not the 5th.
  // Strict-mode double-invoke safety: dedup'd via lastSnapshotRef.
  const tickStreakRef = useRef<{ length: number; sign: 1 | -1 | 0 }>({
    length: 0,
    sign: 0,
  });

  // Identity guard against React 18 strict-mode double-invoke. The
  // useEffect runs twice on mount in dev; without this guard the
  // streak counter would double-increment on every cycle. We dedup
  // by snapshot identity (data === lastSnapshot) — same reference
  // means same poll, regardless of how many times the effect fires.
  const lastSnapshotRef = useRef<TerminalSnapshot | null>(null);

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
    // Strict-mode double-invoke guard. React 18 runs this effect twice
    // on mount in dev; without this gate, every stateful detector
    // (streak counter especially) would double-process the same
    // snapshot. Bailing on identity match keeps all detection
    // idempotent regardless of invocation count.
    if (data === lastSnapshotRef.current) return;
    lastSnapshotRef.current = data;

    const prev = prevRef.current;
    prevRef.current = data;

    const now = Date.now();
    const newEvents: FeedEvent[] = [];

    // TICK persistent advisory — sustained same-direction ±1000 prints.
    // Runs BEFORE the first-cycle suppression so the very first
    // snapshot's tick contributes to the streak. Without this, "4
    // consecutive prints" would actually require 5 post-mount
    // snapshots — an off-by-one that delays the advisory by a full
    // poll cycle. Streak resets when:
    //   - tick drops below TICK_THRESHOLD (genuine break in pressure)
    //   - tick flips sign (regime swing)
    //   - prev → cur snapshot timestamp gap exceeds
    //     TICK_STALE_RESET_SECONDS (catches weekend-spanning streaks
    //     where Fri close + Sun reopen would otherwise read as
    //     length=2 across a 50-hour gap)
    // Null TICK leaves the streak unchanged (single missed snapshot
    // ≠ real break). State machine + strict-equality fire gate so
    // length=N+1, N+2 don't re-emit while a streak holds.
    const tickNow = data.breadth.tick;
    const streak = tickStreakRef.current;
    // RTH gate — NYSE TICK isn't published outside 09:30-16:00 ET.
    // IBKR returns the prior RTH close as a frozen value via
    // `ticker.last`, which would otherwise cause the streak counter
    // to fire on overnight polls of the same frozen value (see
    // RTH_OPEN_HHMM constant for full rationale). Outside RTH we
    // also reset the streak so a Friday-close streak doesn't carry
    // into Monday's open.
    const inRth = isWithinRth(data.timestamp);
    if (!inRth) {
      streak.length = 0;
      streak.sign = 0;
    } else if (prev != null) {
      // Snapshot-gap-based session-boundary reset. Catches
      // mid-RTH discontinuities (daemon restart, IBKR outage during
      // open hours) that the RTH-only gate above doesn't cover —
      // both prev and cur could be in RTH but separated by a gap
      // larger than the normal poll cadence.
      const curMs = Date.parse(data.timestamp);
      const prevMs = Date.parse(prev.timestamp);
      if (
        Number.isFinite(curMs)
        && Number.isFinite(prevMs)
        && curMs - prevMs > TICK_STALE_RESET_SECONDS * 1000
      ) {
        streak.length = 0;
        streak.sign = 0;
      }
    }
    // Streak-extension only runs inside RTH. Outside RTH the streak
    // is already reset above and tickNow may be a frozen prior-close
    // value masquerading as live data — incrementing the counter on
    // it would be a false positive.
    if (inRth && tickNow != null) {
      const tickSign: 1 | -1 | 0 =
        Math.abs(tickNow) >= TICK_THRESHOLD ? (tickNow >= 0 ? 1 : -1) : 0;
      if (tickSign === 0) {
        streak.length = 0;
        streak.sign = 0;
      } else if (tickSign === streak.sign) {
        streak.length += 1;
      } else {
        streak.length = 1;
        streak.sign = tickSign;
      }
      if (streak.length === TICK_PERSISTENT_THRESHOLD && streak.sign !== 0) {
        newEvents.push(
          tickPersistentEvent(streak.length, streak.sign, now, idCounterRef.current++),
        );
      }
    }

    // First-cycle suppression for diff-based detectors below. The
    // streak counter above is NOT diff-based (it samples the current
    // value), so it runs on cycle 1; the rest are prev-vs-cur diffs
    // and have nothing to compare against on cycle 1. Narrows `prev`
    // from `TerminalSnapshot | null` to `TerminalSnapshot` for the
    // remainder of the body.
    //
    // Sticky advisory state (e.g. gap_fill.opened firing for ~24h
    // after Globex reopen) is surfaced separately via the persistent
    // <ActiveAdvisories> section in the sidebar — the live event log
    // remains a TRANSITIONS-ONLY view, so a mid-session page refresh
    // doesn't re-emit history but the trader still sees current state.
    if (prev == null) {
      if (newEvents.length > 0) {
        setEvents((prevList) => [...newEvents, ...prevList].slice(0, MAX_EVENTS));
      }
      return;
    }

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

    // ADVISORY — set diff on synthesizer.advisories[]. Same
    // detection pattern as OVERRIDE but emits a separate event
    // class (medium importance, hollow pulse, no §4.1.1 visual
    // treatment). Cooldown keyed on (advisory-name, fire/clear).
    // The backend's Tier 2 detectors do their own hysteresis
    // smoothing per-detector; the frontend cooldown is insurance
    // against any backend-side dedup gaps. Optional-chain on
    // `advisories` so older snapshot payloads (pre-PR α deploy)
    // render cleanly with no advisory events instead of a runtime
    // error from accessing an undefined array.
    // TODO: drop `?? []` after the backend rollout (vega-pilot
    //       PR #105) lands and `advisories` is guaranteed present
    //       on every snapshot. The TS type is non-optional, so
    //       this guard is purely runtime cover for the deploy
    //       transition window.
    const prevAdv = new Set(prev.synthesizer.advisories ?? []);
    const curAdv = new Set(data.synthesizer.advisories ?? []);
    for (const adv of curAdv) {
      if (!prevAdv.has(adv) && tryEmit("advisory", `${adv}:fire`, now)) {
        newEvents.push(advisoryEvent(adv, true, now, idCounterRef.current++));
      }
    }
    for (const adv of prevAdv) {
      if (!curAdv.has(adv) && tryEmit("advisory", `${adv}:clear`, now)) {
        newEvents.push(advisoryEvent(adv, false, now, idCounterRef.current++));
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

  const activeAdvisories = data?.synthesizer?.advisories ?? [];

  if (events.length === 0) {
    // Empty live-event log is the normal state at market open before
    // any state-machine TRANSITION has fired. Still render the
    // active-advisories + upcoming-events sections — the live log
    // is for transitions only; current state and forward calendar
    // are independent.
    return (
      <aside className="terminal-feed">
        <div className="terminal-feed-title">System Feed</div>
        <ActiveAdvisories
          advisories={activeAdvisories}
          gapFill={data?.gap_fill ?? null}
        />
        <div className="terminal-feed-empty">Awaiting events.</div>
        <UpcomingEvents events={data?.calendar?.events ?? []} />
      </aside>
    );
  }

  return (
    <aside className="terminal-feed">
      <div className="terminal-feed-title">System Feed</div>
      <ActiveAdvisories
        advisories={activeAdvisories}
        gapFill={data?.gap_fill ?? null}
      />
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
      <UpcomingEvents events={data?.calendar?.events ?? []} />
    </aside>
  );
}


// ── Upcoming events section ───────────────────────────────────────
//
// Type I (peripheral) view of the next 24h macro docket. Always-
// visible compact list when non-empty; vol-tier conveyed via stacked
// pulse marks (●●● = vol 3, ●● = vol 2, ● = vol 1). Imminent events
// (within tier-driven window) get an emphasis state with countdown
// timer to promote to focal attention. Events past `now` are filtered
// upstream by the backend's compute(); events more than 24h out are
// excluded too.

const VOL_PULSE: Record<1 | 2 | 3, string> = {
  3: "●●●",
  2: "●●",
  1: "●",
};

function formatRelativeTimeLabel(timestampIso: string, time_et: string): string {
  // Compute calendar-day offset (today/tomorrow/etc.) from the
  // browser's local date relative to the event's ET date. The
  // ET-formatted date is what the trader thinks in.
  try {
    const eventDate = new Date(timestampIso);
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const eventEtDate = fmt.format(eventDate);
    const todayEtDate = fmt.format(new Date());
    if (eventEtDate === todayEtDate) {
      return time_et;
    }
    // Day offset: parse YYYY-MM-DD strings and diff by 1 day step.
    const offsetDays = Math.round(
      (Date.parse(eventEtDate) - Date.parse(todayEtDate)) / 86_400_000,
    );
    if (offsetDays === 1) return `tom ${time_et}`;
    // Within next 24h, tomorrow is the only other case (the backend
    // filters past 24h). Defensive: fall through to time only.
    return time_et;
  } catch {
    return time_et;
  }
}

// ── Active advisories ─────────────────────────────────────────────
//
// Persistent display of currently-firing advisories. The live event
// log below is TRANSITIONS-ONLY (X fired / X cleared). This section
// reflects the snapshot's `synthesizer.advisories[]` directly, so a
// trader who refreshes the page mid-session immediately sees the
// current state of every sticky advisory (e.g. gap_fill.opened firing
// since 18:00 ET) without having to scroll the rolling log or have
// been present at the moment of the original transition.

function ActiveAdvisories({
  advisories,
  gapFill,
}: {
  advisories: string[];
  gapFill: import("../../api/terminalTypes").GapFillContext | null;
}) {
  if (advisories.length === 0) return null;
  return (
    <section className="active-advisories" aria-label="Currently firing advisories">
      <h4 className="active-advisories-header">active now</h4>
      <ul className="active-advisories-list">
        {advisories.map((adv) => {
          const label = formatAdvisoryName(adv);
          // Inline target price for the gap_fill.* family. Suppressed
          // for `gap_fill.filled` since the level just BECAME the
          // price — adding "→ 5800" alongside "Gap filled" is
          // redundant. Kept for `opened` (target = where to fill)
          // and `failed` (post-mortem: the level that didn't get
          // hit at RTH open). ES tick = 0.25, so toFixed(2) renders
          // tick-aligned values cleanly.
          const showTarget =
            (adv === "gap_fill.opened" || adv === "gap_fill.failed") &&
            gapFill !== null;
          // Phrasing: "Open gap → fills 5800.00" reads less
          // ambiguously than the bare arrow ("Open gap → 5800.00"
          // could parse as "the gap is at 5800"). The verb "fills"
          // anchors the price as the target rather than the level.
          const targetPhrase =
            adv === "gap_fill.failed" ? "missed @" : "fills @";
          return (
            <li
              key={adv}
              className="active-advisory"
              aria-label={
                showTarget
                  ? `Active advisory: ${label}, ${targetPhrase} ${gapFill!.target_price.toFixed(2)}`
                  : `Active advisory: ${label}`
              }
            >
              {/* Distinct pulse mark from the live event log's
                  ○/●/─ importance grading — `◉` reads as "live/on"
                  rather than reusing the log's "moderate importance"
                  ○. Avoids the visual grammar ambiguity R2 flagged. */}
              <span className="active-advisory-pulse" aria-hidden="true">
                ◉
              </span>
              <span className="active-advisory-name">
                {label}
                {showTarget && (
                  <span className="active-advisory-target">
                    {` → ${targetPhrase} `}
                    {gapFill!.target_price.toFixed(2)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}


function UpcomingEvents({
  events,
}: {
  events: import("../../api/terminalTypes").MacroEvent[];
}) {
  if (events.length === 0) return null;
  return (
    <section className="upcoming-events" aria-label="Upcoming macro events">
      <h4 className="upcoming-events-header">upcoming 24h</h4>
      <ul className="upcoming-events-list">
        {events.map((ev) => (
          <li
            key={`${ev.timestamp}|${ev.name}`}
            className={`upcoming-event vol-${ev.vol}${ev.is_imminent ? " imminent" : ""}`}
            aria-label={
              ev.is_imminent
                ? `Imminent macro event: ${ev.name} in ${ev.minutes_until} minutes (impact ${ev.vol})`
                : `Upcoming macro event: ${ev.name} (impact ${ev.vol})`
            }
          >
            <span className="upcoming-time">
              {formatRelativeTimeLabel(ev.timestamp, ev.time_et)}
            </span>
            <span className="upcoming-pulse" aria-hidden="true">
              {VOL_PULSE[ev.vol] ?? "●"}
            </span>
            <span className="upcoming-name" title={ev.name}>{ev.name}</span>
            {ev.is_imminent && (
              <span className="upcoming-countdown" aria-hidden="true">
                ⏱ {ev.minutes_until}m
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
