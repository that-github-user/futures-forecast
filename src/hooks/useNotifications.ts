/**
 * useNotifications — wraps the browser Notification API for DC armed alerts.
 *
 * Manages permission state and exposes a `notify(key, title, body)` helper
 * that fires at most one notification per `key` per ET day. The dedupe set
 * is rolled over lazily on the first `notify` call after the ET date
 * advances, so we don't depend on a background interval (browsers throttle
 * intervals in inactive tabs and may suppress them entirely on suspend).
 *
 * Permission can only be requested in response to a user gesture (browser
 * policy), so callers should drive `requestPermission` from a button click.
 */

import { useCallback, useRef, useState } from "react";

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
  const currentDateRef = useRef<string>(etDateString(new Date()));

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

      // Lazy date rollover: if the ET date has advanced since we last
      // notified, clear yesterday's dedupe set so today's alerts fire.
      const today = etDateString(new Date());
      if (today !== currentDateRef.current) {
        sentRef.current = new Set();
        currentDateRef.current = today;
      }

      const dayKey = `${today}|${key}`;
      if (sentRef.current.has(dayKey)) return;
      sentRef.current.add(dayKey);

      try {
        new Notification(title, { body, tag: dayKey, silent: false });
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
  // YYYY-MM-DD in America/New_York. Used to scope dedupe keys to "today".
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
