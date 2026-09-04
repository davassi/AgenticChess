import { AgenticChessClient, type MoveChoice } from "@agenticchess/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type Harness, type SeededAgent } from "./test-utils/harness.js";

/** Scholar's mate: the shortest game that ends in a real checkmate. */
const WHITE_MOVES = ["e4", "Bc4", "Qh5", "Qxf7#"];
const BLACK_MOVES = ["e5", "Nc6", "Nf6"];

describe("the SDK against the real arena", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({ listen: true, owners: "distinct" });
  });

  afterAll(async () => {
    await h.stop();
  });

  beforeEach(async () => {
    await h.reseed();
  });

  function player(agent: SeededAgent, moves: string[]): { client: AgenticChessClient; ended: Promise<string> } {
    let settle: (result: string) => void = () => {};
    const ended = new Promise<string>((resolve) => {
      settle = resolve;
    });
    const client = new AgenticChessClient({
      apiKey: agent.key,
      baseUrl: h.baseUrl,
      onEvent: (event) => {
        if (event.type === "game.end") {
          client.stop();
          settle(event.result);
        }
      },
    });
    let index = 0;
    client.onYourTurn((): MoveChoice | null => {
      const move = moves[index];
      index += 1;
      return move === undefined ? null : { move, comment: `Book move ${move}.` };
    });
    return { client, ended };
  }

  it("plays a whole game to checkmate through the client", async () => {
    const gameId = await h.createGame();
    const white = player(h.agents.white, WHITE_MOVES);
    const black = player(h.agents.black, BLACK_MOVES);

    const running = [white.client.run(), black.client.run()];
    const [whiteResult, blackResult] = await Promise.all([white.ended, black.ended]);
    await Promise.all(running);

    expect(whiteResult).toBe("1-0");
    expect(blackResult).toBe("1-0");

    const snapshot = await white.client.game(gameId);
    expect(snapshot.status).toBe("finished");
    expect(snapshot.termination).toBe("checkmate");
  }, 30_000);

  it("reports an illegal move as an ArenaError carrying the legal ones", async () => {
    await h.createGame();
    const white = new AgenticChessClient({ apiKey: h.agents.white.key, baseUrl: h.baseUrl });

    const errors: unknown[] = [];

    const turnSeen = new Promise<void>((resolve) => {
      white.onYourTurn(async (turn) => {
        try {
          await white.move(turn.gameId, turn.ply, "Qh9");
        } catch (error) {
          errors.push(error);
        }
        white.stop();
        resolve();
        return null;
      });
    });

    const running = white.run();
    await turnSeen;
    await running;

    expect(errors).toHaveLength(1);
    const [error] = errors as Array<{ code: string; details?: Record<string, unknown> }>;
    expect(error?.code).toBe("illegal_move");
    expect(Array.isArray(error?.details?.["legalMoves"])).toBe(true);
  }, 30_000);

  it("rejects a bad key without looping", async () => {
    const client = new AgenticChessClient({ apiKey: "ac_notarealkeyatall", baseUrl: h.baseUrl });

    await expect(client.run()).rejects.toMatchObject({ code: "unauthorized" });
  }, 30_000);
});
