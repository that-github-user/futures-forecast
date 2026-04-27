"""Regenerate public/favicon.svg from the EB Garamond italic α glyph.

The favicon's α is rendered as an SVG `<path>` (not a `<text>` element)
so it doesn't depend on the user's system fonts at render time. EB
Garamond's italic α has a distinctive Greek glyph design; system serifs
like DejaVu Serif render italic α nearly identically to italic Latin
"a" at small sizes, which made the prior text-based favicon read as
the wrong letter.

This script:
  1. Downloads EB Garamond italic 400 from Google Fonts (cached in
     /tmp on first run).
  2. Extracts the α glyph (U+03B1) as an SVG path via fonttools'
     SVGPathPen.
  3. Computes the transform that fits the glyph to ~88% of a 512×512
     viewBox.
  4. Writes the complete favicon.svg with the radial-gradient atmosphere.

Usage:
  python3 -m venv .venv && .venv/bin/pip install fonttools brotli
  .venv/bin/python scripts/build_favicon_svg.py

Then regenerate the PNG raster:
  node scripts/rasterize_favicon.mjs

Re-run only when the favicon design changes.
"""

import os
import urllib.request
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "public" / "favicon.svg"
FONT_CACHE = Path("/tmp/ebg-italic-400.ttf")
FONT_URL = (
    "https://fonts.gstatic.com/s/ebgaramond/v32/"
    "SlGFmQSNjdsmc35JDF1K5GRwUjcdlttVFm-rI7e8QI96.ttf"
)

VIEWBOX = 512
TARGET_HEIGHT_FRAC = 0.88


def fetch_font() -> Path:
    if FONT_CACHE.exists() and FONT_CACHE.stat().st_size > 100_000:
        return FONT_CACHE
    print(f"downloading {FONT_URL}")
    req = urllib.request.Request(FONT_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as r:
        FONT_CACHE.write_bytes(r.read())
    return FONT_CACHE


def main() -> None:
    font_path = fetch_font()
    font = TTFont(font_path)
    glyph_name = font.getBestCmap()[0x03B1]
    glyph_set = font.getGlyphSet()
    glyph = glyph_set[glyph_name]

    g = font["glyf"][glyph_name]
    x_min, x_max, y_min, y_max = g.xMin, g.xMax, g.yMin, g.yMax

    pen = SVGPathPen(glyph_set)
    glyph.draw(pen)
    path_d = pen.getCommands()

    glyph_h = y_max - y_min
    scale = (VIEWBOX * TARGET_HEIGHT_FRAC) / glyph_h
    scaled_h = glyph_h * scale
    scaled_w = (x_max - x_min) * scale
    top_margin = (VIEWBOX - scaled_h) / 2
    left_margin = (VIEWBOX - scaled_w) / 2

    # After applying scale + y-flip (scale negative y), the glyph's
    # bbox in SVG coords spans [-y_max*scale, -y_min*scale] in y.
    # Translate so the top of that bbox lands at top_margin.
    ty = y_max * scale + top_margin
    tx = -x_min * scale + left_margin

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {VIEWBOX} {VIEWBOX}" width="{VIEWBOX}" height="{VIEWBOX}">\n'
        f"  <title>Denoised Alpha</title>\n"
        f"  <defs>\n"
        f'    <radialGradient id="bg" cx="68%" cy="32%" r="85%">\n'
        f'      <stop offset="0%" stop-color="#1a1610"/>\n'
        f'      <stop offset="55%" stop-color="#0d0c0a"/>\n'
        f'      <stop offset="100%" stop-color="#06050a"/>\n'
        f"    </radialGradient>\n"
        f'    <radialGradient id="halo" cx="50%" cy="55%" r="50%">\n'
        f'      <stop offset="0%" stop-color="#f5efe2" stop-opacity="0.14"/>\n'
        f'      <stop offset="55%" stop-color="#efc88b" stop-opacity="0.05"/>\n'
        f'      <stop offset="100%" stop-color="#efc88b" stop-opacity="0"/>\n'
        f"    </radialGradient>\n"
        f"  </defs>\n"
        f'  <rect width="{VIEWBOX}" height="{VIEWBOX}" fill="url(#bg)"/>\n'
        f'  <circle cx="256" cy="280" r="220" fill="url(#halo)"/>\n'
        f'  <g transform="translate({tx:.2f}, {ty:.2f}) scale({scale:.4f}, -{scale:.4f})">\n'
        f'    <path d="{path_d}" fill="#efc88b"/>\n'
        f"  </g>\n"
        f"</svg>\n"
    )

    OUT_PATH.write_text(svg)
    print(f"wrote {OUT_PATH} ({len(svg)} bytes)")


if __name__ == "__main__":
    main()
