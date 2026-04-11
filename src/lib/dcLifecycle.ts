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
 *   imminent → within ±10min of an entry time
 *   firing → within ±30s of an entry time
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

export function deriveLifecycle(
  spec: DCStrategySpec,
  signal: string | null,
  featuresStale: boolean,
  now: Date,
): LifecycleInfo {
  const windowKind = classifyWindow(spec);
  const { pythonDow, secondsOfDay } = etPartsAt(now);
  const isEntryDay = spec.entry_days.includes(pythonDow);

  // Not an entry day at all → inactive regardless of time of day.
  // (Otherwise a Sunday-evening user would see "closed" for a Monday-only
  // strategy because secondsOfDay is past RTH close.)
  if (!isEntryDay) {
    return baseInfo({
      state: "inactive",
      windowKind,
      isArmed: false,
      firesToday: false,
    });
  }

  // After RTH close on an entry day: nothing more to anticipate today.
  if (secondsOfDay >= RTH_CLOSE_SECONDS) {
    return baseInfo({
      state: "closed",
      windowKind,
      isArmed: false,
      firesToday: false,
    });
  }

  if (featuresStale) {
    return baseInfo({
      state: "pre_features",
      windowKind,
      isArmed: false,
      firesToday: false,
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
        return baseInfo({
          state: armedSignal ? "imminent" : "not_fired_yet",
          windowKind,
          nextEntryHHMM: nextHHMM,
          secondsUntilNext: delta,
          isArmed: armedSignal,
          firesToday: armedSignal,
        });
      }
      return baseInfo({
        state: armedSignal ? "primed" : "not_fired_yet",
        windowKind,
        nextEntryHHMM: nextHHMM,
        secondsUntilNext: delta,
        isArmed: armedSignal,
        firesToday: armedSignal,
      });
    }

    if (secondsOfDay <= winEnd) {
      // Inside the window
      return baseInfo({
        state: armedSignal ? "imminent" : "not_fired_yet",
        windowKind,
        nextEntryHHMM: spec.entry_window_end,
        secondsUntilNext: winEnd - secondsOfDay,
        lastEntryHHMM: spec.entry_times[0],
        secondsSinceLast: secondsOfDay - winStart,
        isArmed: armedSignal,
        firesToday: armedSignal,
      });
    }

    // Past the window end
    const sinceWindow = secondsOfDay - winEnd;
    if (sinceWindow <= IMMINENT_WINDOW_SECONDS && armedSignal) {
      return baseInfo({
        state: "recently_fired",
        windowKind,
        lastEntryHHMM: spec.entry_window_end,
        secondsSinceLast: sinceWindow,
        isArmed: false,
        firesToday: armedSignal,
      });
    }
    return baseInfo({
      state: armedSignal ? "passed_will_fire" : "passed_skipped",
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
  // over a far-future next entry on multi-time strategies.
  if (lastSec != null) {
    const secondsSince = secondsOfDay - lastSec;
    if (secondsSince <= FIRING_WINDOW_SECONDS) {
      return baseInfo({
        state: "firing",
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
      return baseInfo({
        state: "recently_fired",
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
  if (nextSec != null) {
    const delta = nextSec - secondsOfDay;
    if (delta <= FIRING_WINDOW_SECONDS) {
      return baseInfo({
        state: "firing",
        windowKind,
        nextEntryHHMM: nextHHMM,
        secondsUntilNext: delta,
        lastEntryHHMM: lastHHMM,
        secondsSinceLast: lastSec != null ? secondsOfDay - lastSec : null,
        isArmed: armedSignal,
        firesToday: armedSignal,
      });
    }
    if (delta <= IMMINENT_WINDOW_SECONDS) {
      return baseInfo({
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
    return baseInfo({
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
  return baseInfo({
    state: armedSignal ? "passed_will_fire" : "passed_skipped",
    windowKind,
    lastEntryHHMM: lastHHMM,
    secondsSinceLast: lastSec != null ? secondsOfDay - lastSec : null,
    isArmed: false,
    firesToday: armedSignal,
  });
}

function baseInfo(partial: Partial<LifecycleInfo> & { state: LifecycleState; windowKind: WindowKind }): LifecycleInfo {
  return {
    nextEntryHHMM: null,
    lastEntryHHMM: null,
    secondsUntilNext: null,
    secondsSinceLast: null,
    isArmed: false,
    firesToday: false,
    ...partial,
  };
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
