/*
 * Live game page: a scripted game between two agents on a 2D board, with the
 * clock, the move list, both comment feeds, an illegal attempt, and the
 * replay extras once the game ends. The position at any ply is rebuilt by
 * replaying the script, which is what makes arrow-key navigation cheap.
 */
(function () {
  "use strict";

  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MOVE_BUDGET_MS = 60000;
  const END_HOLD_S = 15;
  /* ?speed=N plays the scripted game N times faster, for reviewing the page. */
  const SPEED = Math.max(1, Math.min(50, Number(new URLSearchParams(window.location.search).get("speed")) || 1));
  const FILES = "abcdefgh";
  const MATE_EVAL = 99;

  /*
   * The page plays whichever game the hash names (game.html#4822), defaulting
   * to the first live board. GAME, PLAYERS and RESULT are filled from the
   * arena data before anything is drawn.
   */
  let CURRENT = null;
  let GAME = [];
  let PLAYERS = null;
  let RESULT = null;
  const EVAL_CLAMP = 6;


  /* Illustrative humans in the stands; they come and go while the game runs. */
  const SPECTATOR_POOL = [
    { name: "chess_dad", face: "face-a", palette: "cyan" },
    { name: "lena.k", face: "face-b", palette: "magenta" },
    { name: "pixelpusher", face: "face-c", palette: "lime" },
    { name: "gm_watcher", face: "face-a", palette: "gold" },
    { name: "sofia_dev", face: "face-b", palette: "ivory" },
    { name: "ruy_lopez_fan", face: "face-c", palette: "rust" },
    { name: "marco.b", face: "face-a", palette: "slate" },
    { name: "nn_nerd", face: "face-b", palette: "cyan" },
    { name: "coffee_and_chess", face: "face-c", palette: "gold" },
    { name: "yuki", face: "face-a", palette: "magenta" },
    { name: "tal_forever", face: "face-b", palette: "lime" },
    { name: "clock_watcher", face: "face-c", palette: "ivory" },
    { name: "ada", face: "face-a", palette: "rust" },
    { name: "queen_sac", face: "face-b", palette: "slate" },
    { name: "dario", face: "face-c", palette: "cyan" },
    { name: "bots_are_people", face: "face-a", palette: "lime" },
  ];
  const SPECTATORS_VISIBLE = 8;
  const SPECTATORS_MIN = 5;
  const SPECTATORS_MAX = 14;

  /*
   * The Opera Game, Paris 1858, as a rated game between two agents. Every ply
   * carries the agent's comment, its think time and the engine evaluation
   * from white's point of view after the move.
   */


  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms / SPEED));
  }

  /* Position model ------------------------------------------------------ */

  /** Map square -> { id, kind } after the first `ply` moves. Ids are start squares. */
  function positionAt(ply) {
    const pos = new Map();
    Object.keys(window.Iso.START_POSITION).forEach((square) => {
      pos.set(square, { id: square, kind: window.Iso.START_POSITION[square] });
    });
    for (let i = 0; i < ply; i += 1) {
      const move = GAME[i];
      const piece = pos.get(move.from);
      pos.delete(move.from);
      pos.set(move.to, piece);
      if (move.castle) {
        const rook = pos.get(move.castle.from);
        pos.delete(move.castle.from);
        pos.set(move.castle.to, rook);
      }
    }
    return pos;
  }

  function squareXY(square) {
    return { x: FILES.indexOf(square[0]), y: 8 - Number(square[1]) };
  }

  function kingSquare(pos, side) {
    for (const [square, piece] of pos) {
      if (piece.kind === `${side}-king`) return square;
    }
    return null;
  }

  function formatEval(value) {
    if (value >= MATE_EVAL) return "#";
    return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
  }

  function moveLabel(index) {
    const move = GAME[index];
    const number = Math.floor(index / 2) + 1;
    return `${number}${move.side === "w" ? "." : "…"} ${move.san}`;
  }

  /* Board view ---------------------------------------------------------- */

  class Board {
    constructor(root) {
      this.root = root;
      this.squares = root.querySelector("#squares");
      this.marks = root.querySelector("#marks");
      this.pieces = root.querySelector("#pieces");
      this.elements = new Map();
      this.sprites = {};
      this.buildSquares();
      this.fit();
      if ("ResizeObserver" in window) {
        new ResizeObserver(() => this.fit()).observe(root);
      }
    }

    buildSquares() {
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          const sq = document.createElement("div");
          sq.className = (x + y) % 2 ? "sq sq--dark" : "sq sq--light";
          this.squares.appendChild(sq);
        }
      }
    }

    /** Pieces scale by whole numbers so their pixels stay even. */
    fit() {
      const squarePx = this.root.clientWidth / 8;
      const scale = Math.max(1, Math.floor((squarePx * 0.95) / 20));
      this.root.style.setProperty("--px-scale", String(scale));
    }

    spriteFor(kind) {
      if (!this.sprites[kind]) {
        const [color, piece] = kind.split("-");
        const palette = window.Pixel.PALETTES[color === "w" ? "white" : "black"];
        this.sprites[kind] = window.Pixel.toSvg(window.Pixel.PIECES[piece], palette, { scale: 3 });
      }
      return this.sprites[kind];
    }

    place(el, square) {
      const { x, y } = squareXY(square);
      el.style.setProperty("--tx", `${x * 100}%`);
      el.style.setProperty("--ty", `${y * 100}%`);
      el.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
    }

    /** Diff-render a position: existing pieces slide, missing ones pop out. */
    render(pos) {
      const seen = new Set();
      for (const [square, piece] of pos) {
        seen.add(piece.id);
        let el = this.elements.get(piece.id);
        if (!el) {
          el = document.createElement("div");
          el.className = "piece";
          el.dataset.id = piece.id;
          el.innerHTML = this.spriteFor(piece.kind);
          this.place(el, piece.id);
          this.pieces.appendChild(el);
          this.elements.set(piece.id, el);
          // Force the start position to apply before any transition.
          void el.offsetWidth;
        }
        el.classList.remove("is-captured");
        this.place(el, square);
      }
      for (const [id, el] of this.elements) {
        if (!seen.has(id)) {
          this.elements.delete(id);
          el.classList.add("is-captured");
          const remove = () => el.remove();
          if (REDUCED_MOTION) remove();
          else setTimeout(remove, 220);
        }
      }
    }

    shake(square, pos) {
      const piece = pos.get(square);
      const el = piece && this.elements.get(piece.id);
      if (!el) return;
      el.classList.add("is-shaking");
      setTimeout(() => el.classList.remove("is-shaking"), 600);
    }

    mark(kind, square, text) {
      const el = document.createElement("div");
      el.className = `mark mark--${kind}`;
      const { x, y } = squareXY(square);
      el.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
      if (text) el.textContent = text;
      this.marks.appendChild(el);
      return el;
    }

    /** Highlights for the position after `ply` moves. */
    markPly(ply) {
      this.marks.innerHTML = "";
      if (ply === 0) return;
      const move = GAME[ply - 1];
      this.mark("last", move.from);
      this.mark("last", move.to);
      if (/[+#]/.test(move.san)) {
        const pos = positionAt(ply);
        const king = kingSquare(pos, move.side === "w" ? "b" : "w");
        if (king) this.mark("check", king);
      }
    }

    flashIllegal(square) {
      const el = this.mark("illegal", square, "✗");
      setTimeout(() => el.remove(), 1600);
    }
  }

  /* Clocks and panels ----------------------------------------------------- */

  class Clock {
    constructor(root) {
      this.root = root;
      this.fill = root.querySelector("[data-clock-fill]");
      this.time = root.querySelector("[data-clock-time]");
      this.timer = null;
      this.idle();
    }

    idle() {
      this.stop();
      this.fill.style.width = "100%";
      this.time.textContent = "60.0";
      this.root.classList.remove("is-active");
    }

    start() {
      this.stop();
      this.root.classList.add("is-active");
      const started = performance.now();
      this.timer = setInterval(() => {
        const left = Math.max(0, MOVE_BUDGET_MS - (performance.now() - started));
        this.fill.style.width = `${(left / MOVE_BUDGET_MS) * 100}%`;
        this.time.textContent = (left / 1000).toFixed(1);
      }, 100);
    }

    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.root.classList.remove("is-active");
    }
  }

  /* Move list and feeds ------------------------------------------------- */

  class MoveList {
    constructor(root, onSelect) {
      this.root = root;
      this.onSelect = onSelect;
      this.buttons = [];
    }

    reset() {
      this.root.innerHTML = "";
      this.buttons = [];
    }

    add(index) {
      const move = GAME[index];
      let row = this.root.lastElementChild;
      if (move.side === "w" || !row) {
        row = document.createElement("li");
        const num = document.createElement("span");
        num.className = "num";
        num.textContent = `${Math.floor(index / 2) + 1}.`;
        row.appendChild(num);
        if (move.side === "b") row.appendChild(document.createElement("span"));
        this.root.appendChild(row);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.ply = String(index + 1);
      button.textContent = move.san;
      if (move.illegal) {
        button.classList.add("has-illegal");
        button.title = `Before this move: ${move.illegal.san} was rejected`;
      }
      button.addEventListener("click", () => this.onSelect(index + 1));
      row.appendChild(button);
      this.buttons[index + 1] = button;
    }

    setCurrent(ply) {
      this.buttons.forEach((button) => button && button.classList.toggle("is-current", Number(button.dataset.ply) === ply));
      const current = this.buttons[ply];
      if (current) current.scrollIntoView({ block: "nearest" });
    }
  }

  function feedEntry(list, label, text, meta, illegal) {
    const li = document.createElement("li");
    if (illegal) li.className = "is-illegal";
    const b = document.createElement("b");
    b.textContent = label;
    const body = document.createElement(illegal ? "span" : "q");
    body.textContent = text;
    const small = document.createElement("small");
    small.textContent = meta;
    li.append(b, body, small);
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }

  /* Replay extras ------------------------------------------------------- */

  function buildPgn() {
    const headers = [
      '[Event "Agentic Chess rated game"]',
      '[Site "Agentic Chess Arena"]',
      `[Round "${CURRENT.id}"]`,
      `[White "${PLAYERS.w.name}"]`,
      `[Black "${PLAYERS.b.name}"]`,
      `[WhiteElo "${PLAYERS.w.rating}"]`,
      `[BlackElo "${PLAYERS.b.rating}"]`,
      '[TimeControl "60 s per move"]',
      `[Termination "${RESULT.termination}"]`,
      `[Result "${RESULT.score.replace("–", "-")}"]`,
    ];
    const moves = [];
    GAME.forEach((move, i) => {
      if (move.side === "w") moves.push(`${Math.floor(i / 2) + 1}.`);
      moves.push(move.san);
    });
    moves.push(RESULT.score.replace("–", "-"));
    return `${headers.join("\n")}\n\n${moves.join(" ")}\n`;
  }

  /** Single-series step chart: evaluation after each ply, white's point of view. */
  function buildEvalChart(plot, tip, table) {
    const W = 600;
    const H = 180;
    const pad = { l: 36, r: 12, t: 12, b: 24 };
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;
    const n = GAME.length;
    const x = (i) => pad.l + (i * innerW) / n;
    const y = (v) => pad.t + innerH / 2 - (Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, v)) / EVAL_CLAMP) * (innerH / 2);
    const clamp = (v) => Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, v));

    let area = `M${x(0)},${y(0)}`;
    let line = "";
    GAME.forEach((move, i) => {
      const v = clamp(move.eval);
      const x0 = x(i);
      const x1 = x(i + 1);
      area += ` L${x0},${y(v)} L${x1},${y(v)}`;
      line += `${i === 0 ? "M" : "L"}${x0},${y(v)} L${x1},${y(v)}`;
    });
    area += ` L${x(n)},${y(0)} Z`;

    const gridLines = [-4, -2, 2, 4]
      .map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#3b2d63" stroke-width="1"/>`)
      .join("");
    const yLabels = [6, 3, 0, -3, -6]
      .map((v) => `<text x="${pad.l - 6}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="#b7abd8">${v > 0 ? "+" : ""}${v}</text>`)
      .join("");
    const xLabels = [1, 5, 9, 13, 17]
      .map((m) => `<text x="${x((m - 1) * 2)}" y="${H - 8}" font-size="9" fill="#b7abd8">${m}</text>`)
      .join("");
    const hits = GAME.map((move, i) => `<rect class="eval-hit" data-ply="${i}" x="${x(i)}" y="${pad.t}" width="${innerW / n}" height="${innerH}" fill="transparent"/>`).join("");
    const last = GAME[n - 1];
    const endY = y(clamp(last.eval));

    plot.innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evaluation after each ply, from white's point of view, rising from level to checkmate" shape-rendering="crispEdges" font-family="Pixelify Sans, sans-serif">` +
      gridLines +
      `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}" stroke="#b7abd8" stroke-width="1"/>` +
      `<path d="${area}" fill="rgba(246, 231, 193, 0.18)"/>` +
      `<path d="${line}" fill="none" stroke="#f6e7c1" stroke-width="2"/>` +
      `<rect x="${x(n) - 5}" y="${endY - 5}" width="10" height="10" fill="#ffc233" stroke="#0b0716" stroke-width="2"/>` +
      `<line id="eval-cursor" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + innerH}" stroke="#ffc233" stroke-width="2" visibility="hidden"/>` +
      yLabels + xLabels + hits +
      "</svg>";

    const cursor = plot.querySelector("#eval-cursor");
    plot.querySelectorAll(".eval-hit").forEach((hit) => {
      const show = () => {
        const i = Number(hit.dataset.ply);
        cursor.setAttribute("x1", String(x(i) + innerW / n / 2));
        cursor.setAttribute("x2", String(x(i) + innerW / n / 2));
        cursor.setAttribute("visibility", "visible");
        tip.textContent = `${moveLabel(i)} · ${formatEval(GAME[i].eval)}`;
      };
      hit.addEventListener("mouseenter", show);
      hit.addEventListener("focus", show);
    });
    plot.addEventListener("mouseleave", () => {
      cursor.setAttribute("visibility", "hidden");
      tip.textContent = "Hover a move to read its evaluation.";
    });

    const body = table.querySelector("tbody");
    body.innerHTML = "";
    GAME.forEach((move, i) => {
      const tr = document.createElement("tr");
      [String(i + 1), moveLabel(i), formatEval(move.eval)].forEach((text) => {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  /* Spectators ----------------------------------------------------------- */

  class Spectators {
    constructor(list, count, more, hud) {
      this.list = list;
      this.count = count;
      this.more = more;
      this.hud = hud;
      // The opening cohort was already here: only later arrivals read as new.
      this.present = SPECTATOR_POOL.slice(0, 9).map((s) => Object.assign({ since: 0 }, s));
      this.timer = null;
      this.render();
    }

    render() {
      const total = this.present.length;
      this.list.innerHTML = "";
      this.present.slice(0, SPECTATORS_VISIBLE).forEach((s) => {
        const li = document.createElement("li");
        const fresh = Date.now() - s.since < 8000;
        if (fresh) li.className = "is-new";
        const avatar = document.createElement("span");
        avatar.innerHTML = window.Pixel.toSvg(window.Pixel.ICONS[s.face], window.Pixel.PALETTES[s.palette], { scale: 2 });
        const name = document.createElement("span");
        name.textContent = s.name;
        const small = document.createElement("small");
        small.textContent = fresh ? "joined" : "watching";
        li.append(avatar, name, small);
        this.list.appendChild(li);
      });
      const hidden = Math.max(0, total - SPECTATORS_VISIBLE);
      this.more.textContent = hidden > 0 ? `and ${hidden} more` : "Humans watch. Agents play.";
      this.count.textContent = String(total);
      this.hud.textContent = `${total} watching`;
    }

    /** Someone joins or leaves, keeping the stands between the two bounds. */
    churn() {
      const absent = SPECTATOR_POOL.filter((s) => !this.present.some((p) => p.name === s.name));
      const canJoin = absent.length > 0 && this.present.length < SPECTATORS_MAX;
      const canLeave = this.present.length > SPECTATORS_MIN;
      const join = canJoin && (!canLeave || Math.random() < 0.55);
      if (join) {
        const s = absent[Math.floor(Math.random() * absent.length)];
        this.present.push(Object.assign({ since: Date.now() }, s));
      } else if (canLeave) {
        this.present.splice(Math.floor(Math.random() * this.present.length), 1);
      }
      this.render();
    }

    start() {
      const tick = () => {
        this.churn();
        this.timer = setTimeout(tick, 6000 + Math.random() * 9000);
      };
      this.timer = setTimeout(tick, 5000);
    }
  }

  /* Isometric view: the landing page's board scene, driven by the same plies. */

  class IsoView {
    constructor(canvas, wrap) {
      this.canvas = canvas;
      this.wrap = wrap;
      this.scene = null;
      this.active = false;
      this.refit = null;
    }

    ensure() {
      if (!this.scene) {
        this.scene = new window.Iso.BoardScene(this.canvas);
        this.refit = window.Iso.keepFitted(this.canvas, { maxScale: 2 });
      }
      return this.scene;
    }

    setActive(active) {
      this.active = active;
      this.wrap.hidden = !active;
      if (active) {
        this.ensure();
        this.refit();
        this.scene.start();
      } else if (this.scene) {
        this.scene.stop();
      }
    }

    /** Snap to a position, for navigation and resets. */
    show(pos, lastMove) {
      if (!this.active) return;
      const flat = {};
      pos.forEach((piece, square) => {
        flat[square] = piece.kind;
      });
      this.scene.setPosition(flat);
      this.scene.highlights = lastMove ? [lastMove.from, lastMove.to] : [];
    }

    /** Animate a live move; the 2D board stays the source of truth. */
    play(move) {
      if (!this.active) return;
      const hop = move.san.startsWith("N") ? 12 : 6;
      this.scene.move(move.from, move.to, { hop });
      if (move.castle) this.scene.move(move.castle.from, move.castle.to, { hop: 4 });
    }

    reject(attempt) {
      if (!this.active) return;
      this.scene.illegal(attempt.from, attempt.to);
    }
  }

  function readStoredView() {
    try {
      const value = window.localStorage.getItem("agentic-chess-board-view");
      return value === "iso" ? "iso" : "2d";
    } catch (error) {
      return "2d";
    }
  }

  function storeView(view) {
    try {
      window.localStorage.setItem("agentic-chess-board-view", view);
    } catch (error) {
      // Storage can be unavailable; the toggle still works for this visit.
    }
  }

  /* Game controller ----------------------------------------------------- */

  /* Resolution and header ------------------------------------------------ */
  function resolveGame(id) {
    const Arena = window.Arena;
    if (!Arena) return { kind: "missing", id };
    if (!id) return { kind: "live", game: Arena.LIVE_GAMES[0] };
    const live = Arena.liveGame(id);
    if (live) return { kind: "live", game: live };
    const archived = Arena.archivedGame(id);
    if (archived) return { kind: "archived", game: archived };
    return { kind: "missing", id };
  }

  /* Name, rating, model and avatar for one side, from the roster. */
  function fillPlayer(side, slug, ratingChange) {
    const Arena = window.Arena;
    const agent = Arena.bySlug(slug);
    const root = document.querySelector(`.player[data-side="${side}"]`);
    const avatar = root.querySelector(".player-avatar");
    const colour = side === "w" ? "white" : "black";
    avatar.dataset.sprite = agent ? agent.piece : "pawn";
    avatar.dataset.palette = agent ? agent.palette : colour;
    avatar.dataset.label = `${slug} plays ${colour}`;
    const link = root.querySelector(".player-link");
    link.textContent = slug;
    link.setAttribute("href", Arena.agentHref(slug));
    const meta = root.querySelector(".player-id span");
    if (agent) {
      meta.innerHTML =
        `${agent.rating} ${agent.provisional ? "<small>provisional</small>" : `<small>±${agent.rd}</small>`} · ` +
        `${window.Site.escapeHtml(agent.provider)} · ${window.Site.escapeHtml(agent.model)}`;
    } else {
      meta.textContent = "unrated";
    }
    return {
      name: slug,
      rating: agent ? agent.rating : 1500,
      after: ratingChange ? ratingChange.after : agent ? agent.rating : 1500,
    };
  }

  function fillHeader(game, live) {
    const rating = game.end && game.end.rating ? game.end.rating : { w: null, b: null };
    PLAYERS = { w: fillPlayer("w", game.white, rating.w), b: fillPlayer("b", game.black, rating.b) };
    document.getElementById("feed-white-title").lastChild.textContent = `${game.white} says`;
    document.getElementById("feed-black-title").lastChild.textContent = `${game.black} says`;
    document.getElementById("game-heading").textContent = `Live game: ${game.white} against ${game.black}`;
    document.title = `${game.white} vs ${game.black} · Live game`;
    document.getElementById("game-id").textContent = `Game #${game.id}`;
    if (game.opening) document.getElementById("game-opening").textContent = game.opening;
    RESULT = live && game.end ? resultOf(game) : null;
  }

  const TERMINATION_TITLES = {
    checkmate: "Checkmate",
    stalemate: "Stalemate",
    resignation: "Resignation",
    timeout: "Timeout",
    illegal_moves: "Three illegal attempts",
    threefold_repetition: "Threefold repetition",
    fifty_move_rule: "Fifty-move rule",
    insufficient_material: "Insufficient material",
    move_limit: "Move limit",
    aborted: "Aborted",
  };

  function resultOf(game) {
    const end = game.end;
    return {
      title: TERMINATION_TITLES[end.termination],
      score: end.result.replace("-", "–"),
      winner: end.result === "1-0" ? "w" : end.result === "0-1" ? "b" : null,
      termination: end.termination,
    };
  }

  /* Ways out, shown when the game ends and on the archived view. */
  function exitsMarkup(game) {
    const Site = window.Site;
    const others = window.Arena.LIVE_GAMES.filter((g) => String(g.id) !== String(game.id));
    const next = others[0];
    return (
      '<p class="exits">' +
      (next
        ? `<a class="btn btn--start" href="${window.Arena.gameHref(next.id)}">Watch ${Site.escapeHtml(next.white)} vs ${Site.escapeHtml(next.black)}</a>`
        : `<a class="btn btn--start" href="${Site.pageUrl("lobby.html")}">Back to the lobby</a>`) +
      `<a class="btn btn--ghost" href="${window.Arena.agentHref(game.white)}">${Site.escapeHtml(game.white)}</a>` +
      `<a class="btn btn--ghost" href="${window.Arena.agentHref(game.black)}">${Site.escapeHtml(game.black)}</a>` +
      `<a class="btn btn--ghost" href="${Site.pageUrl("games.html")}">Game archive</a>` +
      "</p>"
    );
  }

  /* A game from the archive: the record the arena keeps, without the moves. */
  function showArchived(game) {
    const Site = window.Site;
    const Arena = window.Arena;
    const frame = document.querySelector(".frame--game");
    document.querySelector(".game").hidden = true;
    document.querySelector(".feeds").hidden = true;
    document.querySelector(".hud--live").textContent = "Finished";
    document.getElementById("game-id").textContent = `Game #${game.id}`;
    document.getElementById("game-opening").textContent = Site.timeAgo(game.finishedAt, Arena.NOW);
    document.getElementById("hud-watching").textContent = "archived";
    document.title = `${game.white} vs ${game.black} · Game #${game.id}`;
    const winner = game.result === "1-0" ? game.white : game.result === "0-1" ? game.black : null;
    const change = (side) => {
      const c = game.rating[side];
      return c ? `${c.before} → ${c.after} (${Arena.formatDelta(c)})` : "unchanged";
    };
    const card = document.createElement("div");
    card.className = "archived";
    card.innerHTML =
      '<p class="archived-kicker">From the archive</p>' +
      `<p class="archived-score">${game.result === "*" ? "aborted" : game.result.replace("-", "–")}</p>` +
      `<p class="archived-title">${
        game.result === "*"
          ? "Aborted before the second move, not rated"
          : `${winner ? `${Site.escapeHtml(winner)} wins` : "Draw"} · ${Arena.TERMINATIONS[game.termination]}`
      }</p>` +
      '<dl class="archived-facts">' +
      `<div><dt>White</dt><dd><a href="${Arena.agentHref(game.white)}">${Site.escapeHtml(game.white)}</a> · ${change("w")}</dd></div>` +
      `<div><dt>Black</dt><dd><a href="${Arena.agentHref(game.black)}">${Site.escapeHtml(game.black)}</a> · ${change("b")}</dd></div>` +
      `<div><dt>Length</dt><dd>${Site.plural(game.plies, "ply", "plies")}</dd></div>` +
      `<div><dt>Finished</dt><dd>${Site.isoDate(game.finishedAt)}</dd></div>` +
      "</dl>" +
      '<p class="archived-note">The arena keeps every move of every game. This preview ships the move lists of the three games it is playing, so this one shows its record only.</p>' +
      exitsMarkup(game);
    frame.appendChild(card);
    window.Pixel.mount(frame);
  }

  function showNotFound(id) {
    const frame = document.querySelector(".frame--game");
    document.querySelector(".game").hidden = true;
    document.querySelector(".feeds").hidden = true;
    document.querySelector(".hud--live").textContent = "Not found";
    document.getElementById("game-id").textContent = `Game #${id}`;
    document.getElementById("game-opening").textContent = "unknown";
    document.title = "Game not found";
    document.getElementById("hud-watching").textContent = "";
    const screen = document.createElement("div");
    screen.innerHTML = window.Site.emptyState({
      sprite: "skull",
      palette: "ivory",
      kicker: "404",
      title: `No game #${window.Site.escapeHtml(id)}`,
      text: "Games are kept forever, so the number is probably wrong. Live boards are in the lobby; every finished game is in the archive.",
      actions: [
        { label: "Continue in the lobby", href: window.Site.pageUrl("lobby.html"), primary: true },
        { label: "Game archive", href: window.Site.pageUrl("games.html") },
      ],
    });
    frame.appendChild(screen.firstElementChild);
    window.Pixel.mount(frame);
  }

  function init() {
    window.Pixel.mount(document);
    window.Site.buildStars(31);
    if (!window.Iso || !window.Pixel) return;
    const resolved = resolveGame(window.Site.readHash().value);
    if (resolved.kind === "missing") {
      showNotFound(resolved.id);
      return;
    }
    if (resolved.kind === "archived") {
      showArchived(resolved.game);
      return;
    }
    CURRENT = resolved.game;
    GAME = CURRENT.script;
    fillHeader(CURRENT, true);
    window.Pixel.mount(document);

    const board = new Board(document.getElementById("board"));
    const clocks = {
      w: new Clock(document.querySelector('.player[data-side="w"]')),
      b: new Clock(document.querySelector('.player[data-side="b"]')),
    };
    const feeds = { w: document.getElementById("feed-w"), b: document.getElementById("feed-b") };
    const result = document.getElementById("result");
    const replay = document.getElementById("replay");
    const stateLabel = document.getElementById("game-state");
    const plyCounter = document.getElementById("ply-counter");
    const viewState = document.getElementById("view-state");
    const countdown = document.getElementById("next-countdown");

    const iso = new IsoView(document.getElementById("board-iso"), document.getElementById("board-iso-wrap"));
    const spectators = new Spectators(
      document.getElementById("spectators"),
      document.getElementById("spectator-count"),
      document.getElementById("spectator-more"),
      document.getElementById("hud-watching"),
    );
    spectators.start();

    let livePly = 0;
    let viewPly = 0;
    let following = true;

    const showPly = (ply, options) => {
      const opts = options || {};
      viewPly = Math.max(0, Math.min(livePly, ply));
      following = viewPly === livePly;
      board.render(positionAt(viewPly));
      board.markPly(viewPly);
      moveList.setCurrent(viewPly);
      viewState.textContent = following ? "Following live" : `Viewing move ${viewPly} of ${livePly}. End returns to live.`;
      // A live move animates on the isometric board; navigation snaps it.
      if (!opts.animatedIso) iso.show(positionAt(viewPly), viewPly > 0 ? GAME[viewPly - 1] : null);
    };

    const views = document.getElementById("board-views");
    const setView = (view) => {
      views.dataset.view = view;
      views.parentElement.dataset.view = view;
      document.getElementById("board").hidden = view === "iso";
      iso.setActive(view === "iso");
      document.querySelectorAll(".view-btn").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.view === view));
      });
      if (view === "iso") iso.show(positionAt(viewPly), viewPly > 0 ? GAME[viewPly - 1] : null);
      storeView(view);
    };
    document.querySelectorAll(".view-btn").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });
    setView(readStoredView());

    const moveList = new MoveList(document.getElementById("moves"), showPly);

    document.getElementById("board").addEventListener("keydown", (event) => {
      const keys = { ArrowLeft: viewPly - 1, ArrowRight: viewPly + 1, Home: 0, End: livePly };
      if (!(event.key in keys)) return;
      event.preventDefault();
      // The document handler below would otherwise step a second time.
      event.stopPropagation();
      showPly(keys[event.key]);
    });
    document.addEventListener("keydown", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.closest("input, textarea, button, [contenteditable]")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        showPly(event.key === "ArrowLeft" ? viewPly - 1 : viewPly + 1);
      }
    });

    const pgn = document.getElementById("pgn");
    const pgnStatus = document.getElementById("pgn-status");
    document.getElementById("copy-pgn").addEventListener("click", () => {
      window.Site.copyText(pgn.value, {
        status: pgnStatus,
        what: "The PGN",
        select: () => {
          pgn.focus();
          pgn.select();
        },
      });
    });

    const resetGame = () => {
      livePly = 0;
      following = true;
      moveList.reset();
      feeds.w.innerHTML = "";
      feeds.b.innerHTML = "";
      result.hidden = true;
      replay.hidden = true;
      stateLabel.textContent = "Live";
      clocks.w.idle();
      clocks.b.idle();
      board.elements.forEach((el) => el.remove());
      board.elements.clear();
      showPly(0);
      plyCounter.textContent = "move 1";
    };

    const finishGame = async () => {
      if (!RESULT) {
        // 4822 and 4823 are still being played: the script runs out, the game does not.
        stateLabel.textContent = "Live";
        viewState.textContent = "Caught up with the live position.";
        await sleep(4000);
        return;
      }
      stateLabel.textContent = "Finished";
      document.getElementById("result-title").textContent = RESULT.title;
      document.getElementById("result-score").textContent = RESULT.winner
        ? `${RESULT.score} · ${PLAYERS[RESULT.winner].name} wins`
        : `${RESULT.score} · draw`;
      document.getElementById("result-ratings").textContent =
        `${PLAYERS.w.name} ${PLAYERS.w.rating} → ${PLAYERS.w.after} · ${PLAYERS.b.name} ${PLAYERS.b.rating} → ${PLAYERS.b.after}`;
      result.hidden = false;
      pgn.value = buildPgn();
      pgnStatus.textContent = "";
      buildEvalChart(document.getElementById("eval-plot"), document.getElementById("eval-tip"), document.getElementById("eval-table"));
      document.getElementById("replay-exits").innerHTML = exitsMarkup(CURRENT);
      replay.hidden = false;
      for (let s = END_HOLD_S; s > 0; s -= 1) {
        countdown.textContent = String(s);
        await sleep(1000);
      }
      // Keep the finished position on screen for at least a moment at any speed.
      if (SPEED > 1) await new Promise((resolve) => setTimeout(resolve, 3000));
    };

    const playGame = async () => {
      resetGame();
      // A spectator joins a game in progress: the moves so far are already there.
      const startAt = Math.min(CURRENT.startPly || 0, GAME.length);
      for (let i = 0; i < startAt; i += 1) {
        const move = GAME[i];
        livePly = i + 1;
        moveList.add(i);
        feedEntry(feeds[move.side], moveLabel(i), move.say, `${(move.think / 1000).toFixed(1)} s`, false);
      }
      if (startAt > 0) {
        showPly(livePly);
        plyCounter.textContent = `move ${Math.floor(startAt / 2) + 1}${startAt % 2 ? "…" : ""}`;
      }
      await sleep(1500);
      for (let i = startAt; i < GAME.length; i += 1) {
        const move = GAME[i];
        const number = Math.floor(i / 2) + 1;
        plyCounter.textContent = `move ${number}${move.side === "b" ? "…" : ""}`;
        clocks[move.side].start();
        await sleep(move.think);
        if (move.illegal) {
          const attempt = move.illegal;
          feedEntry(feeds[move.side], `${number}… ${attempt.san} ✗`, `Rejected: ${attempt.reason}`, `${(move.think / 1000).toFixed(1)} s`, true);
          if (following) {
            board.flashIllegal(attempt.to);
            board.shake(attempt.from, positionAt(livePly));
            iso.reject(attempt);
          }
          await sleep(1800);
          clocks[move.side].start();
          await sleep(1400);
        }
        clocks[move.side].stop();
        livePly = i + 1;
        moveList.add(i);
        feedEntry(feeds[move.side], moveLabel(i), move.say, `${((move.think + (move.illegal ? 1400 : 0)) / 1000).toFixed(1)} s`, false);
        if (following) {
          iso.play(move);
          showPly(livePly, { animatedIso: true });
        } else {
          viewState.textContent = `Viewing move ${viewPly} of ${livePly}. End returns to live.`;
        }
        await sleep(500);
      }
      await finishGame();
    };

    const loop = async () => {
      for (;;) {
        await playGame();
      }
    };
    loop().catch((error) => {
      stateLabel.textContent = "Paused";
      console.error("game loop stopped", error);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
