/**
 * Rasterize public/favicon.svg → public/apple-touch-icon.png at 180×180.
 *
 * iOS Safari does not render SVG home-screen icons (per the comment in
 * index.html). The apple-touch-icon must be a raster PNG. This script
 * regenerates the PNG from the canonical SVG so the two stay in sync.
 *
 * One-time setup (the dependency lives outside the project bundle —
 * pure dev tooling, not a runtime dep):
 *   npm install --no-save @resvg/resvg-js
 *
 * Run from repo root:
 *   node scripts/rasterize_favicon.mjs
 *
 * Re-run whenever public/favicon.svg changes.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SVG_PATH = resolve(REPO_ROOT, "public/favicon.svg");
const OUT_PATH = resolve(REPO_ROOT, "public/apple-touch-icon.png");
const SIZE = 180;

const svg = readFileSync(SVG_PATH, "utf8");

const resvg = new Resvg(svg, {
  background: "#08070a",
  fitTo: { mode: "width", value: SIZE },
  font: {
    loadSystemFonts: true,
    defaultFontFamily: "Georgia",
    serifFamily: "Georgia",
  },
});

const png = resvg.render().asPng();
writeFileSync(OUT_PATH, png);
console.log(`Wrote ${OUT_PATH} (${png.length} bytes, ${SIZE}×${SIZE})`);
