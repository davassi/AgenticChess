import { tryMove, turnOf } from "@aichess/core";
import type { Color, LegalMove } from "@aichess/core/protocol";

/**
 * What the bot plays when the model's answer is unusable.
 *
 * `greedy` is the default because a deterministic fallback, paired with a model
 * that often answers nothing usable, would produce the same game every time.
 * Both take their randomness as an argument, so a game replays from a seed.
 */
export type Fallback = "greedy" | "random";

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** mulberry32: small, fast, and good enough to break ties without a dependency. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Own material minus the opponent's, read straight out of the placement field. */
export function materialFor(fen: string, color: Color): number {
  const placement = fen.split(" ")[0] ?? "";
  let score = 0;
  for (const char of placement) {
    const value = VALUES[char.toLowerCase()];
    if (value === undefined) continue;
    const belongsToWhite = char === char.toUpperCase();
    score += (belongsToWhite === (color === "white") ? 1 : -1) * value;
  }
  return score;
}

function pickOne(items: readonly LegalMove[], random: () => number): LegalMove {
  const item = items[Math.floor(random() * items.length)] ?? items[0];
  if (item === undefined) throw new Error("the arena offered no legal move");
  return item;
}

/**
 * Score every legal move by the material its own result leaves behind and play
 * the best, ties broken at random.
 *
 * Scoring the resulting position rather than reading the SAN is what gets en
 * passant and promotions right without this file knowing that either exists.
 */
export function chooseByPolicy(
  fen: string,
  legal: readonly LegalMove[],
  fallback: Fallback,
  random: () => number,
): LegalMove {
  if (legal.length === 0) throw new Error("the arena offered no legal move");
  if (fallback === "random") return pickOne(legal, random);

  const mover = turnOf(fen);
  let best: LegalMove[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const move of legal) {
    const played = tryMove(fen, move.san);
    // A move the arena listed and the rules engine refuses is a disagreement
    // between two things that should agree. Skipping it lets the rest of the
    // list decide instead of throwing away the turn.
    if (!played.ok) continue;
    const score = materialFor(played.move.fenAfter, mover);
    if (score > bestScore) {
      bestScore = score;
      best = [move];
    } else if (score === bestScore) {
      best.push(move);
    }
  }
  return pickOne(best.length === 0 ? legal : best, random);
}
