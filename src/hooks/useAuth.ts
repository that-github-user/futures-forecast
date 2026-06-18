/**
 * Shared session-auth hook for the gated routes.
 *
 * REAL server-side auth (PR-2 of the auth-hardening rollout). The
 * operator's password is verified SERVER-SIDE by the terminal API
 * (`POST /terminal/v1/auth/login`), which sets an HttpOnly session
 * cookie scoped to `.denoisedalpha.com`. Because the cookie is HttpOnly
 * it is invisible to JS — so "am I logged in?" is answered by asking the
 * server (`GET /terminal/v1/auth/session`), not by reading a flag we set
 * ourselves. The cookie also rides every API request (the clients send
 * `credentials: "include"`), so it is the actual access credential, not
 * UX theater. This replaces the prior client-side bcrypt gate.
 *
 * Auth lives on the terminal API host (VITE_TERMINAL_API_URL); the same
 * cookie authorizes dc-api (same registrable domain). When no terminal
 * URL is configured (local dev) or in demo mode there is no backend to
 * authenticate against, so the gate is disabled (open) — matching the
 * prior dev-open behavior.
 */

import { useEffect, useState } from "react";

type AuthStatus = "checking" | "authed" | "unauthed";

const TERMINAL_API_URL = import.meta.env.VITE_TERMINAL_API_URL || "";
const IS_DEMO = import.meta.env.VITE_DEMO_MODE === "true";

/** True when a real server-side gate exists (prod with a backend). In
 *  demo/dev (no terminal URL) there's nothing to authenticate against. */
export const HAS_GATE = Boolean(TERMINAL_API_URL) && !IS_DEMO;

// ── module-level shared store (so every RequireAuth + the lander agree
//    on one auth state, and a login anywhere updates all of them) ──────
let status: AuthStatus = HAS_GATE ? "checking" : "authed";
let checkStarted = false;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function setStatus(next: AuthStatus) {
  if (next !== status) {
    status = next;
    notify();
  }
}

async function checkSession(): Promise<void> {
  if (!HAS_GATE) {
    setStatus("authed");
    return;
  }
  try {
    const r = await fetch(`${TERMINAL_API_URL}/terminal/v1/auth/session`, {
      credentials: "include",
    });
    const data = r.ok ? ((await r.json()) as { authenticated?: boolean }) : null;
    // Only apply if still "checking" — a login()/logout() may have
    // resolved the status definitively while this one-shot check was in
    // flight; the late result must not clobber it (race guard).
    if (status === "checking") {
      setStatus(data?.authenticated ? "authed" : "unauthed");
    }
  } catch {
    // Can't reach the server to confirm — treat as locked (the gated UI
    // stays closed; the lander is shown). Trade-off: a flaky connection at
    // load can show the lander to a user who actually holds a valid
    // cookie; they re-enter the password. We prefer that (fail closed)
    // over flashing gated chrome on an unverifiable session. The API
    // clients degrade to empty states independently.
    if (status === "checking") setStatus("unauthed");
  }
}

/** Kick off the one-time session check (idempotent). */
function ensureChecked(): void {
  if (!checkStarted) {
    checkStarted = true;
    void checkSession();
  }
}

export interface LoginResult {
  ok: boolean;
  /** true when the server throttled the attempt (HTTP 429). */
  rateLimited?: boolean;
}

/** Submit the operator password to the server; on success the server
 *  sets the session cookie and we flip to authed. */
export async function login(passphrase: string): Promise<LoginResult> {
  if (!HAS_GATE) {
    setStatus("authed");
    return { ok: true };
  }
  try {
    const r = await fetch(`${TERMINAL_API_URL}/terminal/v1/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passphrase }),
    });
    if (r.ok) {
      setStatus("authed");
      return { ok: true };
    }
    if (r.status === 429) return { ok: false, rateLimited: true };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Called by the API clients when a GATED request returns 401 — i.e. the
 *  session cookie is missing or has expired (the 12h server TTL elapsed
 *  mid-use). Re-locks so the gate sends the operator back to the lander
 *  to re-authenticate, instead of leaving them staring at silently-empty
 *  panels. No-op without a gate (dev/demo) or when already locked.
 *
 *  Dormant during the PR-2 dual-accept window — the legacy key still
 *  authorizes requests, so gated calls don't 401. It becomes load-bearing
 *  in PR-3 once the baked-in keys are removed and the cookie is the only
 *  credential. */
export function notifyUnauthorized(): void {
  if (HAS_GATE && status === "authed") {
    setStatus("unauthed");
  }
}

/** Clear the server session cookie and re-lock the UI. */
export async function logout(): Promise<void> {
  // Dev/demo has no gate and no session — logging "out" would wrongly
  // lock an always-open build, so it's a no-op there.
  if (!HAS_GATE) return;
  try {
    await fetch(`${TERMINAL_API_URL}/terminal/v1/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // best-effort; we re-lock the UI regardless
  }
  setStatus("unauthed");
}

export function useAuth() {
  const [s, setS] = useState<AuthStatus>(status);

  useEffect(() => {
    const fn = () => setS(status);
    listeners.add(fn);
    ensureChecked();
    // Defensive resync: if another component's session check already
    // moved the module status between this component's render (where
    // useState read it) and this effect, adopt the latest now. A no-op
    // re-render when unchanged (React bails on equal state).
    fn();
    return () => {
      listeners.delete(fn);
    };
  }, []);

  return {
    status: s,
    authed: s === "authed",
    checking: s === "checking",
    hasGate: HAS_GATE,
    login,
    logout,
  };
}

/** Test-only: reset the module store between tests. */
export function __resetAuthForTests() {
  status = HAS_GATE ? "checking" : "authed";
  checkStarted = false;
  listeners.clear();
}

/** Test-only: current module status (the HttpOnly cookie hides real
 *  auth from JS, so tests observe the resolved store state here). */
export function __statusForTests() {
  return status;
}

/** Test-only: run the one-shot session check (normally fired by the
 *  hook on mount). Lets tests exercise the in-flight race guard. */
export function __checkSessionForTests() {
  return checkSession();
}
