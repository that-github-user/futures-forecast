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

import { useCallback, useEffect, useRef, useState } from "react";

export type NotificationPermissionState =
  | "default"        // browser supports it; user hasn't been asked yet
  | "granted"        // user approved
  | "denied"         // user declined (or OS blocked)
  | "unsupported"    // browser has no Notification API at all
  | "needs-install"; // Safari iOS in a regular tab — Notification API
                     //   isn't exposed until the site is installed to
                     //   the Home Screen and launched in standalone mode

/** Pure helper — `isIosSafari` wraps this with real navigator access
 *  so the platform-sniff logic stays unit-testable without a DOM. */
export function isIosUserAgent(ua: string, maxTouchPoints: number): boolean {
  // iPhone/iPod/iPad + WebKit-backed browsers on iOS (Safari, or any
  // third-party browser that must use WebKit per App Store rules).
  // We match on the iOS/iPadOS platform rather than "Safari" string
  // because iOS Chrome/Firefox/Edge all share the same limitation.
  if (/iPhone|iPod|iPad/.test(ua)) return true;
  // iPadOS 13+ reports as Mac; disambiguate via maxTouchPoints
  // (desktop Safari has 0, iPad has 5+).
  if (ua.includes("Mac") && maxTouchPoints > 1) return true;
  return false;
}

/** Pure helper — `isStandalonePwa` wraps this. */
export function isStandaloneMode(
  iosStandalone: boolean | undefined,
  displayStandaloneMatches: boolean,
): boolean {
  return iosStandalone === true || displayStandaloneMatches;
}

/** True when we're running on iOS Safari (iPhone/iPad, including
 *  iPadOS pretending to be a desktop). Needed to distinguish
 *  "Notification API is missing, genuinely unsupported" from
 *  "Notification API is missing, but will appear once installed to
 *  the Home Screen" — the latter is an iOS-only quirk. */
export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  return isIosUserAgent(navigator.userAgent || "", navigator.maxTouchPoints ?? 0);
}

/** True when the page is running in an installed-PWA window (iOS
 *  standalone, or display-mode:standalone on other platforms). Safari
 *  iOS only exposes the Notification API in this mode. */
export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari exposes navigator.standalone; non-standard but
  // load-bearing for iOS PWA detection.
  const iosStandalone =
    (window.navigator as unknown as { standalone?: boolean }).standalone;
  // Everyone else: display-mode:standalone media query.
  const displayStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  return isStandaloneMode(iosStandalone, displayStandalone);
}

function currentPermission(): NotificationPermissionState {
  if (typeof window === "undefined") return "unsupported";
  if (typeof Notification === "undefined") {
    // Missing Notification API. On iOS Safari this is recoverable via
    // Home Screen install (once standalone, Notification appears); on
    // other browsers without it, the feature is genuinely unsupported.
    if (isIosSafari() && !isStandalonePwa()) return "needs-install";
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

  // Re-read permission on tab visibility changes. Covers the edge
  // case where a user toggles between the installed PWA window and a
  // regular Safari tab within the same session — without this, the
  // hook would keep a stale "granted" from the PWA while the tab can
  // no longer actually fire notifications (or vice versa). Cheap:
  // one comparison per visibility change.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => {
      if (document.visibilityState === "visible") {
        const fresh = currentPermission();
        setPermission((prev) => (prev === fresh ? prev : fresh));
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const requestPermission = useCallback(async (): Promise<NotificationPermissionState> => {
    if (typeof Notification === "undefined") {
      // Mirror the detection used on initial read so a user who
      // navigated from a pre-install tab into the installed PWA
      // (unlikely but possible) gets the right signal.
      if (isIosSafari() && !isStandalonePwa()) return "needs-install";
      return "unsupported";
    }
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
