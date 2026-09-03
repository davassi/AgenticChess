import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_CONFIG, MAX_COMMENT_LENGTH } from "../protocol/enums.js";
import type { GameConfig } from "../protocol/schemas.js";
import { applyMove } from "./apply-move.js";
import { createGame, startGame } from "./create.js";
import type { GameState } from "./state.js";

const T0 = 1_000_000;
const WHITE = "agent-w";
const BLACK = "agent-b";

function activeGame(config: GameConfig = DEFAULT_GAME_CONFIG): GameState {
  return startGame(createGame({ id: "g1", whiteAgentId: WHITE, blackAgentId: BLACK, config, now: T0 }), T0).state;
}

function mustApply(state: GameState, agentId: string, move: string, now: number, comment?: string): GameState {
  const r = applyMove(state, { agentId, ply: state.ply, move, comment, now });
  if (!r.ok) throw new Error(`test setup move rejected: ${move} -> ${r.code}`);
  return r.state;
}

function playLine(state: GameState, sans: string[], startAt = T0 + 1_000): GameState {
  let s = state;
  let now = startAt;
  for (const san of sans) {
    const agent = s.ply % 2 === 0 ? WHITE : BLACK;
    s = mustApply(s, agent, san, now);
    now += 1_000;
  }
  return s;
}

