import type { GameSnapshot, WireEvent } from "@aichess/core/protocol";
import { describe, expect, it, vi } from "vitest";
import { LiveBuffer, keepAfterHello, keepAfterSnapshot } from "./subscribe.js";

const GAME = "11111111-1111-4111-8111-111111111111";

function ping(): WireEvent {
  return { type: "ping", at: "2026-09-04T00:00:00.000Z" };
}

function move(ply: number): WireEvent {
  return {
    type: "game.move",
    gameId: GAME,
    ply,
    color: "white",
    san: "e4",
    uci: "e2e4",
    fen: "fen",
    comment: null,
    thinkTimeMs: 10,
  };
}

function turn(ply: number): WireEvent {
  return { type: "game.turn", gameId: GAME, color: "black", ply, deadlineAt: "2026-09-04T00:01:00.000Z" };
}

function illegal(ply: number): WireEvent {
  return {
    type: "game.illegal_attempt",
    gameId: GAME,
    color: "white",
    ply,
    submitted: "Ke2",
    reason: "not_legal",
    attemptsLeft: 2,
  };
}

function end(): WireEvent {
  return {
    type: "game.end",
    gameId: GAME,
    result: "1-0",
    termination: "resignation",
    pgn: "1. e4",
    rating: null,
  };
}

function snapshot(ply: number): GameSnapshot {
  return {
    id: GAME,
    status: "active",
    white: { id: "22222222-2222-4222-8222-222222222222", name: "W", slug: "w", modelProvider: "x", modelName: "y" },
    black: { id: "33333333-3333-4333-8333-333333333333", name: "B", slug: "b", modelProvider: "x", modelName: "y" },
    config: { timePerMoveMs: 60_000, moveLimitPlies: 300, illegalAttemptsPerTurn: 3 },
    fen: "start",
    ply,
    history: [],
    turn: "white",
    moveDeadlineAt: "2026-09-04T00:01:00.000Z",
    result: null,
    termination: null,
    startedAt: "2026-09-04T00:00:00.000Z",
    finishedAt: null,
  };
}

describe("keepAfterSnapshot", () => {
  it("replays moves and turns after the snapshot ply, illegal attempts at that ply, and game.end", () => {
    expect(keepAfterSnapshot(move(1), 0)).toBe(true);
    expect(keepAfterSnapshot(move(1), 1)).toBe(false);
    expect(keepAfterSnapshot(turn(1), 0)).toBe(true);
    expect(keepAfterSnapshot(illegal(0), 0)).toBe(true);
    expect(keepAfterSnapshot(illegal(0), 1)).toBe(false);
    expect(keepAfterSnapshot(end(), 4)).toBe(true);
    expect(keepAfterSnapshot(ping(), 0)).toBe(false);
  });
});

describe("keepAfterHello", () => {
  it("drops game.start for the hello snapshot and keeps later plies", () => {
    const game = snapshot(0);
    const start: WireEvent = {
      type: "game.start",
      gameId: GAME,
      color: "white",
      opponent: game.black,
      timePerMoveMs: 60_000,
      startedAt: "2026-09-04T00:00:00.000Z",
    };
    expect(keepAfterHello(start, game)).toBe(false);
    expect(keepAfterHello(move(1), game)).toBe(true);
    expect(keepAfterHello(start, null)).toBe(true);
  });
});

describe("LiveBuffer", () => {
  it("holds events until takeOver, then filters and switches to live", () => {
    const buffer = new LiveBuffer();
    const live = vi.fn();
    buffer.handler(move(1));
    buffer.handler(end());
    buffer.takeOver(live, (event) => event.type === "game.end");
    expect(live).toHaveBeenCalledTimes(1);
    expect(live).toHaveBeenCalledWith(end());
    buffer.handler(ping());
    expect(live).toHaveBeenCalledWith(ping());
  });
});
