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
import type { TZOption } from "../../hooks/useTimezone";

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

// Cooldown logic and per-detector helpers (tickCrossedThreshold,
// tickEvent, creditEvent, overrideEvent, advisoryEvent, regimeEvent,
// biasEvent) moved server-side in vega-pilot PR #119. Backend's
// `event_log` module dedupes via set-diff on overrides/advisories
// and value-equality on bias/regime/credit; the frontend renders
// `data.events` directly. The TICK persistent streak detector below
// is the only frontend-only state that survived — per-client streak
// counters don't fit cleanly server-side without per-session tracking.

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
  /** One-line body sentence. Server-rendered; client may re-format
   *  via `name` for advisories/overrides to match Active Now's
   *  vocabulary (see `renderEventBody`). */
  body: string;
  /** Raw event identifier when applicable (e.g., "gap_fill.opened" /
   *  "weekly-vwap-lost"). Lets the client re-prettify the body's
   *  name portion via formatAdvisoryName / formatOverrideName so
   *  both surfaces (Active Now + live event log) use the same
   *  trader-vocabulary phrasing. Null for streak events + non-
   *  named transitions (bias, regime, credit, tick-cross). */
  name?: string | null;
}

// Allowed kind/importance values from the backend. Defensive guard
// against backend introducing a new lane (e.g., gamma) — unrecognized
// values are filtered out rather than rendered with no CSS rule.
const ALLOWED_KINDS = new Set<EventKind>([
  "tick", "credit", "override", "advisory", "regime", "bias",
]);
const ALLOWED_IMPORTANCE = new Set<EventImportance>([
  "high", "medium", "low",
]);

const PULSE_MARK: Record<EventImportance, string> = {
  high: "●",
  medium: "○",
  low: "─",
};

// ─── Detection helpers (TICK persistent streak only) ───────────────

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
const ACRONYMS = new Set([
  "vwap", "vix", "gex", "spx", "spy",
  "rth", "eth", "fomc", "or",
  "poc", "hvn", "lvn", "va", "vah", "val", "ib",
  // Macro-event acronyms (calendar.imminent.* slug formatting).
  "cpi", "ppi", "pce", "nfp", "ism", "jolts", "adp", "gdp", "pmi",
]);

function prettifyToken(token: string): string {
  return ACRONYMS.has(token) ? token.toUpperCase() : token;
}

/** Override names are kebab-case (e.g. `weekly-vwap-lost`). Same
 *  acronym set as advisories applies. First token gets a sentence-cap
 *  unless it's an acronym (already upper). Style-aligned with
 *  formatAdvisoryName — slight divergence from the pre-server-migration
 *  formatter (which left "weekly" lowercase); the new behavior reads
 *  more cleanly as a sentence start in the live log. */
function formatOverrideName(raw: string): string {
  const rawTokens = raw.split("-");
  const tokens = rawTokens.map(prettifyToken);
  const first = tokens[0];
  // If prettifyToken upper-cased the first token (acronym), keep it;
  // else sentence-cap.
  tokens[0] = first === rawTokens[0]
    ? first.charAt(0).toUpperCase() + first.slice(1)
    : first;
  return tokens.join(" ");
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
      const pretty = tail.split("_").map(prettifyToken).join(" ");
      return `Imminent: ${pretty.charAt(0).toUpperCase()}${pretty.slice(1)}`;
    }
  }

  // Special-case `gap_fill.{opened,failed,filled}` — the underscore in
  // the namespace prefix would otherwise be split on the dot and the
  // generic formatter would drop "gap_fill" (not in ACRONYMS), leaving
  // just "Opened" / "Failed" / "Filled" — unrecognizable as a gap event
  // in the live feed. Render the full "Gap fill <state>" instead.
  // Trader-vocabulary phrasing per R2 review:
  //   gap_fill.opened      → "Open gap" (state: there's a currently-open gap)
  //   gap_fill.filled      → "Gap filled" (the gap closed)
  //   gap_fill.failed      → "Gap fill failed" (gap unfilled at RTH open)
  //   gap_fill.set_reached → "SET reached" (intermediate target hit
  //                          on event days where SET ≠ PDC)
  if (raw === "gap_fill.opened") return "Open gap";
  if (raw === "gap_fill.filled") return "Gap filled";
  if (raw === "gap_fill.failed") return "Gap fill failed";
  if (raw === "gap_fill.set_reached") return "SET reached";

  const parts = raw.split(".");
  if (parts.length === 0) return raw;

  // Decide whether to keep the leading namespace token. Drop generic
  // routing names ("micro", "levels", "calendar"); keep acronyms
  // because they're semantically meaningful (vwap → "VWAP retest").
  const firstToken = parts[0];
  const keepFirst = ACRONYMS.has(firstToken);

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
    .map(prettifyToken)
    .join(" ");
  const head = actionFormatted.charAt(0).toUpperCase() + actionFormatted.slice(1);

  if (suffix == null) return head;
  // Pretty-print suffix tokens too (handles 'sun_open' → 'Sun open').
  const suffixFormatted = suffix
    .split(/[._\s]+/)
    .map((t, i) => (i === 0 ? prettifyToken(t).replace(/^./, (c) => c.toUpperCase()) : prettifyToken(t)))
    .join(" ");
  return `${head} (${suffixFormatted})`;
}

