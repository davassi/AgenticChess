import { legalMoves } from "@aichess/core";
import type { Turn } from "@agenticchess/sdk";
import { describe, expect, it } from "vitest";
import { OllamaError } from "./ollama.js";
import { seededRandom } from "./policy.js";
import { createTurnHandler, type MoveSource } from "./turn.js";

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const turn: Turn = {
  gameId: "g",
  ply: 0,
  fen: FEN,
  history: [],
  lastMove: null,
  legalMoves: legalMoves(FEN),
  deadlineAt: "2026-09-05T10:00:00.000Z",
  attemptsLeft: 3,
  remainingMs: () => 60_000,
};

const legalSan = turn.legalMoves.map((move) => move.san);

function handler(
  generate: (prompt: string) => Promise<string>,
  seen: MoveSource[] = [],
): (t: Turn) => Promise<{ move: string; comment?: string }> {
  return createTurnHandler({
    brain: { generate },
    fallback: "greedy",
    random: seededRandom(1),
    label: "gemma3:270m",
    onDecision: ({ source }) => seen.push(source),
  });
}

describe("createTurnHandler", () => {
  it("plays the move the model named and quotes it", async () => {
    const seen: MoveSource[] = [];
    const choice = await handler(() => Promise.resolve("e4"), seen)(turn);

    expect(choice.move).toBe("e4");
    expect(choice.comment).toContain("gemma3:270m");
    expect(seen).toEqual(["model"]);
  });

  it("hands the model the legal moves as a closed list", async () => {
    let prompt = "";
    await handler((given) => {
      prompt = given;
      return Promise.resolve("e4");
    })(turn);

    expect(prompt).toContain(FEN);
    expect(prompt).toContain("e4");
  });

  it("falls back when the answer names no legal move, and says so", async () => {
    const seen: MoveSource[] = [];
    const choice = await handler(() => Promise.resolve("I would like to castle immediately"), seen)(turn);

    expect(legalSan).toContain(choice.move);
    expect(choice.comment).toMatch(/names no legal move/i);
    expect(choice.comment).toContain("greedy");
    expect(seen).toEqual(["unusable_answer"]);
  });

  it("falls back when the model does not answer, and names the reason", async () => {
    const seen: MoveSource[] = [];
    const choice = await handler(() => Promise.reject(new OllamaError("timeout", "too slow")), seen)(turn);

    expect(legalSan).toContain(choice.move);
    expect(choice.comment).toMatch(/timeout/);
    expect(seen).toEqual(["no_answer"]);
  });

  it("plays without a model at all", async () => {
    const choice = await createTurnHandler({
      brain: null,
      fallback: "random",
      random: seededRandom(2),
      label: "gemma3:270m",
    })(turn);

    expect(legalSan).toContain(choice.move);
    expect(choice.comment).toContain("No model");
  });

  it("never writes a comment the arena would reject", async () => {
    const choice = await handler(() => Promise.resolve("x".repeat(2_000)))(turn);

    expect(choice.comment?.length ?? 0).toBeLessThanOrEqual(500);
  });
});
