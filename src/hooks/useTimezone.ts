/**
 * useTimezone — user-selectable timezone for displaying entry times.
 *
 * All entry times in the system are stored and computed in ET (Eastern Time).
 * This hook converts them for display in the user's preferred timezone.
 *
 * US timezones are always a fixed offset from ET (they all switch DST
 * simultaneously), so a simple hour subtraction works year-round.
 * The "local" option uses the browser's Intl API for non-US coverage.
 */

import { useCallback, useEffect, useState } from "react";

export type TZOption = "ET" | "CT" | "MT" | "PT" | "local";

const STORAGE_KEY = "dc.timezone";

const TZ_OFFSETS: Record<Exclude<TZOption, "local">, number> = {
  ET: 0,
  CT: -1,
  MT: -2,
  PT: -3,
};

const TZ_DISPLAY_LABELS: Record<Exclude<TZOption, "local">, string> = {
  ET: "ET",
  CT: "CT",
  MT: "MT",
  PT: "PT",
};

function load(): TZOption {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (stored === "ET" || stored === "CT" || stored === "MT" || stored === "PT" || stored === "local")) {
      return stored;
    }
  } catch { /* ignore */ }
  return "ET";
}

function getLocalTZLabel(): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timeZoneName: "short",
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value ?? "Local";
  } catch {
    return "Local";
  }
}

function getLocalETOffsetHours(): number {
  // Compute the offset between ET and the browser's local timezone.
  const now = new Date();
  const etStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const localStr = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  const [etH] = etStr.split(":").map(Number);
  const [localH] = localStr.split(":").map(Number);
  // Handle midnight rollover
  let diff = localH - etH;
  if (diff > 12) diff -= 24;
  if (diff < -12) diff += 24;
  return diff;
}

// IANA timezone names for each TZOption. Used by `formatChartTime`
// to convert ISO UTC timestamps via Intl.DateTimeFormat (which
// auto-handles DST, unlike the fixed-offset `formatTime` for the
// DC route's already-ET-local HH:MM strings).
const TZ_IANA: Record<Exclude<TZOption, "local">, string> = {
  ET: "America/New_York",
  CT: "America/Chicago",
  MT: "America/Denver",
  PT: "America/Los_Angeles",
};

// Module-level formatter cache. The chart's `bars.map(formatBarTime)`
// runs ~600 times per option-rebuild; instantiating an
// Intl.DateTimeFormat per call (even though formatters are interned
// in V8) showed up as a meaningful slice of render time. One
// formatter per tz option is sufficient — locale "en-GB" is
// load-bearing: it defaults to `hourCycle: "h23"` which produces
// "00:00" at midnight; "en-US" + hour12:false produces "24:00" on
// some impls. The replace() in formatChartTime is the safety net.
const chartFormatters = new Map<TZOption, Intl.DateTimeFormat>();
const chartFormattersSec = new Map<TZOption, Intl.DateTimeFormat>();
const chartDayFormatters = new Map<TZOption, Intl.DateTimeFormat>();
const chartCrosshairFormatters = new Map<TZOption, Intl.DateTimeFormat>();
const positionDateTimeFormatters = new Map<TZOption, Intl.DateTimeFormat>();

function buildChartFormatter(tz: TZOption, withSeconds: boolean): Intl.DateTimeFormat {
  const opts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(tz !== "local" ? { timeZone: TZ_IANA[tz] } : {}),
    ...(withSeconds ? { second: "2-digit" } : {}),
  };
  return new Intl.DateTimeFormat("en-GB", opts);
}

function buildChartDayFormatter(tz: TZOption): Intl.DateTimeFormat {
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    ...(tz !== "local" ? { timeZone: TZ_IANA[tz] } : {}),
  };
  return new Intl.DateTimeFormat("en-GB", opts);
}

// "DD MMM HH:MM" (e.g. "18 May 19:15") in the active TZ. Used by the
// lightweight chart's `localization.timeFormatter` for the bottom-axis
// crosshair label (#336). en-GB ordering matches the visual style the
// operator already sees in the tooltip's time row; hourCycle h23
// keeps midnight as "00:00" (en-US would emit "24:00" on some impls).
function buildChartCrosshairFormatter(tz: TZOption): Intl.DateTimeFormat {
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(tz !== "local" ? { timeZone: TZ_IANA[tz] } : {}),
  };
  return new Intl.DateTimeFormat("en-GB", opts);
}

function buildPositionDateTimeFormatter(tz: TZOption): Intl.DateTimeFormat {
  // "Apr 27, 09:45" in the user's selected TZ. Used by the DC
  // positions table so the entry-time column reads in the same
  // timezone as the rest of the dashboard.
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(tz !== "local" ? { timeZone: TZ_IANA[tz] } : {}),
  };
  return new Intl.DateTimeFormat("en-US", opts);
}

function getChartFormatter(tz: TZOption): Intl.DateTimeFormat {
  let f = chartFormatters.get(tz);
  if (!f) {
    f = buildChartFormatter(tz, false);
    chartFormatters.set(tz, f);
  }
  return f;
}

