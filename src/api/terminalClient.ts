/**
 * Typed fetch wrapper for the terminal API at terminal.denoisedalpha.com.
 *
 * Auth: the HttpOnly session cookie set by POST /terminal/v1/auth/login
 * (credentials:include sends it). No API key is in the bundle — the data
 * is not readable without a server-side login. A 401 on a gated call
 * re-locks the UI (notifyUnauthorized) so the operator re-authenticates.
 *
 * Returns null on errors (graceful degradation — frontend renders the
 * placeholder/loading state for that endpoint instead of crashing).
 */

import type {
  BreadthData,
  GexData,
  LevelsData,
  MarkupAlert,
  MarkupReviewResponse,
  MarkupState,
  RegimeData,
  StraddleChainResponse,
  SynthesizerData,
  TerminalHealth,
  TerminalIntradayBarsResponse,
  TerminalSnapshot,
  VwapData,
} from "./terminalTypes";

import { notifyUnauthorized } from "../hooks/useAuth";

export type { TerminalIntradayBar } from "./terminalTypes";

const TERMINAL_API_URL = import.meta.env.VITE_TERMINAL_API_URL || "";

async function get<T>(path: string, requireAuth = true): Promise<T | null> {
  if (!TERMINAL_API_URL) return null;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    // Auth is the HttpOnly session cookie only (set by /auth/login).
    // credentials:include sends it; same-site to the frontend
    // (denoisedalpha.com → terminal.denoisedalpha.com). No API key is
    // bundled anymore (PR-3) — the data is not readable without a login.
    const r = await fetch(`${TERMINAL_API_URL}${path}`, {
      headers,
      credentials: "include",
    });
    if (!r.ok) {
      // A 401 on a gated call means the session cookie is gone/expired —
      // re-lock so the operator is sent to the lander rather than left
      // with silently-empty panels.
      if (r.status === 401 && requireAuth) notifyUnauthorized();
      return null;
    }
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export const terminal = {
  health: () => get<TerminalHealth>("/terminal/v1/health", false),
  snapshot: () => get<TerminalSnapshot>("/terminal/v1/snapshot"),
  regime: () => get<RegimeData>("/terminal/v1/regime"),
  gex: () => get<GexData>("/terminal/v1/gex"),
  vwap: () => get<VwapData>("/terminal/v1/vwap"),
  levels: () => get<LevelsData>("/terminal/v1/levels"),
  breadth: () => get<BreadthData>("/terminal/v1/breadth"),
  synthesizer: () => get<SynthesizerData>("/terminal/v1/synthesizer"),
  intradayBars: () =>
    get<TerminalIntradayBarsResponse>("/terminal/v1/bars/es-intraday"),
  straddle0dte: () => get<StraddleChainResponse>("/terminal/v1/straddle/0dte"),
  /** Live markup state. Backend returns `null` (HTTP 200) when the
   *  sidecar is absent — `get` already collapses that + network errors
   *  to null, so callers treat null as "no live markup; hide panel". */
  markup: () => get<MarkupState>("/terminal/v1/markup"),
  /** Markup Review: SPX 1-min candles + a session's alerts (with MFE/MAE)
   *  for the post-close review pane. `date`=yyyymmdd ET, `tf`∈{1m,5m}.
   *  Returns null on error/offline (the pane shows its empty state). */
  markupReview: (date: string, tf: "1m" | "5m" = "1m") =>
    get<MarkupReviewResponse>(
      `/terminal/v1/markup/review?date=${encodeURIComponent(date)}&tf=${tf}`,
    ),
};

export interface MarkupStreamHandlers {
  /** Full MarkupState — one on connect, then ~5s. */
  onState?: (state: MarkupState) => void;
  /** A single markup alert, the instant the detector fires (sub-second). */
  onAlert?: (alert: MarkupAlert) => void;
  /** Latest SPX spot, ~0.5s throttled. */
  onSpot?: (ts: string, price: number) => void;
  onOpen?: () => void;
  onError?: () => void;
}

/** Subscribe to the live markup SSE stream (`/terminal/v1/markup/stream`).
 *  Returns an unsubscribe function. The HttpOnly session cookie rides via
 *  `withCredentials` (same as the REST clients' `credentials: include`);
 *  the browser's EventSource auto-reconnects on a dropped connection.
 *  No-op (returns a no-op cleanup) when no terminal URL is configured. */
export function subscribeMarkup(handlers: MarkupStreamHandlers): () => void {
  if (!TERMINAL_API_URL) return () => {};
  const es = new EventSource(`${TERMINAL_API_URL}/terminal/v1/markup/stream`, {
    withCredentials: true,
  });
  const parse = <T>(e: Event): T | null => {
    try {
      return JSON.parse((e as MessageEvent).data) as T;
    } catch {
      return null;
    }
  };
  es.addEventListener("state", (e) => {
    const s = parse<MarkupState>(e);
    if (s) handlers.onState?.(s);
  });
  es.addEventListener("alert", (e) => {
    const a = parse<MarkupAlert>(e);
    if (a) handlers.onAlert?.(a);
  });
  es.addEventListener("spot", (e) => {
    const d = parse<{ ts: string; price: number }>(e);
    if (d) handlers.onSpot?.(d.ts, d.price);
  });
  es.onopen = () => handlers.onOpen?.();
  es.onerror = () => handlers.onError?.();
  return () => es.close();
}

// (fetchTerminalIntradayBars removed — it collapsed fetch FAILURE into
// {bars: []}, indistinguishable from a legit server empty. The chart
// now calls terminal.intradayBars() and branches on null via
// resolveBarsTick so frozen candles can never masquerade as live.)
