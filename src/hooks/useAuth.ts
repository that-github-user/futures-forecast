/**
 * Shared session-auth hook for the gated routes.
 *
 * Generalizes the prior DCAuthGate's sessionStorage-based unlock so a
 * single passphrase entered at `#/` lets the operator into any
 * behind-the-gate route (`#/forecast`, `#/dc`) without re-prompting.
 *
 * SECURITY POSTURE: this is UX obfuscation, NOT a security boundary.
 * The bcrypt hash is in the bundle; sessionStorage can be set via
 * devtools. The real boundary is the server-side X-API-Key /
 * X-DC-Key header validation in the FastAPI services. Keep
 * VITE_DC_PASSWORD_HASH set in production builds.
 *
 * Env var name `VITE_DC_PASSWORD_HASH` is preserved from the prior
 * DC-only gate to avoid requiring an env update on existing
 * deployments. The same hash now unlocks every gated route.
 */

import { useEffect, useState } from "react";
import bcrypt from "bcryptjs";

const STORAGE_KEY = "denoisedalpha-unlocked";
const PASSWORD_HASH = import.meta.env.VITE_DC_PASSWORD_HASH || "";

const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function readUnlocked(): boolean {
  if (!PASSWORD_HASH) return true;
  return sessionStorage.getItem(STORAGE_KEY) === "true";
}

export function useAuth() {
  const [unlocked, setUnlockedState] = useState<boolean>(readUnlocked);

  useEffect(() => {
    const fn = () => setUnlockedState(readUnlocked());
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  /** Try a passphrase; returns true on success and persists unlock. */
  function tryUnlock(passphrase: string): boolean {
    if (!PASSWORD_HASH) {
      sessionStorage.setItem(STORAGE_KEY, "true");
      setUnlockedState(true);
      notify();
      return true;
    }
    const ok = bcrypt.compareSync(passphrase, PASSWORD_HASH);
    if (ok) {
      sessionStorage.setItem(STORAGE_KEY, "true");
      setUnlockedState(true);
      notify();
    }
    return ok;
  }

  function lock() {
    sessionStorage.removeItem(STORAGE_KEY);
    setUnlockedState(false);
    notify();
  }

  return { unlocked, tryUnlock, lock, hasGate: Boolean(PASSWORD_HASH) };
}
