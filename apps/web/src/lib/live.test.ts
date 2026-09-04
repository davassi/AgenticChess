import type { GameSnapshot, WireEvent } from "@aichess/core/protocol";
import { describe, expect, it } from "vitest";
import { applyStreamEvent, type LiveGame } from "./live";

const AGENT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "opusbot",
  slug: "opusbot",
  modelProvider: "Anthropic",
  modelName: "claude-opus-5",
};

const SNAPSHOT: GameSnapshot = {
  id: "22222222-2222-4222-8222-222222222222",
  status: "active",
  white: AGENT,
  black: { ...AGENT, id: "33333333-3333-4333-8333-333333333333", slug: "tal-turbo", name: "tal-turbo" },
  config: { timePerMoveMs: 60_000, moveLimitPlies: 300, illegalAttemptsPerTurn: 3 },
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  ply: 0,
  history: [],
  turn: "white",
  moveDeadlineAt: "2026-09-04T10:01:00.000Z",
  result: null,
  termination: null,
  startedAt: "2026-09-04T10:00:00.000Z",
  finishedAt: null,
};

const EMPTY: LiveGame = { snapshot: SNAPSHOT, moves: [], attempts: [], finished: false };

const MOVE: WireEvent = {
  type: "game.move",
  gameId: SNAPSHOT.id,
  ply: 1,
  color: "white",
  san: "e4",
  uci: "e2e4",
  fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  comment: "Centre.",
  thinkTimeMs: 8_100,
};

describe("applyStreamEvent", () => {
  it("appends a move and advances the position", () => {
    const next = applyStreamEvent(EMPTY, MOVE);
    expect(next.moves).toHaveLength(1);
    expect(next.snapshot.ply).toBe(1);
    expect(next.snapshot.history).toEqual(["e4"]);
    expect(next.snapshot.turn).toBe("black");
    expect(next.moves[0]?.comment).toBe("Centre.");
  });

  it("ignores a move it has already seen, so a reconnection cannot duplicate it", () => {
    const once = applyStreamEvent(EMPTY, MOVE);
    const twice = applyStreamEvent(once, MOVE);
    expect(twice).toBe(once);
  });

  it("keeps a move out of the list when it would leave a gap, but still follows the game", () => {
    // The stream only carries what happens next: a move that landed between
    // the server render and the subscription reaches the page as part of the
    // snapshot, never as a game.move. Appending the move after it would put a
    // hole in the list, and every position replayed past the hole is wrong.
    const missedOne: LiveGame = { ...EMPTY, snapshot: { ...SNAPSHOT, ply: 1, history: ["e4"] } };
    const next = applyStreamEvent(missedOne, {
      ...MOVE,
      ply: 2,
      color: "black",
      san: "e5",
      uci: "e7e5",
      fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    });
    expect(next.moves).toEqual([]);
    expect(next.snapshot.ply).toBe(2);
    expect(next.snapshot.fen).toBe("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2");
    expect(next.snapshot.turn).toBe("white");
  });

  it("appends the move that continues the list", () => {
    const afterFirst = applyStreamEvent(EMPTY, MOVE);
    const afterSecond = applyStreamEvent(afterFirst, { ...MOVE, ply: 2, color: "black", san: "e5", uci: "e7e5" });
    expect(afterSecond.moves.map((move) => move.san)).toEqual(["e4", "e5"]);
    expect(afterSecond.snapshot.ply).toBe(2);
  });

  it("takes a whole snapshot when the server sends one", () => {
    const resumed = applyStreamEvent(EMPTY, { type: "game.snapshot", game: { ...SNAPSHOT, ply: 7 } });
    expect(resumed.snapshot.ply).toBe(7);
    expect(resumed.finished).toBe(false);
  });

  it("moves the deadline on a turn event without touching the moves", () => {
    const next = applyStreamEvent(EMPTY, {
      type: "game.turn",
      gameId: SNAPSHOT.id,
      color: "black",
      ply: 1,
      deadlineAt: "2026-09-04T10:02:00.000Z",
    });
    expect(next.snapshot.moveDeadlineAt).toBe("2026-09-04T10:02:00.000Z");
    expect(next.snapshot.turn).toBe("black");
    expect(next.moves).toHaveLength(0);
  });

  it("records a rejected attempt", () => {
    const next = applyStreamEvent(EMPTY, {
      type: "game.illegal_attempt",
      gameId: SNAPSHOT.id,
      color: "white",
      ply: 0,
      submitted: "Qz9",
      reason: "unparseable",
      attemptsLeft: 2,
    });
    expect(next.attempts).toMatchObject([{ submitted: "Qz9", reason: "unparseable" }]);
  });

  it("closes the game on game.end and keeps the result", () => {
    const next = applyStreamEvent(EMPTY, {
      type: "game.end",
      gameId: SNAPSHOT.id,
      result: "1-0",
      termination: "checkmate",
      pgn: "",
      rating: null,
    });
    expect(next.finished).toBe(true);
    expect(next.snapshot).toMatchObject({ status: "finished", result: "1-0", termination: "checkmate" });
    expect(next.snapshot.moveDeadlineAt).toBeNull();
  });

  it("ignores a ping", () => {
    expect(applyStreamEvent(EMPTY, { type: "ping", at: "2026-09-04T10:00:30.000Z" })).toBe(EMPTY);
  });
});
