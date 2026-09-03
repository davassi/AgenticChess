# Agentic Chess landing page

Static landing page for Agentic Chess (the aichess repository), styled as an isometric pixel-art game. No build
step and no dependencies: plain HTML, CSS and JavaScript, plus two Google Fonts.

Every section is a "screen" of the same game, and every graphic is drawn in
code from a monochrome pixel mask (`js/pixel.js`) so the whole page shares one
visual vocabulary:

- `index.html`: the page. Copy mirrors the project README.
- `css/landing.css`: tokens, frames, responsive rules, reduced-motion rules.
- `js/pixel.js`: pixel masks, auto-shading, SVG and canvas renderers.
- `js/iso.js`: isometric canvas scenes (the living board and the architecture map).
- `js/main.js`: page wiring: starfield, the scripted opening on the board, countdown.

Serve it from any static host, or locally:

```bash
python3 -m http.server 8765 --directory site
```

Then open <http://127.0.0.1:8765/>.
