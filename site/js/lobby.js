/*
 * Lobby: the live boards keep moving from their scripted continuations, the
 * queue timers count up and widen their rating windows, everything else is
 * rendered once from the shared arena data.
 */
(function () {
  "use strict";

  const Site = window.Site;
  const Arena = window.Arena;
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SPEED = Math.max(1, Math.min(50, Number(new URLSearchParams(window.location.search).get("speed")) || 1));
  const MOVE_BUDGET_S = 60;
  const SQUARE = 16;
  const TOP_MARGIN = 6;
  const END_HOLD_MS = 15000;
  const FILES = "abcdefgh";
  const PIECE_LETTERS = { p: "pawn", r: "rook", n: "knight", b: "bishop", q: "queen", k: "king" };

  function agentOf(slug) {
    return Arena.bySlug(slug);
  }

  /* Mini boards --------------------------------------------------------- */

  function parsePlacement(fen) {
    const position = new Map();
    fen.split("/").forEach((rank, rowIndex) => {
      let col = 0;
      [...rank].forEach((ch) => {
        if (/\d/.test(ch)) {
          col += Number(ch);
          return;
        }
        const square = `${FILES[col]}${8 - rowIndex}`;
        position.set(square, { kind: PIECE_LETTERS[ch.toLowerCase()], color: ch === ch.toUpperCase() ? "w" : "b" });
        col += 1;
      });
    });
    return position;
  }

  const spriteCache = new Map();
  function sprite(kind, color) {
    const key = `${kind}-${color}`;
    if (!spriteCache.has(key)) {
      const Pixel = window.Pixel;
      spriteCache.set(key, Pixel.toCanvas(Pixel.PIECES[kind], Pixel.PALETTES[color === "w" ? "white" : "black"]));
    }
    return spriteCache.get(key);
  }

  function squareXY(square) {
    return { col: FILES.indexOf(square[0]), row: 8 - Number(square[1]) };
  }

  function drawMini(canvas, position, lastMove) {
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        ctx.fillStyle = (row + col) % 2 ? "#b4552b" : "#f6e7c1";
        ctx.fillRect(col * SQUARE, TOP_MARGIN + row * SQUARE, SQUARE, SQUARE);
      }
    }
    if (lastMove) {
      ctx.fillStyle = "rgba(255, 194, 51, 0.55)";
      lastMove.forEach((square) => {
        const { col, row } = squareXY(square);
        ctx.fillRect(col * SQUARE, TOP_MARGIN + row * SQUARE, SQUARE, SQUARE);
      });
    }
    // Draw rank 8 first so lower pieces overlap the ones behind them.
    [...position.entries()]
      .sort((a, b) => squareXY(a[0]).row - squareXY(b[0]).row)
      .forEach(([square, piece]) => {
        const { col, row } = squareXY(square);
        const image = sprite(piece.kind, piece.color);
        ctx.drawImage(image, col * SQUARE + Math.floor((SQUARE - image.width) / 2), TOP_MARGIN + row * SQUARE + SQUARE - image.height - 1);
      });
  }

  /* A live board: scripted continuation, clock per move, then a loop. */
  class LiveBoard {
    constructor(game, root) {
      this.game = game;
      this.root = root;
      this.canvas = root.querySelector(".mini");
      this.plyNode = root.querySelector(".board-ply");
      this.watchNode = root.querySelector(".board-watching");
      this.resultNode = root.querySelector(".board-result");
      this.sides = {
        w: root.querySelector(".board-side--w"),
        b: root.querySelector(".board-side--b"),
      };
      this.watching = game.watching;
      this.reset(game.turnElapsed);
    }

    reset(elapsed) {
      this.position = parsePlacement(this.game.fen);
      this.ply = this.game.ply;
      this.queue = this.game.next.slice();
      this.lastMove = null;
      this.elapsed = elapsed || 0;
      this.holdUntil = 0;
      this.nextThink = this.pickThink();
      this.resultNode.hidden = true;
      this.render();
    }

    pickThink() {
      const mover = agentOf(this.toMove() === "w" ? this.game.white : this.game.black);
      const base = mover ? mover.think : 6;
      return Math.min(MOVE_BUDGET_S - 2, Math.max(3, base * (0.6 + Math.random() * 1.6)));
    }

    toMove() {
      return this.ply % 2 === 0 ? "w" : "b";
    }

    applyMove(move) {
      const [from, to, rookFrom, rookTo] = move;
      const piece = this.position.get(from);
      if (!piece) return;
      this.position.delete(from);
      this.position.set(to, piece);
      if (rookFrom) {
        const rook = this.position.get(rookFrom);
        this.position.delete(rookFrom);
        if (rook) this.position.set(rookTo, rook);
      }
      this.lastMove = [from, to];
      this.ply += 1;
    }

    tick(dt) {
      const now = performance.now();
      if (this.holdUntil) {
        if (now >= this.holdUntil) this.reset(0);
        return;
      }
      this.elapsed += dt;
      if (this.elapsed >= this.nextThink) {
        if (this.queue.length) {
          this.applyMove(this.queue.shift());
          this.elapsed = 0;
          this.nextThink = this.pickThink();
          if (Math.random() < 0.25) this.watching = Math.max(1, this.watching + (Math.random() < 0.6 ? 1 : -1));
          if (!this.queue.length && this.game.end) this.finish();
          else if (!this.queue.length) this.holdUntil = now + END_HOLD_MS / SPEED;
        }
      }
      this.render();
    }

    finish() {
      const end = this.game.end;
      const winner = end.result === "1-0" ? this.game.white : end.result === "0-1" ? this.game.black : null;
      this.resultNode.textContent = `${end.result} · ${Arena.TERMINATIONS[end.termination]}${winner ? ` · ${winner} wins` : ""}`;
      this.resultNode.hidden = false;
      this.holdUntil = performance.now() + END_HOLD_MS / SPEED;
    }

    render() {
      drawMini(this.canvas, this.position, this.lastMove);
      const moveNumber = Math.floor(this.ply / 2) + 1;
      const side = this.toMove();
      this.plyNode.textContent = this.holdUntil && this.game.end ? "finished" : `move ${moveNumber}, ${side === "w" ? "white" : "black"} to play`;
      this.watchNode.textContent = Site.plural(this.watching, "watcher");
      ["w", "b"].forEach((color) => {
        const node = this.sides[color];
        const active = color === side && !this.holdUntil;
        node.classList.toggle("is-active", active);
        const remaining = active ? Math.max(0, MOVE_BUDGET_S - this.elapsed) : MOVE_BUDGET_S;
        node.querySelector(".clock-mini-fill").style.width = `${(remaining / MOVE_BUDGET_S) * 100}%`;
        node.querySelector(".clock-mini-time").textContent = remaining.toFixed(1);
      });
    }
  }

  function sideMarkup(game, color) {
    const agent = agentOf(color === "w" ? game.white : game.black);
    const rating = `${agent.rating} ${agent.provisional ? "provisional" : `±${agent.rd}`}`;
    return (
      `<div class="board-side board-side--${color}">` +
      Arena.agentCell(agent, { scale: 1, extra: `${color === "w" ? "White" : "Black"} · ${rating}` }) +
      `<span class="clock-mini" role="timer" aria-label="${color === "w" ? "White" : "Black"} clock"><span class="clock-mini-bar"><span class="clock-mini-fill"></span></span><span class="clock-mini-time">60.0</span></span>` +
      "</div>"
    );
  }

  function renderBoards() {
    const host = document.getElementById("boards");
    const boards = [];
    host.innerHTML = Arena.LIVE_GAMES.map(
      (game) =>
        `<li class="board-card" data-id="${game.id}">` +
        `<span class="board-id"><span>Game #${game.id}</span><span class="chip chip--live">live</span></span>` +
        `<a class="board-link" href="${Arena.gameHref()}" aria-label="Watch game ${game.id}, ${game.white} against ${game.black}"><canvas class="mini" width="128" height="134" role="img" aria-label="Current position"></canvas></a>` +
        sideMarkup(game, "b") +
        sideMarkup(game, "w") +
        `<p class="board-result" hidden></p>` +
        `<p class="board-foot"><span data-sprite="eye" data-palette="cyan" data-scale="1"></span><span><span class="board-watching"></span> · <span class="board-ply"></span> · started ${Site.timeAgo(Arena.NOW - game.startedAgo, Arena.NOW)}</span></p>` +
        `<a class="btn btn--start" href="${Arena.gameHref()}">Watch</a>` +
        "</li>",
    ).join("");
    window.Pixel.mount(host);
    host.querySelectorAll(".board-card").forEach((card) => {
      const game = Arena.LIVE_GAMES.find((g) => g.id === Number(card.dataset.id));
      boards.push(new LiveBoard(game, card));
    });
    document.getElementById("live-count").textContent = String(boards.length);
    if (REDUCED_MOTION) return;
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      const dt = ((now - last) / 1000) * SPEED;
      last = now;
      boards.forEach((board) => board.tick(dt));
    }, 250);
  }

  /* Latest results ------------------------------------------------------- */

  function renderResults() {
    const host = document.getElementById("results");
    host.innerHTML = Arena.GAMES.slice(0, 8)
      .map((game) => {
        const white = agentOf(game.white);
        const black = agentOf(game.black);
        const winner = game.result === "1-0" ? "w" : game.result === "0-1" ? "b" : null;
        const cell = (agent, color) =>
          Arena.agentCell(agent, { scale: 1 }).replace('class="agent-cell agent-link"', `class="agent-cell agent-link${winner === color ? " is-winner" : ""}"`);
        const how = game.result === "*" ? "Aborted before the second move" : `${Arena.TERMINATIONS[game.termination]} · ${Site.plural(game.plies, "ply", "plies")}`;
        return (
          "<li>" +
          `<time class="result-when" datetime="${new Date(game.finishedAt).toISOString()}" title="${Site.isoDate(game.finishedAt)}">${Site.timeAgo(game.finishedAt, Arena.NOW)}</time>` +
          `<span class="result-pair">${cell(white, "w")}<span class="vs">–</span>${cell(black, "b")}</span>` +
          `<span class="result-score">${game.result === "*" ? "aborted" : game.result}</span>` +
          `<span class="result-how">#${game.id} · ${how} · <a href="${Arena.gameHref()}">Replay</a></span>` +
          "</li>"
        );
      })
      .join("");
    window.Pixel.mount(host);
  }

  /* Top ten -------------------------------------------------------------- */

  function renderTop() {
    const body = document.querySelector("#top10 tbody");
    body.innerHTML = Arena.AGENTS.filter((a) => !a.provisional)
      .slice(0, 10)
      .map(
        (agent) =>
          `<tr${agent.flag ? ' class="is-flagged"' : ""}>` +
          `<td>${ordinal(agent.rank)}</td>` +
          `<td>${Arena.agentCell(agent, { scale: 1 })}${agent.flag ? '<span class="chip chip--review">under review</span>' : ""}</td>` +
          `<td>${agent.rating}</td>` +
          `<td>${agent.wins}-${agent.draws}-${agent.losses}</td>` +
          "</tr>",
      )
      .join("");
    window.Pixel.mount(body);
  }

  function ordinal(n) {
    const suffix = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
    return `${n}${suffix}`;
  }

  /* Waiting room --------------------------------------------------------- */

  function renderRooms() {
    const presence = Arena.presence();
    const lists = {
      queued: document.getElementById("queue"),
      playing: document.getElementById("playing"),
      online: document.getElementById("idle"),
      offline: document.getElementById("offline"),
    };
    const detail = (entry) => {
      if (entry.state === "playing") return `<small>game <a href="${Arena.gameHref()}">#${entry.gameId}</a></small>`;
      if (entry.state === "queued") {
        const note = entry.queue.note ? ` · ${Site.escapeHtml(entry.queue.note)}` : "";
        return `<small><span class="queue-wait" data-queued="${entry.queue.queuedAgo}"></span> · window <span class="queue-window"></span>${note}</small>`;
      }
      if (entry.state === "online") return "<small>stream open, not in queue</small>";
      return "";
    };
    Object.keys(lists).forEach((state) => {
      lists[state].innerHTML = presence
        .filter((entry) => entry.state === state)
        .map((entry) => `<li>${Arena.agentCell(entry.agent, { scale: 1, extra: `${entry.agent.rating}${entry.agent.provisional ? " provisional" : ""}` })}${detail(entry)}</li>`)
        .join("");
      window.Pixel.mount(lists[state]);
    });
    const queued = presence.filter((e) => e.state === "queued").length;
    document.getElementById("queue-count").textContent = String(queued);
    document.getElementById("pulse-live").textContent = String(Arena.LIVE_GAMES.length);
    document.getElementById("pulse-online").textContent = String(presence.filter((e) => e.state !== "offline").length);
    document.getElementById("pulse-queue").textContent = String(queued);
    const dayAgo = Arena.NOW - 24 * 60 * 60000;
    document.getElementById("pulse-day").textContent = String(Arena.GAMES.filter((g) => g.finishedAt >= dayAgo).length + Arena.LIVE_GAMES.length);

    const start = performance.now();
    const tickQueue = () => {
      const elapsed = (performance.now() - start) * SPEED;
      document.querySelectorAll(".queue-wait").forEach((node) => {
        const waited = Number(node.dataset.queued) + elapsed;
        node.textContent = `waiting ${Math.floor(waited / 1000)} s`;
        node.parentElement.querySelector(".queue-window").textContent = `±${Arena.ratingWindow(waited)}`;
      });
    };
    tickQueue();
    if (!REDUCED_MOTION) setInterval(tickQueue, 1000);
  }

  function init() {
    window.Pixel.mount(document);
    Site.buildStars(43);
    renderBoards();
    renderResults();
    renderTop();
    renderRooms();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
