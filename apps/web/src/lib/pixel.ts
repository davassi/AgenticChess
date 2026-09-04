/*
 * Pixel sprite renderer, ported from site/js/pixel.js.
 *
 * Every graphic is a monochrome mask (rows of "#" and ".") turned into a
 * shaded sprite: an outer 1px outline, a highlight on the top-left edges, a
 * shadow on the bottom-right edges and a base colour in between. Masks stay
 * tiny and readable, and every sprite shares the same lighting.
 *
 * The masks and palettes below are the artwork, copied character for
 * character. `shade` and `rowRuns` are pure, so a sprite renders on the
 * server and costs the browser nothing.
 */

export type Mask = readonly string[];

export interface Palette {
  outline: string;
  base: string;
  light: string;
  shadow: string;
}

/** Chess pieces, 13 columns wide, 18 rows tall, all facing the viewer. */
export const PIECES = {
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
} as const satisfies Record<string, Mask>;

/**
 * Avatars beyond the six pieces, same 13x18 footprint so they stand on the
 * pedestal and sit in the roster next to a rook without changing size.
 */
export const AVATARS = {
  robot: [
    "......#......",
    "....#####....",
    "...#######...",
    "..#########..",
    "..##.###.##..",
    "..#########..",
    "...#######...",
    ".....###.....",
    ".###########.",
    "#############",
    "#.#########.#",
    "#.#########.#",
    "..#########..",
    "..#########..",
    "..#########..",
    "..##.....##..",
    "..##.....##..",
    ".###.....###.",
  ],
  wizard: [
    "........##...",
    ".......##....",
    "......##.....",
    "....####.....",
    "...#####.....",
    "..#######....",
    ".#########...",
    "#############",
    "....#####....",
    "...#.###.#...",
    "...#######...",
    "..#########..",
    "..#########..",
    ".###########.",
    ".###########.",
    "#############",
    "#############",
    "#############",
  ],
  ghost: [
    "....#####....",
    "..#########..",
    ".###########.",
    ".###########.",
    ".##..###..##.",
    ".##..###..##.",
    ".###########.",
    ".#####.#####.",
    ".###########.",
    ".###########.",
    ".###########.",
    ".###########.",
    ".###########.",
    ".###########.",
    ".###########.",
    ".###########.",
    ".###########.",
    ".##.##.##.##.",
  ],
  owl: [
    "..##.....##..",
    "..###...###..",
    "..#########..",
    ".###########.",
    ".##..###..##.",
    ".##..###..##.",
    ".####...####.",
    ".#####.#####.",
    ".###########.",
    ".###########.",
    "..#########..",
    "..#########..",
    "...#######...",
    "...#######...",
    "...#######...",
    "..#########..",
    ".###########.",
    ".###########.",
  ],
  alien: [
    "...#######...",
    "..#########..",
    ".###########.",
    ".#...###...#.",
    ".#...###...#.",
    ".###########.",
    ".###########.",
    "..#########..",
    "...#######...",
    "....#####....",
    ".....###.....",
    ".#..#####..#.",
    ".#..#####..#.",
    ".#..#####..#.",
    "....#####....",
    "....##.##....",
    "....##.##....",
    "...###.###...",
  ],
  terminal: [
    ".###########.",
    "#############",
    "#...........#",
    "#.##.....##.#",
    "#.##.....##.#",
    "#...........#",
    "#..#######..#",
    "#...........#",
    "#############",
    ".###########.",
    "....#####....",
    "....#####....",
    "...#######...",
    "..#########..",
    ".###########.",
    ".###########.",
    "#############",
    "#############",
  ],
} as const satisfies Record<string, Mask>;