// ─── Render helpers ──────────────────────────────────────────────────

/** Match the gap_fill body shape: `→ <verb> @ <price>.$`.
 *  Price is digits-dot-digits (backend always emits 2dp via `:.2f`);
 *  bounding it as `\d+\.\d+` rather than `[\d.]+` prevents the greedy
 *  class from swallowing the trailing `.` and emitting a double
 *  period. */
const GAP_FILL_BODY_RE = /→ (fills|missed) @ (\d+\.\d+)\.$/;

/** Match the gap_fill.set_reached body shape: `<server-name> @ <price>.$`.
 *  No `→ verb @` prefix because there's no fill-or-miss verb to
 *  assign — settlement is just a price level that was crossed, not
 *  a fill outcome. */
const SET_REACHED_BODY_RE = / @ (\d+\.\d+)\.$/;

/** Re-format a server-rendered event body so it uses the same
 *  trader-vocabulary phrasing as Active Now. The backend ships a
 *  display-ready `body` plus the raw `name` (e.g. `gap_fill.opened`,
 *  `weekly-vwap-lost`). When `name` is present, we re-prettify the
 *  name portion via formatAdvisoryName / formatOverrideName and
 *  reattach the suffix the server appended (`firing.` / `cleared.` /
 *  `→ fills @ X.` / `→ missed @ X.`). Falls back to the server body
 *  for unrecognized shapes — better to ship the server's text than
 *  drop the event silently.
 *
 *  Why client-side: Active Now reformats raw advisory IDs into
 *  trader vocabulary ("Open gap" not "gap_fill.opened"); a trader
 *  scanning the sidebar would otherwise read the same advisory
 *  with two different names across the two surfaces.
 *
 *  Deploy-window note: pre-existing entries in the rolling buffer
 *  emitted before the companion server PR may still carry the
 *  removed `(active at server start).` suffix. Those bodies fall
 *  through the recognized-suffix checks and render verbatim — the
 *  trader sees the raw server body (with the un-prettified name)
 *  for one buffer rotation. Acceptable degradation for the
 *  rollover; not silently dropped. */
function renderEventBody(ev: FeedEvent): string {
  if (ev.name == null) return ev.body;
  if (ev.kind === "advisory") {
    const pretty = formatAdvisoryName(ev.name);
    const m = ev.body.match(GAP_FILL_BODY_RE);
    if (m) return `${pretty} → ${m[1]} @ ${m[2]}.`;
    if (ev.name === "gap_fill.set_reached") {
      const sm = ev.body.match(SET_REACHED_BODY_RE);
      if (sm) return `${pretty} @ ${sm[1]}.`;
    }
    if (ev.body.endsWith("cleared.")) return `${pretty} cleared.`;
    if (ev.body.endsWith("firing.")) return `${pretty} firing.`;
    return ev.body;
  }
  if (ev.kind === "override") {
    const pretty = formatOverrideName(ev.name);
    if (ev.body.endsWith("cleared.")) return `${pretty} cleared.`;
    if (ev.body.endsWith("firing.")) return `${pretty} firing.`;
    return ev.body;
  }
  return ev.body;
}

// Live-event timestamps are rendered via the user-selectable
// timezone hook (see SystemFeed component). The previous local helper
// used `new Date(ms).getHours()` which silently picked up the
// browser's TZ regardless of the trader's TZ-dropdown selection.

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

