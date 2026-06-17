/**
 * App router — hash-based routes:
 *   #/         → LumenLander (auth gate)
 *   #/app      → TerminalDashboard (six-system trading terminal)
 *   #/straddle → StraddlePage (0DTE SPX strike-positioning map)
 *   #/markup   → MarkupReviewPane (post-close markup alert review)
 *   #/dc       → DCDashboard (DC trading)
 *
 * (The ES-prediction Dashboard at #/forecast was retired — broken and
 * unused for months; its component files remain in the repo but are no
 * longer routed/bundled.)
 *
 * Every route component is lazy-loaded so the bundle a user fetches
 * is scoped to the routes they actually visit. Pre-PR (eager
 * imports), a user going straight to `/app` still pulled in
 * Dashboard's static dependency on echarts (~382 KB gz) because
 * App.tsx imported all four route components statically. With
 * lazy-loading, that user's bundle is `entry + LumenLander +
 * TerminalDashboard + TerminalChartCore` — echarts-free.
 *
 * Suspense fallback is a centered loader matching the dashboard
 * surface tones so the route swap doesn't flash an unstyled empty
 * div.
 */

import { Component, Suspense, lazy, type ReactNode } from "react";
import { useHash } from "./hooks/useHash";
// RequireAuth eager: 0.3 KB chunk would cost more in HTTP round-trip
// than it saves. The gate is on every gated-route render path;
// lazy-splitting just adds a tiny chunk fetch with no real benefit
// (R1+R2 both flagged this). The route-component lazies below are
// where the bundle savings come from — they hold the heavy deps.
import { RequireAuth } from "./components/lander/RequireAuth";
import { colors, fonts } from "./styles/tokens";

const DCDashboard = lazy(() =>
  import("./components/dc/DCDashboard").then((m) => ({ default: m.DCDashboard })),
);
const LumenLander = lazy(() =>
  import("./components/lander/LumenLander").then((m) => ({ default: m.LumenLander })),
);
const TerminalDashboard = lazy(() =>
  import("./components/terminal/TerminalDashboard").then((m) => ({
    default: m.TerminalDashboard,
  })),
);
const StraddlePage = lazy(() =>
  import("./components/straddle/StraddlePage").then((m) => ({
    default: m.StraddlePage,
  })),
);
const MarkupReviewPane = lazy(() =>
  import("./components/markup/MarkupReviewPane").then((m) => ({
    default: m.MarkupReviewPane,
  })),
);

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === "true";

function App() {
  const [hash] = useHash();
  const isDC = hash === "#/dc" || hash.startsWith("#/dc/");
  const isTerminal = hash === "#/app" || hash.startsWith("#/app/");
  const isStraddle = hash === "#/straddle" || hash.startsWith("#/straddle/");
  const isMarkup = hash === "#/markup" || hash.startsWith("#/markup/");

  let content: React.ReactNode;
  if (isDC) {
    content = IS_DEMO ? (
      <DCDemoUnavailable />
    ) : (
      <RequireAuth>
        <DCDashboard />
      </RequireAuth>
    );
  } else if (isStraddle) {
    content = (
      <RequireAuth>
        <StraddlePage />
      </RequireAuth>
    );
  } else if (isMarkup) {
    content = (
      <RequireAuth>
        <MarkupReviewPane />
      </RequireAuth>
    );
  } else if (isTerminal) {
    content = (
      <RequireAuth>
        <TerminalDashboard />
      </RequireAuth>
    );
  } else {
    // Default route `#/` — the lander / auth gate.
    // After unlock, send the operator to the terminal (the new
    // load-bearing surface). The other gated surfaces are reachable via
    // RouteNav links from any gated page.
    content = <LumenLander redirectTo="#/app" />;
  }

  return (
    <div className="app-root">
      <div className="app-content">
        <ChunkLoadErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            {content}
          </Suspense>
        </ChunkLoadErrorBoundary>
      </div>
    </div>
  );
}

