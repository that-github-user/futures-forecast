/**
 * Typed fetch wrapper for the terminal API at terminal.denoisedalpha.com.
 *
 * Auth: X-Terminal-Key header (plain key matches a SHA-256 hash in the
 * server's TERMINAL_API_KEYS env var). Same UX-obfuscation posture as
 * dcClient — the real boundary is server-side header validation.
 *
 * Returns null on errors (graceful degradation — frontend renders the
 * placeholder/loading state for that endpoint instead of crashing).
 */

import type {
  BreadthData,
  GexData,
  LevelsData,
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

export type { TerminalIntradayBar } from "./terminalTypes";

const TERMINAL_API_URL = import.meta.env.VITE_TERMINAL_API_URL || "";
const TERMINAL_API_KEY = import.meta.env.VITE_TERMINAL_API_KEY || "";

async function get<T>(path: string, requireAuth = true): Promise<T | null> {
  if (!TERMINAL_API_URL) return null;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    // Legacy key header — kept through the dual-accept window (PR-2); the
    // server also accepts the session cookie. Removed in PR-3 once the
    // cookie flow is confirmed live, along with the baked-in key.
    if (requireAuth && TERMINAL_API_KEY) {
      headers["X-Terminal-Key"] = TERMINAL_API_KEY;
    }
    // Send the HttpOnly session cookie (set by /auth/login). Same-site
    // to the frontend (denoisedalpha.com → terminal.denoisedalpha.com).
    const r = await fetch(`${TERMINAL_API_URL}${path}`, {
      headers,
      credentials: "include",
    });
    if (!r.ok) return null;
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

/** Convenience wrapper for the chart canvas — returns the bars array
 * (empty when API is offline / unauthorized / no bars yet) so the
 * component doesn't have to handle the null-vs-empty distinction. */
export async function fetchTerminalIntradayBars(): Promise<TerminalIntradayBarsResponse> {
  const data = await terminal.intradayBars();
  return data ?? { bars: [] };
}
