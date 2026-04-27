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
      // Build the formatter inline so the timezone-name change picks
      // up immediately on tz change. The formatter is cheap to
      // instantiate and we're calling it ~600 times per chart render
      // — still well under a millisecond on real hardware.
      const opts: Intl.DateTimeFormatOptions = {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        ...(tz !== "local" ? { timeZone: TZ_IANA[tz] } : {}),
        ...(withSeconds ? { second: "2-digit" } : {}),
      };
      // Some Intl implementations emit "24:00" instead of "00:00" at
      // midnight under hour12: false; normalize.
      return new Intl.DateTimeFormat("en-GB", opts).format(d).replace(/^24:/, "00:");
    },
    [tz],
  );

  const tzLabel = tz === "local" ? getLocalTZLabel() : TZ_DISPLAY_LABELS[tz];

  return { tz, setTz, formatTime, formatChartTime, tzLabel };
}