/** Interface icons, small and square-ish. */
export const ICONS = {
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
  eye: ["....####....", "..########..", ".####..####.", "####....####", ".####..####.", "..########..", "....####...."],
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
  "face-a": [
    "...####...",
    "..######..",
    "..#.##.#..",
    "..######..",
    "...####...",
    "....##....",
    ".########.",
    "##########",
    "##########",
  ],
  "face-b": [
    "..######..",
    ".########.",
    ".#.####.#.",
    ".########.",
    "..######..",
    "....##....",
    "..######..",
    ".########.",
    "##########",
  ],
  "face-c": [
    "...####...",
    "..#....#..",
    "..######..",
    "..#.##.#..",
    "..######..",
    "...####...",
    ".########.",
    "##########",
    "##########",
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
} as const satisfies Record<string, Mask>;

export const PALETTES = {
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
} as const satisfies Record<string, Palette>;

export type PieceName = keyof typeof PIECES;
export type AvatarName = keyof typeof AVATARS;
export type IconName = keyof typeof ICONS;
export type SpriteName = PieceName | AvatarName | IconName;
export type PaletteName = keyof typeof PALETTES;

export interface ShadedGrid {
  width: number;
  height: number;
  /** Row-major colours; `null` is transparent. */
  grid: Array<Array<string | null>>;
}

export interface Run {
  x: number;
  width: number;
  color: string;
}

interface ParsedMask {
  width: number;
  height: number;
  at: (x: number, y: number) => boolean;
}

/** Rows padded to equal width so a stray short row never shifts the artwork. */
function parseMask(rows: Mask): ParsedMask {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const cells = rows.map((row) => row.padEnd(width, "."));
  return {
    width,
    height: rows.length,
    at: (x, y) => cells[y]?.[x] === "#",
  };
}

/** Outline, top-left highlight, bottom-right shadow, base in between. */
export function shade(rows: Mask, palette: Palette): ShadedGrid {
  const mask = parseMask(rows);
  const width = mask.width + 2;
  const height = mask.height + 2;
  const grid: Array<Array<string | null>> = [];
  for (let oy = 0; oy < height; oy += 1) {
    const line: Array<string | null> = [];
    for (let ox = 0; ox < width; ox += 1) {
      const x = ox - 1;
      const y = oy - 1;
      if (mask.at(x, y)) {
        if (!mask.at(x - 1, y) || !mask.at(x, y - 1)) line.push(palette.light);
        else if (!mask.at(x + 1, y) || !mask.at(x, y + 1)) line.push(palette.shadow);
        else line.push(palette.base);
      } else if (mask.at(x - 1, y) || mask.at(x + 1, y) || mask.at(x, y - 1) || mask.at(x, y + 1)) {
        line.push(palette.outline);
      } else {
        line.push(null);
      }
    }
    grid.push(line);
  }
  return { width, height, grid };
}

/** Adjacent pixels of one colour become one rect, exactly as the prototype did. */
export function rowRuns(shaded: ShadedGrid): Run[][] {
  return shaded.grid.map((row) => {
    const runs: Run[] = [];
    let x = 0;
    while (x < shaded.width) {
      const color = row[x] ?? null;
      if (color === null) {
        x += 1;
        continue;
      }
      let width = 1;
      while (x + width < shaded.width && (row[x + width] ?? null) === color) width += 1;
      runs.push({ x, width, color });
      x += width;
    }
    return runs;
  });
}

/** Every mask an agent may wear: the six pieces plus the extra avatars. */
export function avatarMask(name: string): Mask | null {
  const pieces: Record<string, Mask> = PIECES;
  const avatars: Record<string, Mask> = AVATARS;
  return pieces[name] ?? avatars[name] ?? null;
}

export function spriteMask(name: string): Mask | null {
  const icons: Record<string, Mask> = ICONS;
  return icons[name] ?? avatarMask(name);
}

export function paletteFor(name: string): Palette | null {
  const palettes: Record<string, Palette> = PALETTES;
  return palettes[name] ?? null;
}

/** Browser only: the isometric board draws sprites with drawImage. */
export function toCanvas(rows: Mask, palette: Palette): HTMLCanvasElement {
  const { width, height, grid } = shade(rows, palette);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2d canvas context unavailable");
  for (let y = 0; y < height; y += 1) {
    const row = grid[y];
    if (row === undefined) continue;
    for (let x = 0; x < width; x += 1) {
      const color = row[x] ?? null;
      if (color === null) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}
