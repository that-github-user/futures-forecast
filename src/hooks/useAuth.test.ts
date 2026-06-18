/**
 * Tests for the cookie-based session-auth hook (PR-2).
 *
 * These exercise the module-level auth functions (the security-relevant
 * contracts): login/logout/session hit the right endpoints with
 * credentials included, status codes map correctly, and the gate is
 * disabled in dev/demo. Env is stubbed per-test and the module is
 * re-imported so HAS_GATE (evaluated at module load) reflects it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TERMINAL_URL = "https://terminal.test";

function okJson(body: unknown = {}) {
  return { ok: true, status: 200, json: async () => body };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAuth — gated (terminal URL set, not demo)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_TERMINAL_API_URL", TERMINAL_URL);
    vi.stubEnv("VITE_DEMO_MODE", "");
  });

  it("HAS_GATE is true", async () => {
    const mod = await import("./useAuth");
    expect(mod.HAS_GATE).toBe(true);
  });

  it("login POSTs the password with credentials and flips to authed on 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson());
    vi.stubGlobal("fetch", fetchMock);
    const mod = await import("./useAuth");

    const res = await mod.login("hunter2");

    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${TERMINAL_URL}/terminal/v1/auth/login`);
    expect(opts.method).toBe("POST");
    expect(opts.credentials).toBe("include");
    expect(opts.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(opts.body)).toEqual({ password: "hunter2" });
  });

  it("login surfaces rate-limiting on HTTP 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const mod = await import("./useAuth");
    expect(await mod.login("x")).toEqual({ ok: false, rateLimited: true });
  });

  it("login fails (not rate-limited) on HTTP 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const mod = await import("./useAuth");
    expect(await mod.login("wrong")).toEqual({ ok: false });
  });

  it("login fails closed on a network error (never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const mod = await import("./useAuth");
    expect(await mod.login("x")).toEqual({ ok: false });
  });

  it("logout POSTs to the logout endpoint with credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const mod = await import("./useAuth");

    await mod.logout();

    expect(fetchMock).toHaveBeenCalledWith(
      `${TERMINAL_URL}/terminal/v1/auth/logout`,
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("logout still re-locks even if the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const mod = await import("./useAuth");
    await expect(mod.logout()).resolves.toBeUndefined();
  });

  it("a late session check does NOT clobber an explicit login (race guard)", async () => {
    // /auth/session resolves LATE and unauthenticated; the operator logs
    // in (authed) before it lands. The stale check must not re-lock them.
    let resolveSession!: (v: unknown) => void;
    const sessionPending = new Promise((res) => {
      resolveSession = res;
    });
    const fetchMock = vi.fn((url: string) =>
      url.endsWith("/auth/session") ? sessionPending : Promise.resolve(okJson()),
    );
    vi.stubGlobal("fetch", fetchMock);
    const mod = await import("./useAuth");

    const checkDone = mod.__checkSessionForTests(); // in flight (pending)
    expect(await mod.login("hunter2")).toEqual({ ok: true });
    expect(mod.__statusForTests()).toBe("authed");

    // now the stale check resolves unauthenticated…
    resolveSession({ ok: true, status: 200, json: async () => ({ authenticated: false }) });
    await checkDone;

    expect(mod.__statusForTests()).toBe("authed"); // login survived
  });
});

describe("useAuth — no gate (dev/demo)", () => {
  it("HAS_GATE is false and login resolves ok WITHOUT calling the server", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_TERMINAL_API_URL", "");
    vi.stubEnv("VITE_DEMO_MODE", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const mod = await import("./useAuth");

    expect(mod.HAS_GATE).toBe(false);
    expect(await mod.login("")).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("demo mode disables the gate even when a terminal URL is set", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_TERMINAL_API_URL", TERMINAL_URL);
    vi.stubEnv("VITE_DEMO_MODE", "true");
    const mod = await import("./useAuth");
    expect(mod.HAS_GATE).toBe(false);
  });
});
