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

import { useEffect, useRef, useState } from "react";
import "./RouteNav.css";

export type GatedRoute = "terminal" | "dc" | "straddle" | "markup";

const ROUTES: { key: GatedRoute; label: string; href: string }[] = [
  { key: "terminal", label: "Terminal", href: "#/app" },
  { key: "straddle", label: "Straddle", href: "#/straddle" },
  { key: "markup", label: "Markup", href: "#/markup" },
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
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  // Close the menu when the user navigates (hash change). The user
  // just took the action they came for — no reason to leave the
  // panel open.
  useEffect(() => {
    const close = () => setMenuOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);

  // Esc to close — keyboard parity with mobile dropdowns elsewhere
  // in the dashboard. Restore focus to the toggle on close so
  // keyboard users don't get stranded.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Body scroll-lock while the dropdown is open — prevents the page
  // beneath from scrolling when the user tap-and-drags on the
  // backdrop or panel. Restores prior overflow on close. Note: this
  // capture-and-restore pattern can clobber another modal's scroll-
  // lock if two locks ever stack (this menu opens, then a different
  // modal locks, then this menu closes → restores to "" instead of
  // the modal's "hidden"). No other component currently locks body
  // overflow; if one ever does, switch to a ref-counted helper.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  // Focus trap while the dropdown is open. Without this, Tab past
  // the last link moves focus to the obscured page content beneath
  // the menu — keyboard users get stranded. Cycle Tab between the
  // toggle and the dropdown links so focus stays in the menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const linkEls = menuRef.current?.querySelectorAll<HTMLAnchorElement>("a");
      if (!linkEls || linkEls.length === 0) return;
      const focusables = [
        toggleRef.current,
        ...Array.from(linkEls),
      ].filter(
        (el): el is HTMLButtonElement | HTMLAnchorElement => el !== null,
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
        ref={toggleRef}
        type="button"
        className="route-nav-toggle"
        aria-expanded={menuOpen}
        aria-controls="route-nav-menu"
        aria-label={menuOpen ? "Hide routes" : "Show routes"}
        onClick={() => setMenuOpen((o) => !o)}
      >
        {/* U+2630 ☰ TRIGRAM FOR HEAVEN — renders natively as three
            horizontal bars on every platform without depending on a
            three-span flex layout. aria-hidden on the glyph because
            the button's aria-label provides the accessible name. */}
        <span aria-hidden="true">☰</span>
      </button>
      {menuOpen && (
        <div
          className="route-nav-backdrop"
          aria-hidden="true"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <ul ref={menuRef} className="route-nav-links" id="route-nav-menu">
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
