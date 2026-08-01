/**
 * dcLifecycle — derive a strategy's visual lifecycle state for "now".
 *
 * Pure function. Given a strategy spec (entry days, entry times, optional
 * entry window), the current signal, whether features are stale, and a
 * `now` Date, returns the lifecycle state plus a few helpful fields for
 * the UI (countdown seconds, HH:MM labels, kind of entry window).
 *
 * The state machine is documented in the project plan:
 *   inactive → not entry day
 *   pre_features → entry day but features not ready
 *   primed → entry day, GO/GO+, >10min before next entry time
 *   imminent → within 10min before an entry time (until it fires)
 *   firing → within 30s AFTER an entry time (daemon is actively processing)
 *   recently_fired → 30s..10min after an entry time
 *   passed_will_fire → all entries past, signal was GO/GO+, before RTH close
 *   passed_skipped → all entries past, signal was SKIP, before RTH close
 *   not_fired_yet → entry day, signal SKIP, still within entry window(s)
 *   closed → after RTH close (16:00 ET)
 *
 * Strategies with an `entry_window_end` are treated as a continuous
 * "range" window — they are imminent for the full duration when the signal
 * is GO/GO+. The function never references any specific strategy by name.
 */

import type { DCStrategySpec } from "../api/dcTypes";

export type LifecycleState =
  | "inactive"
  | "pre_features"
  | "primed"
  | "imminent"
  | "firing"
  | "recently_fired"
  | "passed_will_fire"
  | "passed_skipped"
  | "not_fired_yet"
  | "closed";

export type WindowKind = "single" | "multi" | "range";

export interface LifecycleInfo {
  state: LifecycleState;
  windowKind: WindowKind;
  /** HH:MM (ET) of the next upcoming entry time today, or null if none. */
  nextEntryHHMM: string | null;
  /** HH:MM (ET) of the most recent entry time today that has already passed, or null. */
  lastEntryHHMM: string | null;
  /** Seconds until the next upcoming entry time today, or null. */
  secondsUntilNext: number | null;
  /** Seconds since the most recent passed entry time today, or null. */
  secondsSinceLast: number | null;
  /** Whether the strategy is "armed" right now (in primed/imminent/firing). */
  isArmed: boolean;
  /** Whether the strategy fires today at all (entry day && ≥1 GO/GO+ window). */
  firesToday: boolean;
  /** Next entry day-of-week (Python convention: 0=Mon..6=Sun). For active states = today.
   *  For inactive/closed = the next matching weekday from spec.entry_days. Used for sort. */
  nextEntryDow: number;
  /** Most recent daemon outcome for today's entry slot, surfaced from
   *  signal_events via the API (#277). Lets the strategy card render
   *  a tooltip explaining WHY the daemon skipped — see
   *  StrategyMonitorCard/BodyContent.tsx. Null when no entry
   *  evaluation has fired today, or the API doesn't yet emit it. */
  todayOutcome: string | null;
  /** Human-readable reason from signal_events.outcome_reason. */
  todayOutcomeReason: string | null;
}

const RTH_CLOSE_SECONDS = 16 * 3600; // 16:00 ET
const IMMINENT_WINDOW_SECONDS = 10 * 60;
const FIRING_WINDOW_SECONDS = 30;

interface ETParts {
  /** 0=Mon..6=Sun (Python convention, matches spec.entry_days). */
  pythonDow: number;
  /** Seconds since midnight ET. */
  secondsOfDay: number;
}

const WEEKDAY_TO_PYTHON: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

/** Seconds since midnight ET for `now`. Exported so a leaf that renders
 *  a per-second countdown can compute the delta against a fixed HH:MM
 *  target without rebuilding an Intl.DateTimeFormat per tick. */
export function etSecondsOfDay(now: Date): number {
  return etPartsAt(now).secondsOfDay;
}

/** Parse "HH:MM" ET → seconds since midnight. Exported alongside
 *  etSecondsOfDay so the countdown leaf uses the same conversion the
 *  lifecycle state machine does. */
export function parseHHMMToSeconds(s: string): number {
  return parseHHMM(s);
}

