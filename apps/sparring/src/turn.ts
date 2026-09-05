import { MAX_COMMENT_LENGTH } from "@aichess/core/protocol";
import { readMoveFromAnswer, type MoveChoice, type Turn } from "@agenticchess/sdk";
import { OllamaError } from "./ollama.js";
import { chooseByPolicy, type Fallback } from "./policy.js";
import { buildPrompt } from "./prompt.js";

const MAX_QUOTED = 60;

export interface TurnBrain {
  generate: (prompt: string) => Promise<string>;
}

export type MoveSource = "model" | "unusable_answer" | "no_answer";

export interface TurnHandlerDeps {
  /** Null when no model is configured: the bot still plays. */
  brain: TurnBrain | null;
  fallback: Fallback;
  random: () => number;
  /** What to call the model in the comment, e.g. "gemma3:270m". */
  label: string;
  onDecision?: (decision: { source: MoveSource; san: string }) => void;
}

function trim(comment: string): string {
  return comment.length <= MAX_COMMENT_LENGTH ? comment : `${comment.slice(0, MAX_COMMENT_LENGTH - 1)}…`;
}

function reasonOf(error: unknown): string {
  return error instanceof OllamaError ? error.reason : "error";
}

/**
 * Model first, then the parser, then the local policy - and the comment always
 * says which of the three produced the move.
 *
 * A 270M model will often answer something that names no legal move, so the
 * fallback shapes a good share of every practice game. Saying so on the move
 * is what keeps a spectator from mistaking the fallback's chess for the
 * model's.
 */
export function createTurnHandler(deps: TurnHandlerDeps): (turn: Turn) => Promise<MoveChoice> {
  const fallbackMove = (turn: Turn): string => chooseByPolicy(turn.fen, turn.legalMoves, deps.fallback, deps.random).san;

  const decide = (source: MoveSource, move: string, comment: string): MoveChoice => {
    deps.onDecision?.({ source, san: move });
    return { move, comment: trim(comment) };
  };

  return async (turn: Turn): Promise<MoveChoice> => {
    if (deps.brain === null) {
      const move = fallbackMove(turn);
      return decide("no_answer", move, `No model is configured, so the ${deps.fallback} fallback played ${move}.`);
    }

    let said: string;
    try {
      said = await deps.brain.generate(buildPrompt(turn));
    } catch (error) {
      const move = fallbackMove(turn);
      return decide(
        "no_answer",
        move,
        `${deps.label} did not answer (${reasonOf(error)}), so the ${deps.fallback} fallback played ${move}.`,
      );
    }

    const read = readMoveFromAnswer(said, turn.legalMoves);
    if (read !== null) return decide("model", read.san, `${deps.label}: ${said}`);

    const move = fallbackMove(turn);
    return decide(
      "unusable_answer",
      move,
      `${deps.label} answered "${said.slice(0, MAX_QUOTED)}", which names no legal move, so the ${deps.fallback} fallback played ${move}.`,
    );
  };
}
