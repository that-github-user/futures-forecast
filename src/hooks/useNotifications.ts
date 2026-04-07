/**
 * useNotifications — wraps the browser Notification API for DC ripe alerts.
 *
 * Manages permission state and exposes a `notify(key, title, body)` helper
 * that fires at most one notification per `key` (in-memory dedupe). The
 * dedupe set lives for the page session and is cleared at midnight ET so
 * tomorrow's transitions can fire fresh alerts.
 *
 * Permission can only be requested in response to a user gesture (browser
 * policy), so callers should drive `requestPermission` from a button click.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type NotificationPermissionState = "default" | "granted" | "denied" | "unsupported";

function currentPermission(): NotificationPermissionState {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission as NotificationPermissionState;
}

export interface NotificationsApi {
  permission: NotificationPermissionState;
  requestPermission: () => Promise<NotificationPermissionState>;
  notify: (key: string, title: string, body?: string) => void;
  reset: () => void;
}

export function useNotifications(): NotificationsApi {
  const [permission, setPermission] = useState<NotificationPermissionState>(() => currentPermission());
  const sentRef = useRef<Set<string>>(new Set());
  const lastResetDayRef = useRef<string>(etDateString(new Date()));

  // Reset dedupe set at midnight ET so the next day's alerts fire fresh.
  useEffect(() => {
    const id = setInterval(() => {
      const today = etDateString(new Date());
      if (today !== lastResetDayRef.current) {
        sentRef.current = new Set();
        lastResetDayRef.current = today;
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const requestPermission = useCallback(async (): Promise<NotificationPermissionState> => {
    if (typeof Notification === "undefined") return "unsupported";
    try {
      const result = await Notification.requestPermission();
      setPermission(result as NotificationPermissionState);
      return result as NotificationPermissionState;
    } catch {
      return permission;
    }
  }, [permission]);

  const notify = useCallback(
    (key: string, title: string, body?: string) => {
      if (permission !== "granted") return;
      if (sentRef.current.has(key)) return;
      sentRef.current.add(key);
      try {
        new Notification(title, { body, tag: key, silent: false });
      } catch {
        // Ignore — Notification constructor can throw on some platforms.
      }
    },
    [permission],
  );

  const reset = useCallback(() => {
    sentRef.current = new Set();
  }, []);

  return { permission, requestPermission, notify, reset };
}

function etDateString(d: Date): string {
  // YYYY-MM-DD in America/New_York, used as a midnight-rollover marker.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