export function SystemFeed({
  data,
  tz,
  formatChartTime,
  tzLabel,
}: {
  data: TerminalSnapshot | null;
  // Timezone props are owned by TerminalDashboard's `useTimezone()`
  // so a dropdown change in the same tab propagates immediately. A
  // local `useTimezone()` call here would create its own useState —
  // the hook's cross-tab `storage` listener does NOT fire for the
  // same window, so the dropdown's setter wouldn't reach this
  // component until a reload.
  tz: TZOption;
  formatChartTime: (iso: string, withSeconds?: boolean) => string;
  tzLabel: string;
}) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const idCounterRef = useRef(0);
  // Tick the component every minute so the age-based color class
  // updates without waiting for a snapshot poll. The fade is the
  // visual cue that an event is "leaving memory."
  const nowMs = useTick(60_000);

  // TICK persistent advisory state — frontend-only because the
  // streak counter is per-client (each open page tracks its own
  // poll history). Server-side event log doesn't carry this; the
  // detector below is the only diff-based code that survived the
  // server-side migration. State semantics unchanged: 4 consecutive
  // ±TICK_THRESHOLD same-sign prints fire once via strict equality
  // on the streak length.
  const tickStreakRef = useRef<{ length: number; sign: 1 | -1 | 0 }>({
    length: 0,
    sign: 0,
  });
  const tickStreakFiredRef = useRef<FeedEvent | null>(null);
  // Snapshot identity guard for React 18 strict-mode double-invoke.
  const lastSnapshotRef = useRef<TerminalSnapshot | null>(null);
  // Track previous timestamp for the staleness-reset edge case
  // (Friday-close streak shouldn't carry into Monday's open).
  const prevTimestampRef = useRef<string | null>(null);

  useEffect(() => {
    if (data == null) return;
    if (data === lastSnapshotRef.current) return;
    lastSnapshotRef.current = data;

    // Server-recorded events are authoritative for transitions —
    // OVERRIDE / ADVISORY / BIAS / REGIME / CREDIT / TICK-cross all
    // come from `data.events`. Frontend just renders. Survives hard-
    // refresh: backend filters to current ETH session, so a trader
    // joining mid-session sees the full session's transition history.
    //
    // Convert backend FeedEvent (timestamp_ms) to local FeedEvent
    // (timestamp). The backend payload is already ordered newest-
    // first per server-side ring buffer.
    const serverEvents: FeedEvent[] = (data.events ?? [])
      // Defensive filter: backend introducing a new lane shouldn't
      // crash the renderer. Unrecognized kinds drop silently.
      .filter((ev) =>
        ALLOWED_KINDS.has(ev.kind as EventKind)
        && ALLOWED_IMPORTANCE.has(ev.importance as EventImportance),
      )
      .map((ev) => ({
        id: ev.id,
        timestamp: ev.timestamp_ms,
        kind: ev.kind as EventKind,
        importance: ev.importance as EventImportance,
        subject: ev.subject,
        body: ev.body,
        name: ev.name,
      }));

    // TICK persistent streak — runs alongside the server events
    // because the streak length is browser-session state.
    const now = Date.now();
    const tickNow = data.breadth.tick;
    const streak = tickStreakRef.current;
    const prevTs = prevTimestampRef.current;
    prevTimestampRef.current = data.timestamp;

    const inRth = isWithinRth(data.timestamp);
    if (!inRth) {
      streak.length = 0;
      streak.sign = 0;
      tickStreakFiredRef.current = null;
    } else if (prevTs != null) {
      const curMs = Date.parse(data.timestamp);
      const prevMs = Date.parse(prevTs);
      if (
        Number.isFinite(curMs)
        && Number.isFinite(prevMs)
        && curMs - prevMs > TICK_STALE_RESET_SECONDS * 1000
      ) {
        streak.length = 0;
        streak.sign = 0;
        tickStreakFiredRef.current = null;
      }
    }

    let streakEvent: FeedEvent | null = null;
    if (inRth && tickNow != null) {
      const tickSign: 1 | -1 | 0 =
        Math.abs(tickNow) >= TICK_THRESHOLD ? (tickNow >= 0 ? 1 : -1) : 0;
      if (tickSign === 0) {
        streak.length = 0;
        streak.sign = 0;
        tickStreakFiredRef.current = null;
      } else if (tickSign === streak.sign) {
        streak.length += 1;
      } else {
        streak.length = 1;
        streak.sign = tickSign;
        tickStreakFiredRef.current = null;
      }
      if (
        streak.length === TICK_PERSISTENT_THRESHOLD
        && streak.sign !== 0
        && tickStreakFiredRef.current == null
      ) {
        streakEvent = tickPersistentEvent(
          streak.length, streak.sign, now, idCounterRef.current++,
        );
        tickStreakFiredRef.current = streakEvent;
      }
    }

    // Merge the server events with the (at-most-one) streak event.
    // Streak event is local-only — it's not in `data.events` because
    // the streak is per-client state. Ordered newest-first overall.
    const merged: FeedEvent[] = streakEvent != null
      ? [streakEvent, ...serverEvents]
      : serverEvents;
    setEvents(merged.slice(0, MAX_EVENTS));
  }, [data]);

  const activeAdvisories = data?.synthesizer?.advisories ?? [];
  const activeOverrides = data?.synthesizer?.overrides ?? [];

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
          overrides={activeOverrides}
          gapFill={data?.gap_fill ?? null}
        />
        <div className="terminal-feed-empty">Awaiting events.</div>
        <UpcomingEvents
          events={data?.calendar?.events ?? []}
          mode={data?.calendar?.mode ?? "next_24h"}
          tz={tz}
          formatChartTime={formatChartTime}
          tzLabel={tzLabel}
        />
      </aside>
    );
  }

  return (
    <aside className="terminal-feed">
      <div className="terminal-feed-title">System Feed</div>
      <ActiveAdvisories
        advisories={activeAdvisories}
        overrides={activeOverrides}
        gapFill={data?.gap_fill ?? null}
      />
      <ul className="terminal-feed-list">
        {events.map((ev) => {
          const age = nowMs - ev.timestamp;
          const body = renderEventBody(ev);
          return (
            <li
              key={ev.id}
              className={`terminal-feed-event ${ev.kind} ${ageClass(age)}`}
              aria-label={`${ev.importance} importance, ${ev.subject}: ${body}`}
            >
              <span className="feed-time">
                {formatChartTime(new Date(ev.timestamp).toISOString(), true)}
              </span>
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
              <span className="feed-body">{body}</span>
            </li>
          );
        })}
      </ul>
      <UpcomingEvents
        events={data?.calendar?.events ?? []}
        mode={data?.calendar?.mode ?? "next_24h"}
        tz={tz}
        formatChartTime={formatChartTime}
        tzLabel={tzLabel}
      />
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

// IANA tz name lookup for the day-offset calculation. `local` falls
// through to the browser default (Intl.DateTimeFormat with no
// `timeZone` option uses the user's system zone).
const TZ_IANA_FOR_LABEL: Record<"ET" | "CT" | "MT" | "PT", string> = {
  ET: "America/New_York",
  CT: "America/Chicago",
  MT: "America/Denver",
  PT: "America/Los_Angeles",
};

function formatRelativeTimeLabel(
  timestampIso: string,
  tz: TZOption,
  formatChartTime: (iso: string, withSeconds?: boolean) => string,
): string {
  // Display time in the user's selected TZ. Day offset (today/tom)
  // is computed against the same TZ so a PT user sees an event at
  // 08:30 ET / 05:30 PT correctly labeled "tom 05:30" when checking
  // late Sunday night PT (= early Monday ET).
  const time = formatChartTime(timestampIso, false);
  try {
    const dateOpts: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(tz !== "local" ? { timeZone: TZ_IANA_FOR_LABEL[tz] } : {}),
    };
    const fmt = new Intl.DateTimeFormat("en-CA", dateOpts);
    const eventDate = fmt.format(new Date(timestampIso));
    const todayDate = fmt.format(new Date());
    if (eventDate === todayDate) return time;
    const offsetDays = Math.round(
      (Date.parse(eventDate) - Date.parse(todayDate)) / 86_400_000,
    );
    if (offsetDays === 1) return `tom ${time}`;
    // Within next 24h, tomorrow is the only other case (the backend
    // filters past 24h). Defensive: fall through to time only.
    return time;
  } catch {
    return time;
  }
}

