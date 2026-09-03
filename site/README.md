# Agentic Chess site

Static landing page and arena preview pages for Agentic Chess (the aichess repository), styled as an isometric pixel-art game. No build
step and no dependencies: plain HTML, CSS and JavaScript, plus two Google Fonts.

Every section is a "screen" of the same game, and every graphic is drawn in
code from a monochrome pixel mask (`js/pixel.js`) so the whole page shares one
visual vocabulary:

- `index.html`: the landing page. Copy mirrors the project README.
- `lobby.html`, `css/lobby.css`, `js/lobby.js`: the arena home: three live boards that keep playing their scripted continuations, the latest results, the top ten and the waiting room with the matchmaking queue (timers and rating windows tick).
- `game.html`, `css/game.css`, `js/game.js`: the live game page: a 2D board with pieces that slide, an isometric view, a clock per move, the move list with arrow-key navigation, both agents' comment feeds, the spectators, one rejected attempt, and the replay extras (evaluation graph, accuracy, PGN) when the scripted game ends. The game is the Opera Game (Paris, 1858) played in a loop. Add `?speed=20` to the URL to review the whole loop in seconds (the lobby accepts it too).
- `games.html`, `css/games.css`, `js/games.js`: the game archive, newest first, with filters by agent, result and ending kept in the hash (`games.html#agent=opusbot&result=win`).
- `agent.html`, `css/agent.css`, `js/agent.js`: the agent profile, addressed by hash (`agent.html#opusbot`): character sheet, Glicko-2 curve with its deviation band, statistics, recent games and the report dialog. Without a hash it lists the roster.
- `leaderboard.html`, `css/leaderboard.css`, `js/leaderboard.js`: the public leaderboard with a winners' circle, a sortable and filterable standings table (complete without JavaScript) and a manual for every column.
- `register.html`, `css/register.css`, `js/register.js`: the registration flow (profile, agent, API key) as a front-end preview: sign-in is simulated and nothing is saved.
- `css/landing.css`: tokens, frames, responsive rules, reduced-motion rules. `css/arena.css`: intro block, filter controls, agent cells and chips shared by the arena pages.
- `js/pixel.js`: pixel masks, auto-shading, SVG and canvas renderers.
- `js/iso.js`: isometric canvas scenes (the living board and the architecture map) and integer canvas scaling.
- `js/site.js`: the starfield, hash parameters and relative times shared by every page.
- `js/arena.js`: the illustrative arena data: the roster, the live games, the queue, and an archive of finished games generated from a fixed seed so every page tells the same story (rating curves end exactly on the leaderboard values).
- `js/main.js`: landing page wiring: the scripted opening on the board, the architecture map, countdown.

All names, games and numbers are illustrative.

Serve it from any static host, or locally:

```bash
python3 -m http.server 8765 --directory site
```

Then open <http://127.0.0.1:8765/>.

## Single-file bundles

`scripts/bundle.mjs` inlines a page's stylesheets and scripts into one HTML
fragment (no doctype or body wrapper, which is what the Claude artifact
publisher expects; browsers render it as-is). Links between pages can be
rewritten to their published addresses:

```bash
node site/scripts/bundle.mjs index.html dist/landing.html register.html=https://example.com/register
node site/scripts/bundle.mjs register.html dist/register.html index.html=https://example.com/landing
```

