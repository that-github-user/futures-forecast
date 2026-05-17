/**
 * InfoPopover — shared ⓘ button + dismissable help popover.
 *
 * Extracted at the third consumer (#334) after two near-identical
 * inline implementations:
 *   - #208 StrikeVelocityTape   (initial pattern)
 *   - #210 StraddleMapChart      (second copy)
 *   - this PR  PinCandidatesPanel (third — trigger for the lift)
 *
 * Owns the open/close state, the document-mousedown + Escape
 * listeners, the button-click race-protection (mousedown handler
 * skips clicks on the button itself so the toggle is a single state
 * transition), and the aria-expanded / role=dialog contract.
 *
 * Deliberately has NO opinion on positioning — consumers control
 * placement via parent-scoped CSS targeting `.info-popover-btn` and
 * `.info-popover-panel`. This keeps each chart panel's specific
 * anchor (top-right of chart, bottom-left under title, etc.)
 * consumer-owned without forcing a "placement" enum API that would
 * need to grow with every new consumer.
 *
 * Children render inside the popover's <div role="dialog">; pass a
 * <ul> or whatever fits. The `label` prop drives BOTH the button's
 * aria-label and the dialog's aria-label so screen readers see the
 * same description in both spots.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import "./InfoPopover.css";

interface Props {
  /** Shared aria-label for the button and the dialog. Should describe
   *  what the popover explains (e.g., "How to read the strike velocity
   *  tape"). */
  label: string;
  children: ReactNode;
}

export function InfoPopover({ label, children }: Props) {
  const [open, setOpen] = useState(false);
  const onToggle = useCallback(() => setOpen((v) => !v), []);
  const onClose = useCallback(() => setOpen(false), []);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!panelRef.current) return;
      if (panelRef.current.contains(e.target as Node)) return;
      // Skip when the click is on the ⓘ button itself — the button's
      // own onClick handles the toggle. Without this skip, the
      // document handler would close the popover BEFORE the button's
      // click event fired, then the button would reopen it — a
      // racy unmount/remount in the same frame.
      const target = e.target as Element | null;
      if (target?.closest(".info-popover-btn")) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return (
    <>
      <button
        type="button"
        className={`info-popover-btn${open ? " active" : ""}`}
        aria-label={label}
        aria-expanded={open}
        onClick={onToggle}
      >
        ⓘ
      </button>
      {open && (
        <div
          ref={panelRef}
          className="info-popover-panel"
          role="dialog"
          aria-label={label}
        >
          {children}
        </div>
      )}
    </>
  );
}
