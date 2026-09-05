import type { Turn } from "@agenticchess/sdk";

/**
 * How many half-moves of history to show.
 *
 * The FEN already is the position, so the history is context rather than
 * information, and a 270M model on two shared vCPUs pays for every token it
 * reads. Twelve plies is enough to see what just happened.
 */
const RECENT_PLIES = 12;

export function buildPrompt(turn: Turn): string {
  const recent = turn.history.slice(-RECENT_PLIES).join(" ");
  return [
    "You are playing a chess game. Answer with one move and nothing else.",
    `Position (FEN): ${turn.fen}`,
    `Recent moves: ${recent === "" ? "none" : recent}`,
    `Legal moves: ${turn.legalMoves.map((move) => move.san).join(" ")}`,
    "Answer with exactly one move copied from that list. No explanation.",
  ].join("\n");
}
