/**
 * Tests for the pure iOS-detection + PWA-standalone predicates that
 * feed `useNotifications`. These are load-bearing for distinguishing
 * "browser genuinely can't do notifications" from "browser CAN but
 * requires Home-Screen install first" (Safari iOS). Getting either
 * wrong either (a) dead-ends iPhone users on a generic "not
 * supported" message, or (b) shows meaningless Add-to-Home-Screen
 * instructions to desktop users.
 *
 * The helpers are pure — they take navigator/matchMedia values as
 * parameters — so these tests run in vitest's default node
 * environment without needing jsdom/happy-dom.
 */

import { describe, expect, it } from "vitest";
import { isIosUserAgent, isStandaloneMode } from "./useNotifications";

describe("isIosUserAgent", () => {
  it("detects iPhone Safari", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 " +
      "Mobile/15E148 Safari/604.1";
    expect(isIosUserAgent(ua, 5)).toBe(true);
  });

  it("detects iPadOS reporting as Mac with touch", () => {
    // iPadOS 13+ reports as Mac; we disambiguate via maxTouchPoints.
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
    expect(isIosUserAgent(ua, 5)).toBe(true);
  });

  it("distinguishes desktop Safari from iPad (no touch)", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
    expect(isIosUserAgent(ua, 0)).toBe(false);
  });

  it("detects iOS Chrome (same WebKit limitation)", () => {
    // Third-party browsers on iOS must use WebKit and inherit the
    // Notification API gap — must be treated the same as Safari.
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.0.0 " +
      "Mobile/15E148 Safari/604.1";
    expect(isIosUserAgent(ua, 5)).toBe(true);
  });

  it("does not detect Android Chrome", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
    expect(isIosUserAgent(ua, 5)).toBe(false);
  });

  it("does not detect Windows desktop", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    expect(isIosUserAgent(ua, 0)).toBe(false);
  });

  it("handles empty UA defensively", () => {
    expect(isIosUserAgent("", 0)).toBe(false);
  });

  it("handles maxTouchPoints=1 (some touchscreen laptops)", () => {
    // Surface-style touchscreen Windows running Chrome-with-Mac-style
    // UA shouldn't trip the iPad detection. Threshold is >1.
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    expect(isIosUserAgent(ua, 1)).toBe(false);
  });
});

describe("isStandaloneMode", () => {
  it("iOS home-screen launch via navigator.standalone=true", () => {
    expect(isStandaloneMode(true, false)).toBe(true);
  });

  it("display-mode:standalone on other platforms", () => {
    expect(isStandaloneMode(undefined, true)).toBe(true);
  });

  it("regular browser tab on iOS (standalone=false)", () => {
    expect(isStandaloneMode(false, false)).toBe(false);
  });

  it("regular browser tab elsewhere (both false)", () => {
    expect(isStandaloneMode(undefined, false)).toBe(false);
  });

  it("both signals present — still standalone", () => {
    expect(isStandaloneMode(true, true)).toBe(true);
  });
});
