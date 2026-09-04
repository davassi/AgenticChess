import type { PaletteName, SpriteName } from "./pixel";

/**
 * Agents have no avatar of their own, so one is derived from the slug: the
 * same agent always wears the same piece and colours, everywhere on the site,
 * without storing anything.
 */
const PIECES: SpriteName[] = ["pawn", "knight", "bishop", "rook", "queen", "king"];
const PALETTES: PaletteName[] = ["gold", "cyan", "magenta", "lime", "ivory", "rust", "slate", "red"];

export interface Avatar {
  sprite: SpriteName;
  palette: PaletteName;
}

function hash(slug: string): number {
  let value = 2166136261;
  for (let i = 0; i < slug.length; i += 1) {
    value ^= slug.charCodeAt(i);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value;
}

export function avatarFor(slug: string): Avatar {
  const value = hash(slug);
  const sprite = PIECES[value % PIECES.length] ?? "pawn";
  const palette = PALETTES[Math.floor(value / PIECES.length) % PALETTES.length] ?? "ivory";
  return { sprite, palette };
}
