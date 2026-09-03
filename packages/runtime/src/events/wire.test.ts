import { randomUUID } from "node:crypto";
import { applyMove, applyResign, createGame, startGame, type DomainEvent, type GameState } from "@aichess/core";
import { DEFAULT_GAME_CONFIG, WireEventSchema, type WireEvent } from "@aichess/core/protocol";
import { describe, expect, it } from "vitest";
import { toSnapshot, toWireEvents, type GameAgents, type Outgoing } from "./wire.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);
const agents: GameAgents = {
  white: { id: randomUUID(), name: "Alpha", slug: "alpha", modelProvider: "anthropic", modelName: "claude-sonnet-5" },
  black: { id: randomUUID(), name: "Beta", slug: "beta", modelProvider: "openai", modelName: "gpt-5" },
};
const NO_RATINGS = { white: null, black: null };

function created(): GameState {
  return createGame({
    id: randomUUID(),
    whiteAgentId: agents.white.id,
    blackAgentId: agents.black.id,
    config: DEFAULT_GAME_CONFIG,
    now: T0,
  });
}

function validate(out: Outgoing): void {
  for (const list of [out.toWhite, out.toBlack, out.toPublic]) {
    for (const event of list) WireEventSchema.parse(event);
  }
}

function types(list: WireEvent[]): string[] {
  return list.map((e) => e.type);
}

describe("toWireEvents", () => {
  it("maps the start of a game", () => {
    const { state, events } = startGame(created(), T0);
    const out = toWireEvents(state, agents, events, { pgn: null, ratings: NO_RATINGS });
    validate(out);
    expect(types(out.toWhite)).toEqual(["game.start", "game.your_turn"]);
    expect(types(out.toBlack)).toEqual(["game.start"]);
    expect(types(out.toPublic)).toEqual(["game.turn"]);

    const start = out.toWhite[0];
    if (start?.type !== "game.start") throw new Error("expected game.start");
    expect(start).toEqual({
      type: "game.start",
      gameId: state.id,
      color: "white",
      opponent: agents.black,
      timePerMoveMs: 60_000,
      startedAt: new Date(T0).toISOString(),
    });
    const blackStart = out.toBlack[0];
    if (blackStart?.type !== "game.start") throw new Error("expected game.start");
    expect(blackStart.color).toBe("black");
    expect(blackStart.opponent).toEqual(agents.white);

    const turn = out.toWhite[1];
    if (turn?.type !== "game.your_turn") throw new Error("expected game.your_turn");
    expect(turn.ply).toBe(0);
    expect(turn.history).toEqual([]);
    expect(turn.lastMove).toBeNull();
    expect(turn.legalMoves).toHaveLength(20);
    expect(turn.deadlineAt).toBe(new Date(T0 + 60_000).toISOString());
    expect(turn.attemptsLeft).toBe(3);

    expect(out.toPublic[0]).toEqual({
      type: "game.turn",
      gameId: state.id,
      color: "white",
      ply: 0,
      deadlineAt: new Date(T0 + 60_000).toISOString(),
    });
  });

  it("maps a legal move to everyone and the next turn to black", () => {
    const started = startGame(created(), T0).state;
    const r = applyMove(started, { agentId: agents.white.id, ply: 0, move: "e4", comment: "Centre.", now: T0 + 2_000 });
    if (!r.ok) throw new Error(r.code);
    const out = toWireEvents(r.state, agents, r.events, { pgn: null, ratings: NO_RATINGS });
    validate(out);
    expect(types(out.toWhite)).toEqual(["game.move"]);
    expect(types(out.toBlack)).toEqual(["game.move", "game.your_turn"]);
    expect(types(out.toPublic)).toEqual(["game.move", "game.turn"]);

    const move = out.toPublic[0];
    if (move?.type !== "game.move") throw new Error("expected game.move");
    expect(move).toEqual({
      type: "game.move",
      gameId: r.state.id,
      ply: 1,
      color: "white",
      san: "e4",
      uci: "e2e4",
      fen: r.state.fen,
      comment: "Centre.",
      thinkTimeMs: 2_000,
    });

    const turn = out.toBlack[1];
    if (turn?.type !== "game.your_turn") throw new Error("expected game.your_turn");
    expect(turn.ply).toBe(1);
    expect(turn.history).toEqual(["e4"]);
    expect(turn.lastMove).toEqual({ san: "e4", uci: "e2e4" });
    expect(turn.fen).toBe(r.state.fen);
    expect(turn.legalMoves.map((m) => m.san)).toContain("e5");
  });

  it("maps an illegal attempt to the public only", () => {
    const started = startGame(created(), T0).state;
    const r = applyMove(started, { agentId: agents.white.id, ply: 0, move: "Nf6", now: T0 + 1 });
    if (r.ok || r.code !== "illegal_move") throw new Error("expected illegal_move");
    const out = toWireEvents(r.state, agents, r.events, { pgn: null, ratings: NO_RATINGS });
    validate(out);
    expect(out.toWhite).toEqual([]);
    expect(out.toBlack).toEqual([]);
    expect(out.toPublic).toEqual([
      {
        type: "game.illegal_attempt",
        gameId: r.state.id,
        color: "white",
        ply: 0,
        submitted: "Nf6",
        reason: "not_legal",
        attemptsLeft: 2,
      },
    ]);
  });

  it("maps the end of a game with per-agent ratings and a public null", () => {
    const started = startGame(created(), T0).state;
    const r = applyResign(started, agents.black.id, T0 + 5_000);
    if (!r.ok) throw new Error(r.code);
    const ratings = { white: { before: 1500, after: 1650 }, black: { before: 1500, after: 1350 } };
    const out = toWireEvents(r.state, agents, r.events, { pgn: '[Event "x"]\n\n*', ratings });
    validate(out);
    const expectedBase = {
      type: "game.end",
      gameId: r.state.id,
      result: "1-0",
      termination: "resignation",
      pgn: '[Event "x"]\n\n*',
    };
    expect(out.toWhite).toEqual([{ ...expectedBase, rating: ratings.white }]);
    expect(out.toBlack).toEqual([{ ...expectedBase, rating: ratings.black }]);
    expect(out.toPublic).toEqual([{ ...expectedBase, rating: null }]);
  });

  it("falls back to an empty pgn when none is supplied for an ended game", () => {
    const started = startGame(created(), T0).state;
    const r = applyResign(started, agents.white.id, T0 + 5_000);
    if (!r.ok) throw new Error(r.code);
    const out = toWireEvents(r.state, agents, r.events, { pgn: null, ratings: NO_RATINGS });
    const end = out.toPublic[0];
    if (end?.type !== "game.end") throw new Error("expected game.end");
    expect(end.pgn).toBe("");
  });

  it("ignores events it does not know how to route", () => {
    const state = startGame(created(), T0).state;
    const unknown = { type: "mystery" } as unknown as DomainEvent;
    const out = toWireEvents(state, agents, [unknown], { pgn: null, ratings: NO_RATINGS });
    expect(out).toEqual({ toWhite: [], toBlack: [], toPublic: [] });
  });
});

