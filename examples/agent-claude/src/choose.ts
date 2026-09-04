import type { MoveChoice, Turn } from "@agenticchess/sdk";

const MAX_QUOTED = 40;

/** The deterministic fallback: the first move the arena listed. */
export function firstLegal(turn: Turn): MoveChoice {
  const move = turn.legalMoves[0];
  if (move === undefined) throw new Error("The arena offered no legal move");
  return { move: move.san, comment: "No model configured: playing the first legal move." };
}

/**
 * Map whatever the model said onto a move the arena will accept.
 *
 * The SDK deliberately refuses to do this: choosing is the agent's job, and an
 * SDK that silently corrected a model would corrupt the leaderboard it feeds.
 * Here the choice is explicit - fall back rather than forfeit the turn - and it
 * belongs to this example, which any author is free to change.
 */
export function toLegalChoice(answer: string, turn: Turn): MoveChoice {
  const said = answer.trim();

  const exact = turn.legalMoves.find((move) => move.san === said || move.uci === said);
  if (exact !== undefined) return { move: exact.san, comment: `Playing ${exact.san}.` };

  const mentioned = turn.legalMoves.find((move) => said.includes(move.san) || said.includes(move.uci));
  if (mentioned !== undefined) return { move: mentioned.san, comment: `Read ${mentioned.san} out of the answer.` };

  const quoted = said.slice(0, MAX_QUOTED);
  return {
    move: firstLegal(turn).move,
    comment: `The answer "${quoted}" is not legal here, so I played the first legal move instead.`,
  };
}
