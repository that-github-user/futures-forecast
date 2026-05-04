/**
 * useDensity — user-selectable typography density for the terminal
 * sidebar surfaces (System Feed live event log, Active Now, Upcoming
 * 24h calendar).
 *
 * Two states:
 *   "compact"     — default, trader-terminal aesthetic. ~12px body,
 *                   maximum information density.
 *   "comfortable" — bumped sizes for readability. Same layout/grid
 *                   shape, just larger text + slightly looser line-
 *                   height. Closer to a documentation-page register.
 *
 * Persisted in localStorage under `dc.density` so the preference
 * survives reload + cross-tab sync via the `storage` event (matches
 * `useTimezone`'s pattern). The dashboard root applies the value
 * as a `data-density="..."` attribute; CSS overrides under the
 * `[data-density="comfortable"]` selector handle the actual style
 * delta — no per-component prop drilling needed.
 */

import { useCallback, useEffect, useState } from "react";

export type DensityOption = "compact" | "comfortable";

const STORAGE_KEY = "dc.density";

function load(): DensityOption {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "compact" || stored === "comfortable") return stored;
  } catch { /* ignore */ }
  return "compact";
}

export interface DensityApi {
  density: DensityOption;
  setDensity: (next: DensityOption) => void;
}

export function useDensity(): DensityApi {
  const [density, setDensityState] = useState<DensityOption>(() => load());

  const setDensity = useCallback((next: DensityOption) => {
    setDensityState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch { /* ignore */ }
  }, []);

  // Cross-tab sync — `storage` event fires only in OTHER tabs/windows
  // sharing the storage area, never in the tab that called setItem.
  // Same-tab sync is handled by passing density down via props/context
  // from the single useDensity() call site (the dashboard root); see
  // useTimezone's BLOCKER history for the precedent.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setDensityState(load());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { density, setDensity };
}