/** Self-healing reload (#348). A plain `location.reload()` doesn't
 *  bust the service worker registration or browser/SW caches, which
 *  means a stale `index.html` (cached with `max-age=600` per GH Pages
 *  defaults) gets served again with the same dead chunk references →
 *  the error boundary fires again → infinite loop. The original
 *  Reload button reproduced this loop in prod after #347 deploy
 *  (operator-reported on mobile + desktop).
 *
 *  Steps:
 *  1. Unregister all service workers — the dashboard's SW is
 *     content-less (PWA-install enabler only, no fetch handler) but
 *     having one registered can sticky the controlled-page state on
 *     some browsers, blocking the HTML cache from being revalidated.
 *  2. Clear all `caches` — same reason; even though we don't use the
 *     Cache API today, future SW code might, and a stale cache from
 *     a prior deploy could be poisoning navigations.
 *  3. Replace the URL with a cache-busting query param — guarantees
 *     the browser fetches a fresh `index.html` from the origin (or
 *     CDN edge with a different cache key) instead of any cached
 *     copy of the bare URL.
 *
 *  All steps `try/catch` individually so a failure in one (e.g.
 *  navigator.serviceWorker undefined on very old browsers) doesn't
 *  block the reload itself.
 */
async function selfHealAndReload(): Promise<void> {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("Service worker unregister failed:", e);
  }
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("Cache clear failed:", e);
  }
  // location.replace (vs assign) avoids leaving the broken page in
  // the browser's history; the query param forces the HTTP cache
  // to treat this as a fresh URL.
  const url = new URL(window.location.href);
  url.searchParams.set("_v", Date.now().toString());
  window.location.replace(url.toString());
}

/** Catches dynamic-import failures from `React.lazy` chunks. The
 *  failure mode this guards against: after a deploy, a user with a
 *  cached `index.js` from the prior deploy tries to fetch a hashed
 *  chunk that no longer exists at the expected URL. The lazy import
 *  rejects, Suspense bubbles the error, and without a boundary above
 *  it the user gets a white screen + console error. The boundary
 *  catches the rejection and prompts a reload via `selfHealAndReload`
 *  (#348) which clears SW + caches + cache-busts the URL so the
 *  reload actually fetches a fresh `index.html` and breaks the loop. */
class ChunkLoadErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // Surface to console for debug; the typical chunk-load failure
    // produces "Failed to fetch dynamically imported module".
    // eslint-disable-next-line no-console
    console.error("Route chunk failed to load:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: colors.bgBase,
            fontFamily: fonts.sans,
            color: colors.textSecondary,
            gap: 14,
            padding: 24,
            textAlign: "center",
          }}
        >
          <p style={{ margin: 0, fontSize: 14, color: colors.textPrimary }}>
            A new version of the dashboard is available.
          </p>
          <p style={{ margin: 0, fontSize: 12, color: colors.textSecondary }}>
            Reload to apply.
          </p>
          <button
            type="button"
            onClick={selfHealAndReload}
            style={{
              marginTop: 4,
              padding: "8px 16px",
              fontSize: 12,
              fontFamily: fonts.sans,
              color: colors.textPrimary,
              background: colors.borderDim,
              border: `1px solid ${colors.borderDim}`,
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Centered loading state during route-chunk fetch. Sized for full
 *  viewport so a slow connection doesn't render a tiny spinner.
 *  Matches the muted ink-60 tone the rest of the app uses for
 *  pre-data states. */
function RouteFallback() {
  // height: 100% (NOT 100vh) — `.app-content` is already a viewport-
  // tall flex item, so 100vh inside it would double-count and clip
  // (R1 nit). 100% fills the parent cleanly.
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: colors.bgBase,
        fontFamily: fonts.sans,
        color: colors.textSecondary,
        fontSize: 13,
        letterSpacing: "0.02em",
      }}
    >
      Loading…
    </div>
  );
}

function DCDemoUnavailable() {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: colors.bgBase,
        fontFamily: fonts.sans,
        color: colors.textSecondary,
        gap: 12,
      }}
    >
      <h2 style={{ color: colors.textPrimary, fontSize: 18, margin: 0 }}>
        DC Trading Dashboard
      </h2>
      <p style={{ fontSize: 13, margin: 0 }}>
        Not available in demo mode — requires live backend connection.
      </p>
      <a
        href="#/"
        style={{
          marginTop: 8,
          color: colors.accentBlue,
          fontSize: 12,
          textDecoration: "none",
          padding: "6px 14px",
          background: colors.borderDim,
          borderRadius: 4,
        }}
      >
        Back
      </a>
    </div>
  );
}

export default App;
