/*
 * Pixel sprite renderer.
 *
 * Every graphic on the landing page is a monochrome mask (rows of "#" and ".")
 * turned into a shaded sprite: an outer 1px outline, a highlight on the
 * top-left edges, a shadow on the bottom-right edges and a base colour in
 * between. Masks stay tiny and readable, and every sprite shares the same
 * lighting, which keeps the whole page in one visual vocabulary.
 */
(function () {
  "use strict";

  /** Chess pieces, 13 columns wide, 18 rows tall, all facing the viewer. */
  const PIECES = {
    pawn: [
      "......#......",
      ".....###.....",
      "....#####....",
      "....#####....",
      "....#####....",
      ".....###.....",
      "...#######...",
      "...#######...",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      "....#####....",
      "....#####....",
      "...#######...",
      "..#########..",
      ".###########.",
      ".###########.",
    ],
    rook: [
      ".##..###..##.",
      ".##..###..##.",
      ".###########.",
      ".###########.",
      "..#########..",
      "...#######...",
      "...#######...",
      "...#######...",
      "...#######...",
      "...#######...",
      "...#######...",
      "...#######...",
      "...#######...",
      "..#########..",
      "..#########..",
      ".###########.",
      ".###########.",
      ".###########.",
    ],
    knight: [
      "....#..#.....",
      "...######....",
      "..########...",
      ".##########..",
      ".###########.",
      "###.########.",
      "##..########.",
      "###.########.",
      ".###.#######.",
      "....########.",
      ".....#######.",
      "....########.",
      "....########.",
      "...#########.",
      "..##########.",
      ".###########.",
      ".###########.",
      ".###########.",
    ],
    bishop: [
      "......#......",
      ".....###.....",
      "....#####....",
      "....##.##....",
      "...#######...",
      "...###.####..",
      "....######...",
      "....#####....",
      ".....###.....",
      "....#####....",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      "....#####....",
      "...#######...",
      "..#########..",
      ".###########.",
      ".###########.",
    ],
    queen: [
      ".#..#.#.#..#.",
      ".#..#.#.#..#.",
      ".###########.",
      "..#########..",
      "...#######...",
      "....#####....",
      "....#####....",
      ".....###.....",
      "....#####....",
      ".....###.....",
      ".....###.....",
      "....#####....",
      "....#####....",
      "...#######...",
      "..#########..",
      ".###########.",
      ".###########.",
      ".###########.",
    ],
    king: [
      "......#......",
      ".....###.....",
      "......#......",
      "....#####....",
      "...#######...",
      "...#######...",
      "....#####....",
      ".....###.....",
      "....#####....",
      ".....###.....",
      ".....###.....",
      "....#####....",
      "....#####....",
      "...#######...",
      "..#########..",
      ".###########.",
      ".###########.",
      ".###########.",
    ],
  };

  /** Small icons used in the HUD panels, menus and maps. */
  const ICONS = {
    key: ["...####.....", "..#....#....", "..#....#....", "..#....#####", "..#....#.#.#", "...####..#.."],
    plug: [
      "....#..#....",
      "....#..#....",
      "..########..",
      "..########..",
      "..########..",
      "...######...",
      ".....##.....",
      ".....##.....",
      ".....##.....",
    ],
    hourglass: [
      "########",
      ".#....#.",
      ".#....#.",
      "..#..#..",
      "...##...",
      "..#..#..",
      ".#....#.",
      ".#....#.",
      "########",
    ],
    trophy: [
      "##########",
      "#.######.#",
      "#.######.#",
      "#.######.#",
      ".#.####.#.",
      "..######..",
      "...####...",
      "....##....",
      "....##....",
      "..######..",
    ],
    flag: [
      "#.........",
      "##########",
      "##########",
      "##########",
      "##########",
      "#.........",
      "#.........",
      "#.........",
      "#.........",
    ],
    heart: [".##..##.", "########", "########", "########", ".######.", "..####..", "...##..."],
    bubble: ["##########", "#........#", "#........#", "#........#", "##########", "..##......", ".#........"],
    lock: ["..####..", ".#....#.", ".#....#.", "########", "########", "###..###", "###..###", "########", "########"],
    star: ["....#....", "....#....", "...###...", "#########", ".#######.", "..#####..", "..##.##..", ".#.....#."],
    fish: [
      ".....####...",
      "....######.#",
      "...########.",
      "..##.#######",
      "...########.",
      "....######.#",
      ".....####...",
    ],
    gear: ["...##...", ".######.", ".######.", "###..###", "###..###", ".######.", ".######.", "...##..."],
    shield: [
      ".########.",
      "##########",
      "##########",
      "##########",
      ".########.",
      ".########.",
      "..######..",
      "...####...",
      "....##....",
    ],
    scroll: [".########.", ".#......#.", ".#.####.#.", ".#......#.", ".#.####.#.", ".#......#.", ".########."],
    eye: [
      "....####....",
      "..########..",
      ".####..####.",
      "####....####",
      ".####..####.",
      "..########..",
      "....####....",
    ],
    bolt: ["....###.", "...###..", "..###...", ".#####..", "...###..", "..###...", ".###...."],
    clock: ["..####..", ".#....#.", "#..#...#", "#..#...#", "#..##..#", "#......#", ".#....#.", "..####.."],
    moon: [
      "......####......",
      "....########....",
      "...##########...",
      "..############..",
      ".#####.########.",
      ".##############.",
      "################",
      "#########..#####",
      "#########..#####",
      "################",
      ".###.##########.",
      ".##############.",
      "..############..",
      "...##########...",
      "....########....",
      "......####......",
    ],
    coin: ["..####..", ".######.", "###..###", "###..###", "###..###", "###..###", ".######.", "..####.."],
    skull: [
      "..######..",
      ".########.",
      "##..##..##",
      "##..##..##",
      "##########",
      ".###..###.",
      "..######..",
      "..#.##.#..",
    ],
    cat: [
      ".#.......#..",
      ".##.....##..",
      ".###...###..",
      ".##########.",
      "############",
      "############",
      "##.######.##",
      "############",
      ".##########.",
      "..########..",
      "...######...",
    ],
    "glyph-g": [
      "..#####..",
      ".#.....#.",
      "#.......#",
      "#........",
      "#........",
      "#...#####",
      "#.......#",
      ".#.....#.",
      "..#####..",
    ],
    cursor: [
      "#.....",
      "##....",
      "###...",
      "####..",
      "#####.",
      "######",
      "#####.",
      "####..",
      "###...",
      "##....",
      "#.....",
    ],
  };

  const PALETTES = {
    white: { outline: "#2a1a4d", base: "#f4efe3", light: "#ffffff", shadow: "#c3b8dc" },
    black: { outline: "#0d0719", base: "#4b3f70", light: "#8878b6", shadow: "#2b2247" },
    gold: { outline: "#3d2a05", base: "#ffc233", light: "#ffe58a", shadow: "#c98a12" },
    cyan: { outline: "#0b3b46", base: "#5ff2ff", light: "#c7fbff", shadow: "#2bb7c9" },
    magenta: { outline: "#4a0d29", base: "#ff4d8f", light: "#ffa5c8", shadow: "#c22766" },
    lime: { outline: "#1f4a0a", base: "#9dff5a", light: "#d9ffb8", shadow: "#5fbf2a" },
    ivory: { outline: "#3a2a1a", base: "#f6e7c1", light: "#fff8e6", shadow: "#cdb98e" },
    rust: { outline: "#3a1608", base: "#b4552b", light: "#e08a55", shadow: "#7e3a1c" },
    slate: { outline: "#0d0719", base: "#6c6390", light: "#a49bc7", shadow: "#443c66" },
    red: { outline: "#3a0505", base: "#ff4444", light: "#ff9a9a", shadow: "#b51e1e" },
  };

  /**
   * Normalise a mask: rows padded to equal width so a stray short row never
   * shifts the artwork.
   */
  function parseMask(rows) {
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const height = rows.length;
    const cells = rows.map((row) => row.padEnd(width, "."));
    const get = (x, y) => y >= 0 && y < height && x >= 0 && x < width && cells[y][x] === "#";
    return { width, height, get };
  }

  /**
   * Turn a mask into a grid of colours (null = transparent). The output is two
   * pixels wider and taller than the mask to make room for the outline.
   */
  function shade(rows, palette) {
    const mask = parseMask(rows);
    const width = mask.width + 2;
    const height = mask.height + 2;
    const grid = [];
    for (let oy = 0; oy < height; oy += 1) {
      const line = [];
      for (let ox = 0; ox < width; ox += 1) {
        const x = ox - 1;
        const y = oy - 1;
        if (mask.get(x, y)) {
          if (!mask.get(x - 1, y) || !mask.get(x, y - 1)) {
            line.push(palette.light);
          } else if (!mask.get(x + 1, y) || !mask.get(x, y + 1)) {
            line.push(palette.shadow);
          } else {
            line.push(palette.base);
          }
        } else if (mask.get(x - 1, y) || mask.get(x + 1, y) || mask.get(x, y - 1) || mask.get(x, y + 1)) {
          line.push(palette.outline);
        } else {
          line.push(null);
        }
      }
      grid.push(line);
    }
    return { width, height, grid };
  }

  /** Render a shaded grid as inline SVG. Runs of one colour become one rect. */
  function toSvg(rows, palette, options) {
    const opts = options || {};
    const scale = opts.scale || 3;
    const { width, height, grid } = shade(rows, palette);
    const rects = [];
    for (let y = 0; y < height; y += 1) {
      let x = 0;
      while (x < width) {
        const color = grid[y][x];
        if (color === null) {
          x += 1;
          continue;
        }
        let run = 1;
        while (x + run < width && grid[y][x + run] === color) run += 1;
        rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${color}"/>`);
        x += run;
      }
    }
    const label = opts.label ? ` role="img" aria-label="${escapeAttr(opts.label)}"` : ' aria-hidden="true"';
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
      `width="${width * scale}" height="${height * scale}" shape-rendering="crispEdges"${label}>` +
      rects.join("") +
      "</svg>"
    );
  }

  /** Render a shaded grid to an offscreen canvas at 1:1 for drawImage. */
  function toCanvas(rows, palette) {
    const { width, height, grid } = shade(rows, palette);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const color = grid[y][x];
        if (color !== null) {
          ctx.fillStyle = color;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    return canvas;
  }

  function escapeAttr(value) {
    return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function lookup(name) {
    return ICONS[name] || PIECES[name] || null;
  }

  /**
   * Fill every `[data-sprite]` element in `root` with its SVG. Attributes:
   * data-sprite="knight" data-palette="gold" data-scale="4" data-label="...".
   */
  function mount(root) {
    const nodes = (root || document).querySelectorAll("[data-sprite]");
    nodes.forEach((node) => {
      const rows = lookup(node.dataset.sprite);
      const palette = PALETTES[node.dataset.palette || "ivory"];
      if (!rows || !palette) return;
      const scale = Number(node.dataset.scale) || 3;
      node.innerHTML = toSvg(rows, palette, { scale, label: node.dataset.label });
    });
  }

  window.Pixel = { PIECES, ICONS, PALETTES, shade, toSvg, toCanvas, mount };
})();