function getChartFormatterSec(tz: TZOption): Intl.DateTimeFormat {
  let f = chartFormattersSec.get(tz);
  if (!f) {
    f = buildChartFormatter(tz, true);
    chartFormattersSec.set(tz, f);
  }
  return f;
}

function getChartDayFormatter(tz: TZOption): Intl.DateTimeFormat {
  let f = chartDayFormatters.get(tz);
  if (!f) {
    f = buildChartDayFormatter(tz);
    chartDayFormatters.set(tz, f);
  }
  return f;
}

function getChartCrosshairFormatter(tz: TZOption): Intl.DateTimeFormat {
  let f = chartCrosshairFormatters.get(tz);
  if (!f) {
    f = buildChartCrosshairFormatter(tz);
    chartCrosshairFormatters.set(tz, f);
  }
  return f;
}

function getPositionDateTimeFormatter(tz: TZOption): Intl.DateTimeFormat {
  let f = positionDateTimeFormatters.get(tz);
  if (!f) {
    f = buildPositionDateTimeFormatter(tz);
    positionDateTimeFormatters.set(tz, f);
  }
  return f;
}

export interface TimezoneApi {
  tz: TZOption;
  setTz: (tz: TZOption) => void;
  /** Convert an "HH:MM" string from ET to the user's selected timezone. */
  formatTime: (hhmmET: string | null) => string;
  /**
   * Format an ISO UTC timestamp as "HH:MM" (or "HH:MM:SS" with seconds)
   * in the user's selected timezone via Intl.DateTimeFormat. DST-aware
   * because IANA zones are queried directly, not derived via a fixed
   * offset table.
   */
  formatChartTime: (iso: string, withSeconds?: boolean) => string;
  /**
   * Format an ISO UTC timestamp as a 2-digit day-of-month ("27") in
   * the user's selected timezone. Used by the chart's x-axis label
   * generator to mark day-changeover bars (midnight crossings AND
   * the Friday→Sunday weekend reopen — both are detected as the
   * day-of-month differing from the previous bar).
   */
  formatChartDay: (iso: string) => string;
  /**
   * Format an ISO UTC timestamp as "DD MMM HH:MM" (e.g. "18 May 19:15")
   * in the user's selected timezone. Used by the lightweight chart's
   * `localization.timeFormatter` for the bottom-axis crosshair label
   * (#336) — distinct from `formatChartDay` which the day-changeover
   * tickMarkFormatter intentionally needs bare "DD" for.
   */
  formatChartCrosshair: (iso: string) => string;
  /**
   * Format an ISO UTC timestamp as "Apr 27, 09:45" in the user's
   * selected timezone. Used by the DC positions table so the entry-
   * time column reads in the same TZ as the rest of the dashboard.
   */
  formatPositionDateTime: (iso: string) => string;
  /** Display label for the current timezone ("ET", "PT", "PDT", etc.) */
  tzLabel: string;
}

export function useTimezone(): TimezoneApi {
  const [tz, setTzState] = useState<TZOption>(() => load());

  const setTz = useCallback((next: TZOption) => {
    setTzState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch { /* ignore */ }
  }, []);

  // Cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setTzState(load());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const formatTime = useCallback(
    (hhmmET: string | null): string => {
      if (!hhmmET || hhmmET.length < 4) return "—";
      const parts = hhmmET.split(":");
      if (parts.length !== 2) return hhmmET;
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmmET;

      const offset = tz === "local" ? getLocalETOffsetHours() : TZ_OFFSETS[tz];
      let newH = h + offset;
      if (newH < 0) newH += 24;
      if (newH >= 24) newH -= 24;
      return `${String(newH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    },
    [tz],
  );

  const formatChartTime = useCallback(
    (iso: string, withSeconds: boolean = false): string => {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const fmt = withSeconds ? getChartFormatterSec(tz) : getChartFormatter(tz);
      // V8 emits "24:00" (and "24:00:00") at midnight under en-US +
      // hour12: false. en-GB defaults to hourCycle "h23" which avoids
      // that — but the regex stays as belt-and-suspenders in case the
      // Intl impl ever changes.
      return fmt.format(d).replace(/^24:/, "00:");
    },
    [tz],
  );

  const formatChartDay = useCallback(
    (iso: string): string => {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return getChartDayFormatter(tz).format(d);
    },
    [tz],
  );

  const formatChartCrosshair = useCallback(
    (iso: string): string => {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      // V8 emits "24:00" at midnight under some impls; matches the
      // safety net in formatChartTime above. en-GB defaults to h23
      // which avoids the issue, but the replace stays defensive.
      return getChartCrosshairFormatter(tz).format(d).replace(/ 24:/, " 00:");
    },
    [tz],
  );

  const formatPositionDateTime = useCallback(
    (iso: string): string => {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return getPositionDateTimeFormatter(tz).format(d);
    },
    [tz],
  );

  const tzLabel = tz === "local" ? getLocalTZLabel() : TZ_DISPLAY_LABELS[tz];

  return {
    tz, setTz, formatTime, formatChartTime, formatChartDay,
    formatChartCrosshair, formatPositionDateTime, tzLabel,
  };
}