// ── Active advisories ─────────────────────────────────────────────
//
// Persistent display of currently-firing overrides + advisories. The
// live event log below is TRANSITIONS-ONLY (X fired / X cleared).
// This section reflects the snapshot's
// `synthesizer.{overrides,advisories}` directly, so a trader who
// refreshes the page mid-session immediately sees the current state
// of every sticky signal (e.g. gap_fill.opened firing since 18:00 ET,
// or weekly-vwap-lost active since the daily session) without having
// to scroll the rolling log or have been present at the moment of
// the original transition.
//
// Overrides render first (they outrank advisories: high vs medium
// importance in the event_log grading) with a distinct pulse mark.

function ActiveAdvisories({
  advisories,
  overrides,
  gapFill,
}: {
  advisories: string[];
  overrides: string[];
  gapFill: import("../../api/terminalTypes").GapFillContext | null;
}) {
  if (advisories.length === 0 && overrides.length === 0) return null;
  return (
    <section className="active-advisories" aria-label="Currently firing signals">
      <h4 className="active-advisories-header">active now</h4>
      <ul className="active-advisories-list">
        {overrides.map((ov) => {
          const label = formatOverrideName(ov);
          return (
            <li
              key={`override:${ov}`}
              className="active-advisory active-override"
              aria-label={`Active override: ${label}`}
            >
              {/* `◆` (diamond) for overrides — distinct from both
                  the advisory's `◉` AND the live event log's
                  importance pulses (`●`/`○`/`─`). The visual grammar
                  invariant (set by R2 on the original Active Now PR)
                  is that no glyph in this section may collide with
                  the live log's importance set. `●` would have
                  collided with PULSE_MARK.high; `◉` would have
                  collided with the advisory marker. Diamond reads
                  as "priority state" without conflating with either
                  scale. */}
              <span className="active-advisory-pulse" aria-hidden="true">
                ◆
              </span>
              <span className="active-advisory-name">{label}</span>
            </li>
          );
        })}
        {advisories.map((adv) => {
          const label = formatAdvisoryName(adv);
          // Inline target price for the gap_fill.* family. Suppressed
          // for `gap_fill.filled` since the level just BECAME the
          // price — adding "→ 5800" alongside "Gap filled" is
          // redundant. Kept for `opened` (target = where to fill)
          // and `failed` (post-mortem: the level that didn't get
          // hit at RTH open). gap_fill.set_reached renders the
          // SETTLEMENT price inline (different field on GapFillContext)
          // since SET — not PDC — is the anchor for that advisory.
          // ES tick = 0.25, so toFixed(2) renders tick-aligned values.
          const showPdcTarget =
            (adv === "gap_fill.opened" || adv === "gap_fill.failed") &&
            gapFill !== null;
          const showSetTarget =
            adv === "gap_fill.set_reached" &&
            gapFill !== null &&
            gapFill.settlement_price !== null;
          // Phrasing: "Open gap → fills 5800.00" reads less
          // ambiguously than the bare arrow ("Open gap → 5800.00"
          // could parse as "the gap is at 5800"). The verb "fills"
          // anchors the price as the target rather than the level.
          // SET-reached uses a bare "@ <price>" since the advisory
          // name itself ("SET reached") already says what happened.
          const pdcPhrase =
            adv === "gap_fill.failed" ? "missed @" : "fills @";
          const ariaLabel = showPdcTarget
            ? `Active advisory: ${label}, ${pdcPhrase} ${gapFill!.target_price.toFixed(2)}`
            : showSetTarget
              ? `Active advisory: ${label} at ${gapFill!.settlement_price!.toFixed(2)}`
              : `Active advisory: ${label}`;
          return (
            <li
              key={adv}
              className="active-advisory"
              aria-label={ariaLabel}
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
                {showPdcTarget && (
                  <span className="active-advisory-target">
                    {` → ${pdcPhrase} `}
                    {gapFill!.target_price.toFixed(2)}
                  </span>
                )}
                {showSetTarget && (
                  <span className="active-advisory-target">
                    {` @ `}
                    {gapFill!.settlement_price!.toFixed(2)}
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
  mode,
  tz,
  formatChartTime,
  tzLabel,
}: {
  events: import("../../api/terminalTypes").MacroEvent[];
  // Server-driven mode: "next_24h" = rolling 24h docket (Mon-Fri RTH);
  // "week_ahead" = forward 7-day vol≥2 docket (Fri 17:00 ET → Sun
  // 23:59 ET, lets a Sunday-night trader pre-flight the macro week).
  mode: "next_24h" | "week_ahead";
  tz: TZOption;
  formatChartTime: (iso: string, withSeconds?: boolean) => string;
  tzLabel: string;
}) {
  if (events.length === 0) return null;
  const headerLabel = mode === "week_ahead" ? "this week" : "upcoming 24h";
  return (
    <section className="upcoming-events" aria-label="Upcoming macro events">
      <h4 className="upcoming-events-header">{headerLabel} ({tzLabel})</h4>
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
              {formatRelativeTimeLabel(ev.timestamp, tz, formatChartTime)}
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
