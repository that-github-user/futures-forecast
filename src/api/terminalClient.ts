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
  RegimeData,
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
    if (requireAuth && TERMINAL_API_KEY) {
      headers["X-Terminal-Key"] = TERMINAL_API_KEY;
    }
    const r = await fetch(`${TERMINAL_API_URL}${path}`, { headers });
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
};

/** Convenience wrapper for the chart canvas — returns the bars array
 * (empty when API is offline / unauthorized / no bars yet) so the
 * component doesn't have to handle the null-vs-empty distinction. */
export async function fetchTerminalIntradayBars(): Promise<TerminalIntradayBarsResponse> {
  const data = await terminal.intradayBars();
  return data ?? { bars: [] };
}
