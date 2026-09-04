import type { Building, CityLink } from "./iso";

function palette(top: string, left: string, right: string, roof: string): Building["colors"] {
  return { top, left, right, rim: left, roof, window: "#ffe58a" };
}

/** The services this repository actually contains, drawn as a small city. */
export const ARCHITECTURE_BUILDINGS: Building[] = [
  { name: "web", col: 0, row: 3, w: 2, d: 2, h: 22, colors: palette("#5ff2ff", "#2bb7c9", "#1a8a99", "#8cf7ff") },
  {
    name: "api",
    col: 3,
    row: 0,
    w: 2,
    d: 2,
    h: 40,
    windows: true,
    colors: palette("#ffc233", "#c98a12", "#8f6209", "#ffd76a"),
  },
  { name: "worker", col: 7, row: 2, w: 2, d: 2, h: 26, colors: palette("#ff4d8f", "#c22766", "#8a1a48", "#ff7fb0") },
  { name: "core", col: 3, row: 4, w: 2, d: 2, h: 14, colors: palette("#f6e7c1", "#cdb98e", "#9c8a63", "#fff6dc") },
  { name: "db", col: 6, row: 5, w: 1, d: 1, h: 10, colors: palette("#9dff5a", "#5fbf2a", "#3f8a1a", "#c4ff98") },
  {
    name: "postgres",
    col: 1,
    row: 6,
    w: 2,
    d: 2,
    h: 18,
    colors: palette("#7fa6ff", "#4d74d1", "#334f96", "#a8c2ff"),
  },
  { name: "redis", col: 5, row: 7, w: 1, d: 1, h: 18, colors: palette("#ff6b4a", "#c9401f", "#8f2a12", "#ff9c86") },
];

export const ARCHITECTURE_LINKS: CityLink[] = [
  ["web", "api"],
  ["api", "core"],
  ["worker", "core"],
  ["api", "db"],
  ["worker", "db"],
  ["db", "postgres"],
  ["api", "redis"],
  ["worker", "redis"],
];