describe("applyMove: legal move", () => {
  it("records the move, passes the turn and sets a new deadline", () => {
    const r = applyMove(activeGame(), { agentId: WHITE, ply: 0, move: "e4", comment: " Centre. ", now: T0 + 1_500 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.idempotent).toBe(false);
    expect(r.state.ply).toBe(1);
    expect(r.state.status).toBe("active");
    expect(r.state.fen).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
    expect(r.state.fenHistory).toHaveLength(2);
    expect(r.state.turnStartedAt).toBe(T0 + 1_500);
    expect(r.state.moveDeadlineAt).toBe(T0 + 1_500 + DEFAULT_GAME_CONFIG.timePerMoveMs);
    expect(r.state.illegalAttemptsThisTurn).toBe(0);
    expect(r.state.moves).toEqual([
      {
        ply: 1,
        color: "white",
        san: "e4",
        uci: "e2e4",
        fenAfter: r.state.fen,
        comment: "Centre.",
        thinkTimeMs: 1_500,
        illegalAttemptsBefore: 0,
      },
    ]);
    expect(r.events).toEqual([
      { type: "move", record: r.state.moves[0] },
      { type: "turn", color: "black", ply: 1, deadlineAt: r.state.moveDeadlineAt, attemptsLeft: 3 },
    ]);
  });

  it("stores null for a blank comment and truncates a long one", () => {
    const blank = mustApply(activeGame(), WHITE, "e4", T0 + 1, "   ");
    expect(blank.moves[0]?.comment).toBeNull();
    const long = mustApply(activeGame(), WHITE, "e4", T0 + 1, "y".repeat(MAX_COMMENT_LENGTH + 40));
    expect(long.moves[0]?.comment).toHaveLength(MAX_COMMENT_LENGTH);
  });

  it("never reports negative think time", () => {
    const s = mustApply(activeGame(), WHITE, "e4", T0 - 5_000);
    expect(s.moves[0]?.thinkTimeMs).toBe(0);
  });

  it("does not mutate the previous state", () => {
    const before = activeGame();
    mustApply(before, WHITE, "e4", T0 + 1);
    expect(before.ply).toBe(0);
    expect(before.moves).toEqual([]);
    expect(before.fenHistory).toHaveLength(1);
  });
});

describe("applyMove: turn and status guards", () => {
  it("rejects a move on a game that has not started", () => {
    const created = createGame({
      id: "g1",
      whiteAgentId: WHITE,
      blackAgentId: BLACK,
      config: DEFAULT_GAME_CONFIG,
      now: T0,
    });
    expect(applyMove(created, { agentId: WHITE, ply: 0, move: "e4", now: T0 })).toMatchObject({
      ok: false,
      code: "game_not_active",
    });
  });

  it("rejects a move from an agent who is not in the game", () => {
    expect(applyMove(activeGame(), { agentId: "stranger", ply: 0, move: "e4", now: T0 })).toMatchObject({
      ok: false,
      code: "not_a_player",
    });
  });

  it("rejects black moving first", () => {
    expect(applyMove(activeGame(), { agentId: BLACK, ply: 0, move: "e5", now: T0 })).toMatchObject({
      ok: false,
      code: "not_your_turn",
    });
  });

  it("rejects a ply from the future", () => {
    expect(applyMove(activeGame(), { agentId: WHITE, ply: 2, move: "e4", now: T0 })).toMatchObject({
      ok: false,
      code: "stale_ply",
    });
  });

  it("rejects a move after the game has finished", () => {
    const mated = playLine(activeGame(), ["f3", "e5", "g4", "Qh4"]);
    expect(mated.status).toBe("finished");
    expect(applyMove(mated, { agentId: WHITE, ply: mated.ply, move: "a3", now: T0 })).toMatchObject({
      ok: false,
      code: "game_not_active",
    });
  });
});

describe("applyMove: idempotency on ply", () => {
  it("accepts a replay of the move already recorded at that ply without changing state", () => {
    const after = mustApply(activeGame(), WHITE, "e4", T0 + 1);
    const replay = applyMove(after, { agentId: WHITE, ply: 0, move: "e2e4", now: T0 + 2 });
    expect(replay).toEqual({ ok: true, idempotent: true, state: after, events: [] });
  });

  it("rejects a different move at an old ply", () => {
    const after = mustApply(activeGame(), WHITE, "e4", T0 + 1);
    expect(applyMove(after, { agentId: WHITE, ply: 0, move: "d4", now: T0 + 2 })).toMatchObject({
      ok: false,
      code: "stale_ply",
    });
  });

  it("rejects a replay by the other agent", () => {
    const after = mustApply(activeGame(), WHITE, "e4", T0 + 1);
    expect(applyMove(after, { agentId: BLACK, ply: 0, move: "e4", now: T0 + 2 })).toMatchObject({
      ok: false,
      code: "stale_ply",
    });
  });
});

describe("applyMove: illegal moves", () => {
  it("consumes one attempt and returns the legal moves", () => {
    const r = applyMove(activeGame(), { agentId: WHITE, ply: 0, move: "Nf6", now: T0 + 1 });
    expect(r.ok).toBe(false);
    if (r.ok || r.code !== "illegal_move") throw new Error("expected illegal_move");
    expect(r.reason).toBe("not_legal");
    expect(r.attemptsLeft).toBe(2);
    expect(r.legalMoves).toHaveLength(20);
    expect(r.state.status).toBe("active");
    expect(r.state.illegalAttemptsThisTurn).toBe(1);
    expect(r.state.ply).toBe(0);
    expect(r.state.moveDeadlineAt).toBe(T0 + DEFAULT_GAME_CONFIG.timePerMoveMs);
    expect(r.events).toEqual([
      { type: "illegal_attempt", color: "white", ply: 0, submitted: "Nf6", reason: "not_legal", attemptsLeft: 2 },
    ]);
  });

  it("distinguishes unparseable input", () => {
    const r = applyMove(activeGame(), { agentId: WHITE, ply: 0, move: "castle please", now: T0 + 1 });
    expect(r).toMatchObject({ ok: false, code: "illegal_move", reason: "unparseable", attemptsLeft: 2 });
  });

  it("forfeits the game on the last attempt", () => {
    let s = activeGame();
    for (let i = 0; i < 2; i += 1) {
      const r = applyMove(s, { agentId: WHITE, ply: 0, move: "Ke2", now: T0 + i });
      if (r.ok || r.code !== "illegal_move") throw new Error("expected illegal_move");
      s = r.state;
    }
    const last = applyMove(s, { agentId: WHITE, ply: 0, move: "Ke2", now: T0 + 9 });
    if (last.ok || last.code !== "illegal_move") throw new Error("expected illegal_move");
    expect(last.attemptsLeft).toBe(0);
    expect(last.state.status).toBe("finished");
    expect(last.state.result).toBe("0-1");
    expect(last.state.termination).toBe("illegal_moves");
    expect(last.state.finishedAt).toBe(T0 + 9);
    expect(last.state.moveDeadlineAt).toBeNull();
    expect(last.events).toEqual([
      { type: "illegal_attempt", color: "white", ply: 0, submitted: "Ke2", reason: "not_legal", attemptsLeft: 0 },
      { type: "ended", result: "0-1", termination: "illegal_moves", finishedAt: T0 + 9 },
    ]);
  });

  it("resets the budget after a legal move and records attempts on the move", () => {
    let s = activeGame();
    for (let i = 0; i < 2; i += 1) {
      const r = applyMove(s, { agentId: WHITE, ply: 0, move: "Ke2", now: T0 + i });
      if (r.ok || r.code !== "illegal_move") throw new Error("expected illegal_move");
      s = r.state;
    }
    const legal = mustApply(s, WHITE, "e4", T0 + 5);
    expect(legal.moves[0]?.illegalAttemptsBefore).toBe(2);
    expect(legal.illegalAttemptsThisTurn).toBe(0);
    const blackIllegal = applyMove(legal, { agentId: BLACK, ply: 1, move: "e4", now: T0 + 6 });
    expect(blackIllegal).toMatchObject({ ok: false, code: "illegal_move", attemptsLeft: 2 });
  });

  it("does not consume budget for turn or ply errors", () => {
    const s = activeGame();
    const wrongTurn = applyMove(s, { agentId: BLACK, ply: 0, move: "e5", now: T0 });
    const wrongPly = applyMove(s, { agentId: WHITE, ply: 7, move: "e4", now: T0 });
    expect(wrongTurn.state.illegalAttemptsThisTurn).toBe(0);
    expect(wrongPly.state.illegalAttemptsThisTurn).toBe(0);
  });
});

describe("applyMove: terminations", () => {
  it("ends the game on checkmate with the mover winning", () => {
    const s = playLine(activeGame(), ["f3", "e5", "g4"]);
    const r = applyMove(s, { agentId: BLACK, ply: 3, move: "Qh4#", now: T0 + 50 });
    if (!r.ok) throw new Error(r.code);
    expect(r.state.status).toBe("finished");
    expect(r.state.result).toBe("0-1");
    expect(r.state.termination).toBe("checkmate");
    expect(r.state.turnStartedAt).toBeNull();
    expect(r.state.moveDeadlineAt).toBeNull();
    expect(r.events.map((e) => e.type)).toEqual(["move", "ended"]);
  });

  it("draws by threefold repetition", () => {
    const s = playLine(activeGame(), ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1"]);
    const r = applyMove(s, { agentId: BLACK, ply: 7, move: "Ng8", now: T0 + 99 });
    if (!r.ok) throw new Error(r.code);
    expect(r.state).toMatchObject({ status: "finished", result: "1/2-1/2", termination: "threefold_repetition" });
  });

  it("draws when the move limit is reached", () => {
    const s = activeGame({ ...DEFAULT_GAME_CONFIG, moveLimitPlies: 2 });
    const afterWhite = mustApply(s, WHITE, "e4", T0 + 1);
    expect(afterWhite.status).toBe("active");
    const r = applyMove(afterWhite, { agentId: BLACK, ply: 1, move: "e5", now: T0 + 2 });
    if (!r.ok) throw new Error(r.code);
    expect(r.state).toMatchObject({ status: "finished", result: "1/2-1/2", termination: "move_limit" });
  });
});
