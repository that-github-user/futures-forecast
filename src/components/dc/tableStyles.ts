// Shared table styles for DC dashboard tabs.
//
// Two th variants: plain (non-scrolling contexts) and sticky (scrolling
// panes where the column header should stay pinned). Positions tab
// historically used plain because its tables sit inside nested scroll
// containers where position:sticky doesn't behave cleanly; History and
// Events use sticky.

import type { CSSProperties } from "react";
import { colors, fonts } from "../../styles/tokens";

/** Slightly-darker-than-bgInset tone used as the background for sticky
 *  table headers. Exported so filter-row inputs in DCEventsTab can
 *  match the sticky-header edge above them. Not in the shared palette
 *  — this is a DC-table-local visual detail. */
export const STICKY_HEADER_BG = "#0f1520";

export const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
};

const thBase: CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  color: colors.textMuted,
  fontSize: 10,
  fontFamily: fonts.sans,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  borderBottom: `1px solid ${colors.borderDim}`,
};

export const thStyle: CSSProperties = thBase;

export const thStickyStyle: CSSProperties = {
  ...thBase,
  position: "sticky",
  top: 0,
  background: STICKY_HEADER_BG,
};

export const tdStyle: CSSProperties = {
  padding: "6px 8px",
  color: colors.textPrimary,
  fontSize: 12,
  fontFamily: fonts.sans,
  borderBottom: `1px solid ${colors.bgPanel}`,
};

export const tdMono: CSSProperties = {
  ...tdStyle,
  fontFamily: fonts.mono,
};
