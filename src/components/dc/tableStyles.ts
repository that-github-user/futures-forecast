// Shared table styles for DC dashboard tabs.
//
// Two th variants: plain (non-scrolling contexts) and sticky (scrolling
// panes where the column header should stay pinned). Positions tab
// historically used plain because its tables sit inside nested scroll
// containers where position:sticky doesn't behave cleanly; History and
// Events use sticky.

import type { CSSProperties } from "react";

export const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
};

const thBase: CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  color: "#64748b",
  fontSize: 10,
  fontFamily: "Inter, sans-serif",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  borderBottom: "1px solid #1e293b",
};

export const thStyle: CSSProperties = thBase;

export const thStickyStyle: CSSProperties = {
  ...thBase,
  position: "sticky",
  top: 0,
  background: "#0f1520",
};

export const tdStyle: CSSProperties = {
  padding: "6px 8px",
  color: "#e2e8f0",
  fontSize: 12,
  fontFamily: "Inter, sans-serif",
  borderBottom: "1px solid #111827",
};

export const tdMono: CSSProperties = {
  ...tdStyle,
  fontFamily: "JetBrains Mono, monospace",
};