describe("toSnapshot", () => {
  it("serialises timestamps as ISO strings and history as SAN", () => {
    const started = startGame(created(), T0).state;
    const r = applyMove(started, { agentId: agents.white.id, ply: 0, move: "d4", now: T0 + 1_000 });
    if (!r.ok) throw new Error(r.code);
    const snapshot = toSnapshot(r.state, agents);
    expect(snapshot).toEqual({
      id: r.state.id,
      status: "active",
      white: agents.white,
      black: agents.black,
      config: DEFAULT_GAME_CONFIG,
      fen: r.state.fen,
      ply: 1,
      history: ["d4"],
      turn: "black",
      moveDeadlineAt: new Date(T0 + 1_000 + 60_000).toISOString(),
      result: null,
      termination: null,
      startedAt: new Date(T0).toISOString(),
      finishedAt: null,
    });
  });

  it("adds legal moves and attempts only for the viewer on move", () => {
    const started = startGame(created(), T0).state;
    const forWhite = toSnapshot(started, agents, agents.white.id);
    expect(forWhite.legalMoves).toHaveLength(20);
    expect(forWhite.attemptsLeft).toBe(3);
    const forBlack = toSnapshot(started, agents, agents.black.id);
    expect(forBlack.legalMoves).toBeUndefined();
    expect(forBlack.attemptsLeft).toBeUndefined();
    const forStranger = toSnapshot(started, agents, randomUUID());
    expect(forStranger.legalMoves).toBeUndefined();
  });

  it("never adds legal moves to a finished game", () => {
    const started = startGame(created(), T0).state;
    const r = applyResign(started, agents.black.id, T0 + 5);
    if (!r.ok) throw new Error(r.code);
    const snapshot = toSnapshot(r.state, agents, agents.white.id);
    expect(snapshot.status).toBe("finished");
    expect(snapshot.legalMoves).toBeUndefined();
    expect(snapshot.finishedAt).toBe(new Date(T0 + 5).toISOString());
  });
});

describe("toYourTurn", () => {
  it("builds the event for the side to move from the state alone", async () => {
    const { toYourTurn } = await import("./wire.js");
    const started = startGame(created(), T0);
    const bad = applyMove(started.state, { agentId: agents.white.id, ply: 0, move: "Ke2", now: T0 + 1 });
    if (bad.ok || bad.code !== "illegal_move") throw new Error("expected illegal_move");
    const event = toYourTurn(bad.state, "white");
    expect(event).toEqual({
      type: "game.your_turn",
      gameId: bad.state.id,
      ply: 0,
      fen: bad.state.fen,
      history: [],
      lastMove: null,
      legalMoves: expect.arrayContaining([{ san: "e4", uci: "e2e4" }]),
      deadlineAt: new Date(T0 + 60_000).toISOString(),
      attemptsLeft: 2,
    });
    expect(toYourTurn(bad.state, "black")).toBeNull();
  });

  it("returns null for a finished game", async () => {
    const { toYourTurn } = await import("./wire.js");
    const started = startGame(created(), T0).state;
    const r = applyResign(started, agents.black.id, T0 + 5);
    if (!r.ok) throw new Error(r.code);
    expect(toYourTurn(r.state, "white")).toBeNull();
  });
});
