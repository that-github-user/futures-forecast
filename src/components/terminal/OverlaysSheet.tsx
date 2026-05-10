/**
 * OverlaysSheet — mobile-only bottom sheet that consolidates every
 * chart overlay control into one tap target on the toolbar. Replaces
 * the cramped flex-nowrap pill row that was hard to scroll on
 * portrait phones AND had a popover-on-touch bug where the AVWAP
 * panel needed two taps to open and overlapped the next pill.
 *
 * Renders a single "Overlays · n" trigger pill (n = total active
 * overlays, summed across AVWAP anchors + OR windows + boolean
 * toggles). Tapping it opens a full-width, slide-up sheet listing:
 *   - AVWAP grid (3 anchors × 3 fields, big checkbox tap targets)
 *   - Opening Range (3 window pills)
 *   - Levels (POC/VAH/VAL pill, PDH/PDL/PDC pill)
 *
 * Desktop is unchanged — the existing `AvwapPopover` /
 * `OpeningRangePopover` / `ToggleButton` row is what desktop
 * operators see. Both DOM trees exist; CSS media queries pick
 * which is visible (`.terminal-chart-toggles-desktop` vs
 * `.terminal-chart-overlays-mobile`). The state in
 * `TerminalDashboard.overlays` is shared between both.
 */

import { Fragment, useEffect, useState } from "react";
import {
  OR_WINDOWS,
  VWAP_ANCHORS,
  type OrOverlayState,
  type OverlayState,
  type OrWindowKey,
  type VwapAnchorKey,
  type VwapAnchorState,
  type VwapOverlayState,
} from "./chartTypes";

interface Props {
  overlays: OverlayState;
  setVwap: (next: VwapOverlayState) => void;
  setOpeningRange: (next: OrOverlayState) => void;
  togglePocVa: () => void;
  togglePriorHlc: () => void;
}

export function OverlaysSheet({
  overlays,
  setVwap,
  setOpeningRange,
  togglePocVa,
  togglePriorHlc,
}: Props) {
  const [open, setOpen] = useState(false);

  // Body scroll-lock while the sheet is open so swipes inside the
  // sheet don't bleed through to the page underneath.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape to close (keyboard users / external bluetooth keyboards).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const activeCount = countActive(overlays);

  const setAnchorField = (
    anchor: VwapAnchorKey,
    field: keyof VwapAnchorState,
    value: boolean,
  ) => {
    setVwap({
      ...overlays.vwap,
      [anchor]: { ...overlays.vwap[anchor], [field]: value },
    });
  };

  const setOrWindow = (key: OrWindowKey, value: boolean) => {
    setOpeningRange({ ...overlays.openingRange, [key]: value });
  };

  return (
    <>
      <button
        type="button"
        className={`pill${activeCount > 0 ? " on" : ""}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="overlays-sheet"
      >
        Overlays{activeCount > 0 ? ` · ${activeCount}` : ""}
      </button>
      {open && (
        <div
          className="overlays-sheet-backdrop"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        >
          <div
            id="overlays-sheet"
            className="overlays-sheet"
            role="dialog"
            aria-label="Chart overlays"
            // Stop bubbling so a tap inside the sheet body doesn't
            // dismiss via the backdrop's onClick.
            onClick={(e) => e.stopPropagation()}
          >
            <header className="overlays-sheet-head">
              <h2>Overlays</h2>
              <button
                type="button"
                className="overlays-sheet-close"
                onClick={() => setOpen(false)}
                aria-label="Close overlays"
              >
                ×
              </button>
            </header>
            <div className="overlays-sheet-body">
              {/* AVWAP — 3 anchors × 3 fields (VWAP, ±1σ, ±2σ) */}
              <section className="overlays-section">
                <h3 className="overlays-section-title">AVWAP</h3>
                <div className="overlays-avwap-grid">
                  <span />
                  <span className="overlays-avwap-col">VWAP</span>
                  <span className="overlays-avwap-col">±1σ</span>
                  <span className="overlays-avwap-col">±2σ</span>
                  {VWAP_ANCHORS.map(({ key, label }) => {
                    const state = overlays.vwap[key];
                    return (
                      <Fragment key={key}>
                        <span className="overlays-avwap-anchor">{label}</span>
                        <SheetCheck
                          checked={state.vwap}
                          onChange={(v) => setAnchorField(key, "vwap", v)}
                          ariaLabel={`${label} VWAP line`}
                        />
                        <SheetCheck
                          checked={state.band1}
                          onChange={(v) => setAnchorField(key, "band1", v)}
                          ariaLabel={`${label} ±1σ band`}
                        />
                        <SheetCheck
                          checked={state.band2}
                          onChange={(v) => setAnchorField(key, "band2", v)}
                          ariaLabel={`${label} ±2σ band`}
                        />
                      </Fragment>
                    );
                  })}
                </div>
              </section>

              {/* Opening Range — 1m / 5m / 15m as togglable pills */}
              <section className="overlays-section">
                <h3 className="overlays-section-title">Opening Range</h3>
                <div className="overlays-pill-row">
                  {OR_WINDOWS.map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      className={`pill${overlays.openingRange[key] ? " on" : ""}`}
                      onClick={() => setOrWindow(key, !overlays.openingRange[key])}
                      aria-pressed={overlays.openingRange[key]}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              {/* Levels — POC/VA + PDH/PDL/PDC as composite pills */}
              <section className="overlays-section">
                <h3 className="overlays-section-title">Levels</h3>
                <div className="overlays-pill-row">
                  <button
                    type="button"
                    className={`pill${overlays.pocVa ? " on" : ""}`}
                    onClick={togglePocVa}
                    aria-pressed={overlays.pocVa}
                  >
                    POC / VAH / VAL
                  </button>
                  <button
                    type="button"
                    className={`pill${overlays.priorHlc ? " on" : ""}`}
                    onClick={togglePriorHlc}
                    aria-pressed={overlays.priorHlc}
                  >
                    PDH / PDL / PDC
                  </button>
                </div>
              </section>

              {/* ML Fan placeholder — kept disabled for parity with
                  the desktop toolbar so when ML Fan ships, both
                  surfaces inherit the same toggle. */}
              <section className="overlays-section">
                <h3 className="overlays-section-title">Forecast</h3>
                <div className="overlays-pill-row">
                  <span className="pill disabled">ML Fan</span>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SheetCheck({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      className={`overlays-sheet-check${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      aria-label={ariaLabel}
    >
      {checked ? "✓" : ""}
    </button>
  );
}

function countActive(overlays: OverlayState): number {
  let n = 0;
  for (const { key } of VWAP_ANCHORS) {
    const s = overlays.vwap[key];
    if (s.vwap) n += 1;
    if (s.band1) n += 1;
    if (s.band2) n += 1;
  }
  for (const { key } of OR_WINDOWS) {
    if (overlays.openingRange[key]) n += 1;
  }
  if (overlays.pocVa) n += 1;
  if (overlays.priorHlc) n += 1;
  return n;
}
