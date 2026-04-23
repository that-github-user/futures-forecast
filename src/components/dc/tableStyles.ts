// Shared table styles for DC dashboard tabs.
//
// Two th variants: plain (non-scrolling contexts) and sticky (scrolling
// panes where the column header should stay pinned). Positions tab
// historically used plain because its tables sit inside nested scroll
// containers where position:sticky doesn't behave cleanly; History and
// Events use sticky.

import type { CSSProperties } from "react";
import { colors, fonts } from "../../styles/tokens";

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
  // Slightly darker-than-bgInset so the sticky header edge reads
  // against the rows below. One-off — not in the shared palette.
  background: "#0f1520",
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