function etPartsAt(now: Date): ETParts {
  // Use Intl to extract the wall-clock view of `now` in America/New_York.
  // This gracefully handles DST transitions without us needing to track
  // the offset manually.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const weekday = get("weekday"); // "Mon", "Tue", ...
  // hour can come back as "24" at midnight in some locales — normalize.
  const hour = (parseInt(get("hour"), 10) || 0) % 24;
  const minute = parseInt(get("minute"), 10) || 0;
  const second = parseInt(get("second"), 10) || 0;

  return {
    pythonDow: WEEKDAY_TO_PYTHON[weekday] ?? 0,
    secondsOfDay: hour * 3600 + minute * 60 + second,
  };
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 3600 + (m || 0) * 60;
}

function secondsToHHMM(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function classifyWindow(spec: DCStrategySpec): WindowKind {
  if (spec.entry_window_end != null) return "range";
  if (spec.entry_times.length > 1) return "multi";
  return "single";
}

function isGoSignal(signal: string | null): boolean {
  return signal === "GO" || signal === "GO_PLUS";
}

/** Did the daemon actually ATTEMPT to enter today? The operator's
 *  signals-tab card should stay highlighted (FIRING / recently_fired)
 *  for the full 10min post-entry window whenever the daemon got far
 *  enough to fire an order — even if the broker rejected the fill.
 *
 *  Two outcomes count as "attempted":
 *    - "entered"       — every gate cleared AND the broker filled
 *    - "blocked_order" — every signal-side gate cleared AND the daemon
 *                        submitted the reprice ladder; the broker side
 *                        failed (no cross / parked-no-fill exhausted).
 *                        From the operator's anticipation standpoint
 *                        the strategy FIRED — graying out the card
 *                        the instant the ladder gave up penalizes
 *                        viewing for an automation-side failure that
 *                        the trader's mental model considers a real
 *                        play. The phantom row tracks the would-have-
 *                        entered position; the card stays highlighted
 *                        in parallel.
 *
 *  All OTHER blocked_* outcomes (blocked_sl_gate, blocked_vix,
 *  blocked_margin, blocked_strike, blocked_legs, blocked_data,
 *  blocked_deconflict, skipped_*, future enum values) are signal-
 *  side gates — the daemon correctly chose NOT to fire. Those render
 *  as passed_skipped. The rule keeps forward-compat: a future
 *  "blocked_capital_xyz" defaults to passed_skipped without a
 *  frontend change.
 *
 *  EXCEPT "blocked_entries_disabled" — see RETIRED_NOT_TRADED below.
 */
function attemptedEntryToday(todayOutcome: string | null): boolean {
  return todayOutcome === "entered" || todayOutcome === "blocked_order";
}

/** Decide whether to treat post-window state as "fired" (will render
 *  passed_will_fire / firing / recently_fired) vs "skipped" (passed_
 *  skipped). When the daemon's authoritative outcome is available
 *  for today, trust it. When it isn't (pre-observability rows, daemon
 *  was down at entry time, or the API hasn't shipped #277 yet), fall
 *  back to the ensemble signal — preserves pre-#277 behavior so the
 *  card doesn't flip to "NO FIRE" on cold-start. */
/** The 2026-08-01 DC retirement outcome: the signal fired, the daemon
 *  deliberately did not trade it (`dc_entry.enabled: false`).
 *
 *  This renders in the FIRED family, not passed_skipped. "Skipped" means
 *  the daemon evaluated and declined; this means it never got to decide,
 *  because we withdrew from the product. Graying the card identically to
 *  a genuine no-signal day misrepresents the day — a GO+ did fire.
 *
 *  Same shape as the brokerNoFill precedent: keep the fired STYLE so the
 *  card stays highlighted, and relabel the chip so nothing claims an
 *  order went out (see chipPresentation.ts).
 *
 *  HONEST LIMIT, do not overstate this in UI copy: the master switch sits
 *  upstream of the S/L and margin gates, so this outcome proves the signal
 *  fired and cleared the direction/risk/duplicate checks — NOT that the
 *  trade would have been entered. The S/L gate is never evaluated on these
 *  days. "Would have traded" is unknowable; "fired, not traded" is true.
 */
const RETIRED_NOT_TRADED = "blocked_entries_disabled";

export function isRetiredNotTraded(todayOutcome: string | null): boolean {
  return todayOutcome === RETIRED_NOT_TRADED;
}

function shouldRenderAsFired(
  signal: string | null,
  todayOutcome: string | null,
): boolean {
  if (todayOutcome != null) {
    return attemptedEntryToday(todayOutcome) || isRetiredNotTraded(todayOutcome);
  }
  return isGoSignal(signal);
}

export function deriveLifecycle(
  spec: DCStrategySpec,
  signal: string | null,
  featuresStale: boolean,
  now: Date,
  todayOutcome: string | null = null,
  todayOutcomeReason: string | null = null,
): LifecycleInfo {
  // Inject the daemon-authoritative outcome fields into every return
  // via this thin wrapper rather than threading them into the ~9
  // baseInfo callsites individually. Local closure picks up the
  // function-scope todayOutcome / todayOutcomeReason params.
  const withOutcome = (
    partial: Parameters<typeof baseInfo>[0],
  ): LifecycleInfo => baseInfo({
    ...partial,
    todayOutcome,
    todayOutcomeReason,
  });

  const windowKind = classifyWindow(spec);
  const { pythonDow, secondsOfDay } = etPartsAt(now);
  const isEntryDay = spec.entry_days.includes(pythonDow);

  // Not an entry day at all → inactive regardless of time of day.
  // (Otherwise a Sunday-evening user would see "closed" for a Monday-only
  // strategy because secondsOfDay is past RTH close.)
  if (!isEntryDay) {
    return withOutcome({
      state: "inactive",
      windowKind,
      isArmed: false,
      firesToday: false,
      nextEntryDow: nextEntryDowFrom(spec.entry_days, pythonDow),
    });
  }

  // After RTH close on an entry day: nothing more to anticipate today.
  // Next entry = next matching weekday after today (may be next week).
  if (secondsOfDay >= RTH_CLOSE_SECONDS) {
    return withOutcome({
      state: "closed",
      windowKind,
      nextEntryDow: nextEntryDowFrom(spec.entry_days, pythonDow),
      isArmed: false,
      firesToday: false,
    });
  }

  // All states below are on an entry day → nextEntryDow is today.
  // Override the baseInfo default for every subsequent return.
  const todayBase = { nextEntryDow: pythonDow };

  if (featuresStale) {
    return withOutcome({
      state: "pre_features",
      windowKind,
      isArmed: false,
      firesToday: false,
      ...todayBase,
    });
  }

  const armedSignal = isGoSignal(signal);

  // Range window (continuous entry period): treat the whole window as one
  // "imminent" period when GO/GO+ — the daemon could fire at any minute.
  if (windowKind === "range") {
    const winStart = parseHHMM(spec.entry_times[0]);
    const winEnd = parseHHMM(spec.entry_window_end as string);

    if (secondsOfDay < winStart) {
      const delta = winStart - secondsOfDay;
      const nextHHMM = spec.entry_times[0];
      if (delta <= IMMINENT_WINDOW_SECONDS) {
        return withOutcome({ ...todayBase,
          state: armedSignal ? "imminent" : "not_fired_yet",
          windowKind,
          nextEntryHHMM: nextHHMM,
          secondsUntilNext: delta,
          isArmed: armedSignal,
          firesToday: armedSignal,
        });
      }
      return withOutcome({ ...todayBase,
        state: armedSignal ? "primed" : "not_fired_yet",
        windowKind,
        nextEntryHHMM: nextHHMM,
        secondsUntilNext: delta,
        isArmed: armedSignal,
        firesToday: armedSignal,
      });
    }

    if (secondsOfDay <= winEnd) {
      // Inside the range window. The daemon can fire at any minute — but
      // treating a 5-hour window as "imminent" misleads viewers. Use "primed"
      // for the general within-window period and only escalate to "imminent"
      // within 10 minutes of the window END (the actual deadline).
      const timeToEnd = winEnd - secondsOfDay;
      const windowState = !armedSignal
        ? "not_fired_yet" as const
        : timeToEnd <= IMMINENT_WINDOW_SECONDS
          ? "imminent" as const
          : "primed" as const;
      return withOutcome({ ...todayBase,
        state: windowState,
        windowKind,
        nextEntryHHMM: spec.entry_window_end,
        secondsUntilNext: timeToEnd,
        lastEntryHHMM: spec.entry_times[0],
        secondsSinceLast: secondsOfDay - winStart,
        isArmed: armedSignal,
        firesToday: armedSignal,
      });
    }

    // Past the window end. Range-window `recently_fired` decision
    // uses the same daemon-outcome-aware gate as the discrete-entry
    // sites below so a range-window strategy that the daemon
    // blocked (SL/VIX/margin/…) flips to passed_skipped instead of
    // rendering "Just fired" for 10 minutes. No range-window
    // strategies exist today, but parity with the discrete sites
    // keeps the classifier coherent against future additions.
    const sinceWindow = secondsOfDay - winEnd;
    if (sinceWindow <= IMMINENT_WINDOW_SECONDS && shouldRenderAsFired(signal, todayOutcome)) {
      return withOutcome({ ...todayBase,
        state: "recently_fired",
        windowKind,
        lastEntryHHMM: spec.entry_window_end,
        secondsSinceLast: sinceWindow,
        isArmed: false,
        firesToday: armedSignal,
      });
    }
    return withOutcome({ ...todayBase,
      state: shouldRenderAsFired(signal, todayOutcome) ? "passed_will_fire" : "passed_skipped",
      windowKind,
      lastEntryHHMM: spec.entry_window_end,
      secondsSinceLast: sinceWindow,
      isArmed: false,
      firesToday: armedSignal,
    });
  }

  // Discrete entry times (single or multi).
  const entrySeconds = spec.entry_times.map(parseHHMM);
  const passed: number[] = [];
  const upcoming: number[] = [];
  for (const s of entrySeconds) {
    if (s <= secondsOfDay) passed.push(s);
    else upcoming.push(s);
  }
  const lastSec = passed.length > 0 ? passed[passed.length - 1] : null;
  const nextSec = upcoming.length > 0 ? upcoming[0] : null;
  const lastHHMM = lastSec != null ? secondsToHHMM(lastSec) : null;
  const nextHHMM = nextSec != null ? secondsToHHMM(nextSec) : null;

  // Check "just fired" first — a recently passed entry takes precedence
  // over a far-future next entry on multi-time strategies. SKIP-signal
  // strategies never enter "firing" or "recently_fired" states — those
  // imply actual entry. Use passed_skipped so the card shows "NO FIRE"
  // instead of "FIRING NOW" (which would fire a misleading notification).
  if (lastSec != null) {
    const secondsSince = secondsOfDay - lastSec;
    if (secondsSince <= FIRING_WINDOW_SECONDS) {
      return withOutcome({ ...todayBase,
        state: shouldRenderAsFired(signal, todayOutcome) ? "firing" : "passed_skipped",
        windowKind,
        lastEntryHHMM: lastHHMM,
        secondsSinceLast: secondsSince,
        nextEntryHHMM: nextHHMM,
        secondsUntilNext: nextSec != null ? nextSec - secondsOfDay : null,
        isArmed: armedSignal,
        firesToday: armedSignal,
      });
    }
    if (secondsSince <= IMMINENT_WINDOW_SECONDS) {
      return withOutcome({ ...todayBase,
        state: shouldRenderAsFired(signal, todayOutcome) ? "recently_fired" : "passed_skipped",
        windowKind,
        lastEntryHHMM: lastHHMM,
        secondsSinceLast: secondsSince,
        nextEntryHHMM: nextHHMM,
        secondsUntilNext: nextSec != null ? nextSec - secondsOfDay : null,
        isArmed: false,
        firesToday: armedSignal,
      });
    }
  }

  // Look ahead to the next entry time, if any.
  //
  // Note: we deliberately do NOT show "firing" in the 30s BEFORE the entry
  // time. The daemon's cron fires at HH:MM:00 and then takes ~10-20s of
  // work (SPX fetch → expiry resolve → IV fetch → strike resolve → S/L
  // snapshot → gates → order submit) before the order actually goes out.
  // Previously the UI showed "FIRING NOW" from HH:MM-00:30 through
  // HH:MM+00:30 — which meant the countdown flipped to "firing" up to
  // 25s before the daemon had even received its cron tick, let alone
  // submitted. Users reasonably interpreted this as "an order is going
  // out right now." The post-entry firing branch above still catches the
  // 0-30s window after the cron fires, which is when the daemon is
  // actually processing. Before the entry time we stay in `imminent`.
  if (nextSec != null) {
    const delta = nextSec - secondsOfDay;
    if (delta <= IMMINENT_WINDOW_SECONDS) {
      return withOutcome({ ...todayBase,
        state: armedSignal ? "imminent" : "not_fired_yet",
        windowKind,
        nextEntryHHMM: nextHHMM,
        secondsUntilNext: delta,
        lastEntryHHMM: lastHHMM,
        secondsSinceLast: lastSec != null ? secondsOfDay - lastSec : null,
        isArmed: armedSignal,
        firesToday: armedSignal,
      });
    }
    return withOutcome({ ...todayBase,
      state: armedSignal ? "primed" : "not_fired_yet",
      windowKind,
      nextEntryHHMM: nextHHMM,
      secondsUntilNext: delta,
      lastEntryHHMM: lastHHMM,
      secondsSinceLast: lastSec != null ? secondsOfDay - lastSec : null,
      isArmed: armedSignal,
      firesToday: armedSignal,
    });
  }

  // All discrete entries have passed and we're more than 10min past the
  // last one (otherwise the recently_fired branch above would have caught it).
  return withOutcome({ ...todayBase,
    state: shouldRenderAsFired(signal, todayOutcome) ? "passed_will_fire" : "passed_skipped",
    windowKind,
    lastEntryHHMM: lastHHMM,
    secondsSinceLast: lastSec != null ? secondsOfDay - lastSec : null,
    isArmed: false,
    firesToday: armedSignal,
  });
}

function baseInfo(partial: Partial<LifecycleInfo> & { state: LifecycleState; windowKind: WindowKind; nextEntryDow: number }): LifecycleInfo {
  return {
    nextEntryHHMM: null,
    lastEntryHHMM: null,
    secondsUntilNext: null,
    secondsSinceLast: null,
    isArmed: false,
    firesToday: false,
    todayOutcome: null,
    todayOutcomeReason: null,
    ...partial,
  };
}

/** Days from `currentDow` until `targetDow` (1-7, wraps at week boundary). */
export function daysUntilDow(currentDow: number, targetDow: number): number {
  const diff = targetDow - currentDow;
  return diff > 0 ? diff : diff + 7;
}

/** Compute the nearest entry day-of-week from spec.entry_days after currentDow. */
function nextEntryDowFrom(entryDays: number[], currentDow: number): number {
  if (entryDays.length === 0) return currentDow;
  let best = entryDays[0];
  let bestDist = daysUntilDow(currentDow, entryDays[0]);
  for (let i = 1; i < entryDays.length; i++) {
    const d = daysUntilDow(currentDow, entryDays[i]);
    if (d < bestDist) {
      bestDist = d;
      best = entryDays[i];
    }
  }
  return best;
}

/** Format a duration in seconds as "1h 23m" / "5m 12s" / "23s". */
export function formatCountdown(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

const PYTHON_DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function dowName(pythonDow: number): string {
  return PYTHON_DOW_NAMES[pythonDow] ?? "?";
}

export function formatEntryDays(days: number[]): string {
  if (days.length === 5 && [0, 1, 2, 3, 4].every((d) => days.includes(d))) return "Daily";
  return days.map(dowName).join(", ");
}

const MONTH_ABBREV = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format a YYYYMMDD IBKR expiry string as "Mon DD" (year dropped — we only trade short DTE). */
export function formatExpiry(expiry: string): string {
  if (!expiry || expiry.length !== 8) return expiry || "—";
  const monthIdx = parseInt(expiry.slice(4, 6), 10) - 1;
  const day = parseInt(expiry.slice(6, 8), 10);
  if (monthIdx < 0 || monthIdx > 11 || !Number.isFinite(day)) return expiry;
  return `${MONTH_ABBREV[monthIdx]} ${day}`;
}
