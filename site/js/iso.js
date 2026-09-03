/*
 * Isometric canvas scenes.
 *
 * Both scenes render at a tiny internal resolution and are scaled up by CSS
 * with `image-rendering: pixelated`, so one canvas pixel is one chunky
 * on-screen pixel. Tiles are 32x16 diamonds (the classic 2:1 ratio), drawn
 * scanline by scanline so their edges stay crisp.
 */
(function () {
  "use strict";

  const TILE_W = 32;
  const TILE_H = 16;
  const FILES = "abcdefgh";

  const BOARD = {
    light: "#f6e7c1",
    dark: "#b4552b",
    lightEdge: "#d9c79a",
    darkEdge: "#8a3f1d",
    sideLeft: "#4a3a72",
    sideRight: "#33264f",
    sideTop: "#7d63b4",
    sideBottom: "#1c1533",
    shadow: "rgba(6, 3, 20, 0.55)",
    highlight: "rgba(255, 194, 51, 0.55)",
    danger: "#ff4444",
    dangerDim: "rgba(255, 68, 68, 0.45)",
  };

  /** Top vertex of the diamond for tile (col, row). */
  function project(origin, col, row) {
    return {
      x: origin.x + ((col - row) * TILE_W) / 2,
      y: origin.y + ((col + row) * TILE_H) / 2,
    };
  }

  /** Width of half a diamond row for a diamond `height` px tall. */
  function halfWidth(r, height) {
    const half = height / 2;
    return r < half ? (r + 1) * 2 : (height - r) * 2;
  }

  /** A diamond `height` tall (and twice as wide) with its top vertex at (x, y). */
  function fillDiamond(ctx, x, y, height, color) {
    ctx.fillStyle = color;
    for (let r = 0; r < height; r += 1) {
      const hw = halfWidth(r, height);
      ctx.fillRect(x - hw, y + r, hw * 2, 1);
    }
  }

  /** A diamond extruded `depth` px downwards, with separate left/right faces. */
  function fillPrism(ctx, x, y, height, depth, colors) {
    const half = height / 2;
    for (let r = 0; r < height; r += 1) {
      const hw = halfWidth(r, height);
      if (r >= half) {
        ctx.fillStyle = colors.left;
        ctx.fillRect(x - hw, y + r, hw, depth);
        ctx.fillStyle = colors.right;
        ctx.fillRect(x, y + r, hw, depth);
      }
    }
    fillDiamond(ctx, x, y, height, colors.top);
    if (colors.rim) {
      ctx.fillStyle = colors.rim;
      for (let r = half; r < height; r += 1) {
        const hw = halfWidth(r, height);
        ctx.fillRect(x - hw, y + r + depth - 1, hw * 2, 1);
      }
    }
  }

  function squareToCell(square) {
    const col = FILES.indexOf(square[0]);
    const rank = Number(square[1]) - 1;
    return { col, row: 7 - rank };
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function now() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  /** Deterministic pseudo-random for stable textures between frames. */
  function seeded(seed) {
    let s = seed >>> 0;
    return function next() {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ */
  /* Chess board island                                                   */
  /* ------------------------------------------------------------------ */

  const START_POSITION = {
    a1: "w-rook",
    b1: "w-knight",
    c1: "w-bishop",
    d1: "w-queen",
    e1: "w-king",
    f1: "w-bishop",
    g1: "w-knight",
    h1: "w-rook",
    a2: "w-pawn",
    b2: "w-pawn",
    c2: "w-pawn",
    d2: "w-pawn",
    e2: "w-pawn",
    f2: "w-pawn",
    g2: "w-pawn",
    h2: "w-pawn",
    a7: "b-pawn",
    b7: "b-pawn",
    c7: "b-pawn",
    d7: "b-pawn",
    e7: "b-pawn",
    f7: "b-pawn",
    g7: "b-pawn",
    h7: "b-pawn",
    a8: "b-rook",
    b8: "b-knight",
    c8: "b-bishop",
    d8: "b-queen",
    e8: "b-king",
    f8: "b-bishop",
    g8: "b-knight",
    h8: "b-rook",
  };

  class BoardScene {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.width = canvas.width;
      this.height = canvas.height;
      this.origin = { x: Math.floor(this.width / 2), y: 26 };
      this.depth = 22;
      this.sprites = this.buildSprites();
      this.pieces = [];
      this.effects = [];
      this.highlights = [];
      this.animating = false;
      this.running = false;
      this.lastFrame = 0;
      this.frame = this.frame.bind(this);
      this.setPosition(START_POSITION);
    }

    buildSprites() {
      const sprites = {};
      const kinds = Object.keys(window.Pixel.PIECES);
      kinds.forEach((kind) => {
        sprites[`w-${kind}`] = window.Pixel.toCanvas(window.Pixel.PIECES[kind], window.Pixel.PALETTES.white);
        sprites[`b-${kind}`] = window.Pixel.toCanvas(window.Pixel.PIECES[kind], window.Pixel.PALETTES.black);
      });
      return sprites;
    }

    setPosition(position) {
      this.pieces = Object.keys(position).map((square) => {
        const cell = squareToCell(square);
        return { square, kind: position[square], col: cell.col, row: cell.row, anim: null, alpha: 1 };
      });
      this.highlights = [];
      this.effects = [];
      this.draw();
    }

    reset() {
      this.setPosition(START_POSITION);
    }

    pieceAt(square) {
      return this.pieces.find((p) => p.square === square) || null;
    }

    start() {
      if (this.running) return;
      this.running = true;
      requestAnimationFrame(this.frame);
    }

    stop() {
      this.running = false;
    }

    frame(time) {
      if (!this.running) return;
      if (time - this.lastFrame >= 33) {
        this.lastFrame = time;
        this.draw(time);
      }
      requestAnimationFrame(this.frame);
    }

    /** Slide a piece from one square to another, optionally capturing. */
    move(from, to, options) {
      const opts = options || {};
      const piece = this.pieceAt(from);
      if (!piece) return Promise.resolve();
      const target = squareToCell(to);
      const captured = this.pieceAt(to);
      const duration = opts.duration || 620;
      const hop = opts.hop === undefined ? 6 : opts.hop;
      this.highlights = [from, to];
      return new Promise((resolve) => {
        piece.anim = {
          fromCol: piece.col,
          fromRow: piece.row,
          toCol: target.col,
          toRow: target.row,
          start: now(),
          duration,
          hop,
          onDone: () => {
            piece.col = target.col;
            piece.row = target.row;
            piece.square = to;
            piece.anim = null;
            if (captured) {
              this.pieces = this.pieces.filter((p) => p !== captured);
              this.burst(target.col, target.row, "#ffc233");
            }
            resolve();
          },
        };
      });
    }

    /** Nudge a piece toward a square it cannot reach, then snap it back. */
    illegal(from, to) {
      const piece = this.pieceAt(from);
      if (!piece) return Promise.resolve();
      const target = squareToCell(to);
      const duration = 700;
      this.highlights = [from];
      this.effects.push({ type: "cross", col: target.col, row: target.row, start: now(), duration: 1400 });
      return new Promise((resolve) => {
        piece.anim = {
          fromCol: piece.col,
          fromRow: piece.row,
          toCol: piece.col + (target.col - piece.col) * 0.25,
          toRow: piece.row + (target.row - piece.row) * 0.25,
          start: now(),
          duration,
          hop: 3,
          bounce: true,
          onDone: () => {
            piece.anim = null;
            resolve();
          },
        };
      });
    }

    burst(col, row, color) {
      const rand = seeded(col * 31 + row * 17 + 7);
      for (let i = 0; i < 10; i += 1) {
        this.effects.push({
          type: "spark",
          col,
          row,
          dx: (rand() - 0.5) * 30,
          dy: -6 - rand() * 18,
          start: now(),
          duration: 520,
          color,
        });
      }
    }

    clearHighlights() {
      this.highlights = [];
    }

    /* Drawing ---------------------------------------------------------- */

    draw(time) {
      const t = time || now();
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);
      this.drawIsland();
      this.drawTiles();
      this.drawHighlights(t);
      this.drawPieces(t);
      this.drawEffects(t);
    }

    drawIsland() {
      const ctx = this.ctx;
      const { x, y } = this.origin;
      const boardHeight = TILE_H * 8;
      fillDiamond(ctx, x, y + this.depth + 10, boardHeight, BOARD.shadow);
      fillPrism(ctx, x, y, boardHeight, this.depth, {
        left: BOARD.sideLeft,
        right: BOARD.sideRight,
        top: BOARD.light,
        rim: BOARD.sideBottom,
      });
      // grassy rim just under the board edge
      ctx.fillStyle = BOARD.sideTop;
      for (let r = boardHeight / 2; r < boardHeight; r += 1) {
        const hw = halfWidth(r, boardHeight);
        ctx.fillRect(x - hw, y + r + 1, hw * 2, 1);
      }
      // rock texture
      const rand = seeded(42);
      for (let i = 0; i < 40; i += 1) {
        const r = Math.floor(boardHeight / 2 + rand() * (boardHeight / 2));
        const hw = halfWidth(r, boardHeight);
        const px = Math.floor(x - hw + rand() * hw * 2);
        const py = y + r + 4 + Math.floor(rand() * (this.depth - 6));
        ctx.fillStyle = px < x ? BOARD.sideBottom : BOARD.sideLeft;
        ctx.fillRect(px, py, 2, 1);
      }
    }

    drawTiles() {
      const ctx = this.ctx;
      for (let row = 0; row < 8; row += 1) {
        for (let col = 0; col < 8; col += 1) {
          const { x, y } = project(this.origin, col, row);
          const dark = (col + row) % 2 === 1;
          fillDiamond(ctx, x, y, TILE_H, dark ? BOARD.dark : BOARD.light);
          // bottom edges one shade darker so the grid reads as separate tiles
          ctx.fillStyle = dark ? BOARD.darkEdge : BOARD.lightEdge;
          for (let r = TILE_H / 2; r < TILE_H; r += 1) {
            const hw = halfWidth(r, TILE_H);
            ctx.fillRect(x - hw, y + r, 2, 1);
            ctx.fillRect(x + hw - 2, y + r, 2, 1);
          }
        }
      }
    }

    drawHighlights(t) {
      const ctx = this.ctx;
      const pulse = 0.35 + 0.25 * Math.sin(t / 220);
      this.highlights.forEach((square) => {
        const cell = squareToCell(square);
        const { x, y } = project(this.origin, cell.col, cell.row);
        fillDiamond(ctx, x, y, TILE_H, `rgba(255, 194, 51, ${pulse.toFixed(3)})`);
      });
    }

    piecePosition(piece, t) {
      if (!piece.anim) {
        return { col: piece.col, row: piece.row, lift: 0 };
      }
      const a = piece.anim;
      const raw = Math.min(1, (t - a.start) / a.duration);
      let progress;
      let lift;
      if (a.bounce) {
        // out and back: 0 -> 1 -> 0
        progress = raw < 0.5 ? easeOutCubic(raw * 2) : easeOutCubic((1 - raw) * 2);
        lift = Math.sin(raw * Math.PI) * a.hop;
      } else {
        progress = easeOutCubic(raw);
        lift = Math.sin(raw * Math.PI) * a.hop;
      }
      if (raw >= 1) {
        const done = a.onDone;
        piece.anim = null;
        done();
        return { col: piece.col, row: piece.row, lift: 0 };
      }
      return {
        col: a.fromCol + (a.toCol - a.fromCol) * progress,
        row: a.fromRow + (a.toRow - a.fromRow) * progress,
        lift,
      };
    }

    drawPieces(t) {
      const ctx = this.ctx;
      const placed = this.pieces.map((piece) => ({ piece, pos: this.piecePosition(piece, t) }));
      placed.sort((a, b) => a.pos.col + a.pos.row - (b.pos.col + b.pos.row) || a.pos.row - b.pos.row);
      placed.forEach(({ piece, pos }) => {
        const sprite = this.sprites[piece.kind];
        const { x, y } = project(this.origin, pos.col, pos.row);
        const baseX = Math.round(x);
        const baseY = Math.round(y) + TILE_H / 2 + 4;
        // ground shadow
        fillDiamond(ctx, baseX, baseY - 5, 6, "rgba(6, 3, 20, 0.35)");
        ctx.drawImage(sprite, baseX - Math.floor(sprite.width / 2), baseY - sprite.height - Math.round(pos.lift));
      });
    }

    drawEffects(t) {
      const ctx = this.ctx;
      this.effects = this.effects.filter((fx) => t - fx.start < fx.duration);
      this.effects.forEach((fx) => {
        const progress = (t - fx.start) / fx.duration;
        const { x, y } = project(this.origin, fx.col, fx.row);
        if (fx.type === "cross") {
          const blink = Math.floor(progress * 8) % 2 === 0;
          fillDiamond(ctx, x, y, TILE_H, BOARD.dangerDim);
          if (blink) {
            ctx.fillStyle = BOARD.danger;
            const cx = x;
            const cy = y - 6;
            for (let i = -5; i <= 5; i += 1) {
              ctx.fillRect(cx + i - 1, cy + i, 2, 2);
              ctx.fillRect(cx - i - 1, cy + i, 2, 2);
            }
          }
        } else if (fx.type === "spark") {
          const px = Math.round(x + fx.dx * progress);
          const py = Math.round(y + TILE_H / 2 - 8 + fx.dy * progress + 24 * progress * progress);
          ctx.fillStyle = fx.color;
          ctx.fillRect(px, py, 2, 2);
        }
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Architecture city                                                    */
  /* ------------------------------------------------------------------ */

  const CITY = {
    ground: "#3b2d63",
    groundAlt: "#33265a",
    groundEdge: "#2a1e4b",
    side: "#1c1533",
    link: "#5ff2ff",
    linkDim: "#2bb7c9",
    labelBg: "#0b0716",
    labelFg: "#f6e7c1",
  };

  class CityScene {
    constructor(canvas, buildings, links) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.width = canvas.width;
      this.height = canvas.height;
      this.size = 9;
      this.origin = { x: Math.floor(this.width / 2), y: 60 };
      this.buildings = buildings;
      this.links = links;
      this.draw = this.draw.bind(this);
    }

    center(b) {
      // centre of a footprint's top face at ground level
      const p = project(this.origin, b.col + b.w / 2, b.row + b.d / 2);
      return { x: p.x, y: p.y };
    }

    draw() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);
      const { x, y } = this.origin;
      const groundHeight = TILE_H * this.size;
      fillDiamond(ctx, x, y + 14 + 8, groundHeight, "rgba(6, 3, 20, 0.5)");
      fillPrism(ctx, x, y, groundHeight, 14, {
        left: "#2f2452",
        right: "#221a3d",
        top: CITY.ground,
        rim: CITY.side,
      });
      for (let row = 0; row < this.size; row += 1) {
        for (let col = 0; col < this.size; col += 1) {
          const p = project(this.origin, col, row);
          fillDiamond(ctx, p.x, p.y, TILE_H, (col + row) % 2 ? CITY.groundAlt : CITY.ground);
        }
      }
      this.drawLinks();
      const ordered = this.buildings.slice().sort((a, b) => a.col + a.row + a.w + a.d - (b.col + b.row + b.w + b.d));
      ordered.forEach((b) => this.drawBuilding(b));
      ordered.forEach((b) => this.drawLabel(b));
    }

    drawLinks() {
      const ctx = this.ctx;
      const byName = {};
      this.buildings.forEach((b) => {
        byName[b.name] = b;
      });
      this.links.forEach(([from, to]) => {
        const a = this.center(byName[from]);
        const b = this.center(byName[to]);
        const steps = Math.max(2, Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 5));
        for (let i = 1; i < steps; i += 1) {
          const px = Math.round(a.x + ((b.x - a.x) * i) / steps);
          const py = Math.round(a.y + ((b.y - a.y) * i) / steps);
          ctx.fillStyle = i % 2 ? CITY.link : CITY.linkDim;
          ctx.fillRect(px - 1, py - 1, 2, 2);
        }
      });
    }

    drawBuilding(b) {
      const ctx = this.ctx;
      const height = b.h;
      // footprint is w x d tiles, so the top diamond is a (w+d)/2 scaled diamond
      // drawn as the union of its tiles.
      for (let dr = 0; dr < b.d; dr += 1) {
        for (let dc = 0; dc < b.w; dc += 1) {
          const p = project(this.origin, b.col + dc, b.row + dr);
          fillPrism(ctx, p.x, p.y - height, TILE_H, height, {
            left: b.colors.left,
            right: b.colors.right,
            top: b.colors.top,
          });
        }
      }
      // roof accent: a lighter inner diamond on the top face
      const top = project(this.origin, b.col + b.w / 2, b.row + b.d / 2);
      const roofHeight = Math.max(4, ((b.w + b.d) / 2) * TILE_H - 8);
      fillDiamond(ctx, top.x, top.y - height - roofHeight / 2 + TILE_H / 2, roofHeight, b.colors.roof);
      if (b.windows) {
        ctx.fillStyle = b.colors.window;
        const base = project(this.origin, b.col, b.row + b.d);
        for (let level = 6; level < height - 4; level += 6) {
          for (let k = 0; k < b.w * 2; k += 1) {
            ctx.fillRect(base.x + 6 + k * 8, base.y - level - 2 + k * 4, 2, 2);
          }
        }
      }
    }

    drawLabel(b) {
      const ctx = this.ctx;
      const top = project(this.origin, b.col + b.w / 2, b.row + b.d / 2);
      const anchorY = top.y - b.h + TILE_H / 2 - 4;
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.textBaseline = "top";
      const textWidth = Math.ceil(ctx.measureText(b.name).width);
      const boxW = textWidth + 8;
      const boxH = 14;
      const boxX = Math.round(top.x - boxW / 2);
      const boxY = anchorY - 16 - boxH;
      ctx.fillStyle = CITY.labelBg;
      ctx.fillRect(Math.round(top.x) - 1, boxY + boxH, 2, 14);
      ctx.fillRect(boxX - 1, boxY - 1, boxW + 2, boxH + 2);
      ctx.fillStyle = b.colors.top;
      ctx.fillRect(boxX, boxY, boxW, 1);
      ctx.fillStyle = CITY.labelFg;
      ctx.fillText(b.name, boxX + 4, boxY + 3);
    }
  }

  window.Iso = { BoardScene, CityScene, START_POSITION, project, fillDiamond, fillPrism, squareToCell };
})();
