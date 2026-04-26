/**
 * Cross-route nav for the gated surfaces (Terminal / Forecast / DC).
 *
 * Brand mark on the left (mirrors the lander), italic-serif route links
 * on the right separated by middle dots. Active route in --ink-100,
 * inactive in --ink-60. No lumen — that's reserved for brand-thesis
 * moments per spec §2.1.
 *
 * Used by the terminal (above the headline strip) and the DC dashboard
 * (in the top-right of the existing header). The FanChart Dashboard
 * can adopt it in a follow-up PR.
 */

import "./RouteNav.css";

export type GatedRoute = "terminal" | "forecast" | "dc";

const ROUTES: { key: GatedRoute; label: string; href: string }[] = [
  { key: "terminal", label: "Terminal", href: "#/app" },
  { key: "forecast", label: "Forecast", href: "#/forecast" },
  { key: "dc", label: "DC", href: "#/dc" },
];

interface Props {
  current: GatedRoute;
  /** When true, includes the α denoisedalpha brand mark on the left.
   *  Pages that already display a brand identifier in their header
   *  (DC dashboard) can pass false to avoid duplication. */
  showBrand?: boolean;
}

export function RouteNav({ current, showBrand = true }: Props) {
  return (
    <nav className="route-nav" aria-label="Site sections">
      {showBrand && (
        <div className="route-nav-brand">
          <span className="alpha">α</span><span className="wordmark">denoisedalpha</span>
        </div>
      )}
      <ul className="route-nav-links">
        {ROUTES.map((r, i) => {
          const isActive = r.key === current;
          return (
            <li key={r.key} className="route-nav-item">
              {i > 0 && <span className="sep" aria-hidden="true">·</span>}
              <a
                href={r.href}
                className={isActive ? "active" : ""}
                aria-current={isActive ? "page" : undefined}
              >
                {r.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
