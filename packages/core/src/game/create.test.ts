import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_CONFIG } from "../protocol/enums.js";
import { START_FEN } from "../chess/rules.js";
import { createGame, startGame } from "./create.js";
import { InvalidTransitionError, agentColor, opponentOf, sideToMove } from "./state.js";

const input = {
  id: "game-1",
  whiteAgentId: "agent-w",
  blackAgentId: "agent-b",
  config: DEFAULT_GAME_CONFIG,
  now: 1_000_000,
};

describe("createGame", () => {
  it("builds a created game at the start position", () => {
    const state = createGame(input);
    expect(state).toMatchObject({
      id: "game-1",
      status: "created",
      fen: START_FEN,
      fenHistory: [START_FEN],
      ply: 0,
      moves: [],
      turnStartedAt: null,
      moveDeadlineAt: null,
      illegalAttemptsThisTurn: 0,
      result: null,
      termination: null,
      createdAt: 1_000_000,
      startedAt: null,
      finishedAt: null,
    });
  });
});

describe("startGame", () => {
  it("activates the game and gives white the first turn", () => {
    const { state, events } = startGame(createGame(input), 2_000_000);
    expect(state.status).toBe("active");
    expect(state.startedAt).toBe(2_000_000);
    expect(state.turnStartedAt).toBe(2_000_000);
    expect(state.moveDeadlineAt).toBe(2_000_000 + DEFAULT_GAME_CONFIG.timePerMoveMs);
    expect(events).toEqual([
      { type: "started", startedAt: 2_000_000 },
      { type: "turn", color: "white", ply: 0, deadlineAt: 2_060_000, attemptsLeft: 3 },
    ]);
  });

  it("does not mutate the input state", () => {
    const created = createGame(input);
    startGame(created, 2_000_000);
    expect(created.status).toBe("created");
  });

  it("refuses to start a game twice", () => {
    const { state } = startGame(createGame(input), 2_000_000);
    expect(() => startGame(state, 3_000_000)).toThrow(InvalidTransitionError);
  });
});

describe("state helpers", () => {
  it("derives side to move from ply parity", () => {
    const state = createGame(input);
    expect(sideToMove(state)).toBe("white");
    expect(sideToMove({ ...state, ply: 1 })).toBe("black");
    expect(sideToMove({ ...state, ply: 2 })).toBe("white");
  });

  it("maps agents to colours", () => {
    const state = createGame(input);
    expect(agentColor(state, "agent-w")).toBe("white");
    expect(agentColor(state, "agent-b")).toBe("black");
    expect(agentColor(state, "stranger")).toBeNull();
  });

  it("flips colours", () => {
    expect(opponentOf("white")).toBe("black");
    expect(opponentOf("black")).toBe("white");
  });
});
