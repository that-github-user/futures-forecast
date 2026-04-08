/**
 * useSubscriptions — per-browser DC strategy subscription set.
 *
 * Stores the user's selected strategies in localStorage so the DC dashboard
 * can show only the strategies they care about in the Signals tab. No
 * accounts, no server-side sync — each device tracks its own selection.
 *
 * Only strategy names (string identifiers returned by the API) are stored,
 * never specs or any other strategy data.
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "dc.subscribedStrategies";

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((s) => typeof s === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function persist(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Ignore quota / disabled storage — subscriptions just won't persist.
  }
}

export interface SubscriptionsApi {
  subscribed: Set<string>;
  isSubscribed: (name: string) => boolean;
  toggle: (name: string) => void;
  setAll: (names: string[]) => void;
  count: number;
}

export function useSubscriptions(): SubscriptionsApi {
  const [subscribed, setSubscribed] = useState<Set<string>>(() => load());

  // Cross-tab sync: if the user toggles in another tab, mirror it here.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setSubscribed(load());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback((name: string) => {
    setSubscribed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      persist(next);
      return next;
    });
  }, []);

  const setAll = useCallback((names: string[]) => {
    const next = new Set(names);
    persist(next);
    setSubscribed(next);
  }, []);

  const isSubscribed = useCallback((name: string) => subscribed.has(name), [subscribed]);

  return {
    subscribed,
    isSubscribed,
    toggle,
    setAll,
    count: subscribed.size,
  };
}
