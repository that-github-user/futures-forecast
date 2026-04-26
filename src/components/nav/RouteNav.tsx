/**
 * Cross-route nav for the gated surfaces (Terminal / Forecast / DC).
 *
 * Brand mark on the left (mirrors the lander), italic-serif route links
 * on the right separated by middle dots. Active route in --ink-100,
 * inactive in --ink-60. No lumen — that's reserved for brand-thesis
 * moments per spec §2.1.
 *
 * Mobile (≤480px): the inline link strip collapses into a hamburger
 * toggle on the right; the links overlay as a dropdown panel beneath
 * the bar when opened. The toggle is 44px square (iOS HIG) and the
 * panel respects §5 motion language (180ms fade).
 */

import { useEffect, useState } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the menu when the user navigates (hash change). The user
  // just took the action they came for — no reason to leave the
  // panel open.
  useEffect(() => {
    const close = () => setMenuOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);

  // Esc to close — keyboard parity with mobile dropdowns elsewhere
  // in the dashboard.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <nav
      className={`route-nav${menuOpen ? " is-open" : ""}`}
      aria-label="Site sections"
    >
      {showBrand && (
        <div className="route-nav-brand">
          <span className="alpha">α</span><span className="wordmark">denoisedalpha</span>
        </div>
      )}
      <button
        type="button"
        className="route-nav-toggle"
        aria-expanded={menuOpen}
        aria-controls="route-nav-menu"
        aria-label={menuOpen ? "Close routes menu" : "Open routes menu"}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
      <ul className="route-nav-links" id="route-nav-menu">
        {ROUTES.map((r, i) => {
          const isActive = r.key === current;
          return (
            <li key={r.key} className="route-nav-item">
              {i > 0 && <span className="sep" aria-hidden="true">·</span>}
              <a
                href={r.href}
                className={isActive ? "active" : ""}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
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
