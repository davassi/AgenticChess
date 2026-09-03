import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_CONFIG, NETWORK_GRACE_MS } from "../protocol/enums.js";
import { applyMove } from "./apply-move.js";
import { createGame, startGame } from "./create.js";
import { applyResign, applyTimeout } from "./end.js";
import type { GameState } from "./state.js";

const T0 = 1_000_000;
const WHITE = "agent-w";
const BLACK = "agent-b";
const DEADLINE = T0 + DEFAULT_GAME_CONFIG.timePerMoveMs;

function activeGame(): GameState {
  return startGame(
    createGame({ id: "g1", whiteAgentId: WHITE, blackAgentId: BLACK, config: DEFAULT_GAME_CONFIG, now: T0 }),
    T0,
  ).state;
}

function playLine(state: GameState, sans: string[]): GameState {
  let s = state;
  let now = T0 + 1_000;
  for (const san of sans) {
    const agent = s.ply % 2 === 0 ? WHITE : BLACK;
    const r = applyMove(s, { agentId: agent, ply: s.ply, move: san, now });
    if (!r.ok) throw new Error(`setup move rejected: ${san} -> ${r.code}`);
    s = r.state;
    now += 1_000;
  }
  return s;
}

describe("applyTimeout", () => {
  it("refuses to fire before the deadline plus grace", () => {
    const s = activeGame();
    expect(applyTimeout(s, DEADLINE)).toMatchObject({ ok: false, code: "deadline_not_reached" });
    expect(applyTimeout(s, DEADLINE + NETWORK_GRACE_MS - 1)).toMatchObject({ ok: false, code: "deadline_not_reached" });
  });

  it("aborts a game where white never moved", () => {
    const now = DEADLINE + NETWORK_GRACE_MS;
    const r = applyTimeout(activeGame(), now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state).toMatchObject({
      status: "aborted",
      result: "*",
      termination: "aborted",
      finishedAt: now,
      moveDeadlineAt: null,
    });
    expect(r.events).toEqual([{ type: "ended", result: "*", termination: "aborted", finishedAt: now }]);
  });

  it("aborts a game where black never answered the first move", () => {
    const s = playLine(activeGame(), ["e4"]);
    const now = (s.moveDeadlineAt ?? 0) + NETWORK_GRACE_MS;
    const r = applyTimeout(s, now);
    if (!r.ok) throw new Error(r.code);
    expect(r.state).toMatchObject({ status: "aborted", result: "*", termination: "aborted" });
  });

  it("makes the side to move lose once both have played", () => {
    const s = playLine(activeGame(), ["e4", "e5"]);
    const now = (s.moveDeadlineAt ?? 0) + NETWORK_GRACE_MS;
    const r = applyTimeout(s, now);
    if (!r.ok) throw new Error(r.code);
    expect(r.state).toMatchObject({ status: "finished", result: "0-1", termination: "timeout", finishedAt: now });
    expect(r.events).toEqual([{ type: "ended", result: "0-1", termination: "timeout", finishedAt: now }]);
  });

  it("is a no-op on a game that is not active", () => {
    const s = playLine(activeGame(), ["f3", "e5", "g4", "Qh4"]);
    expect(applyTimeout(s, T0 + 10_000_000)).toMatchObject({ ok: false, code: "game_not_active" });
  });
});

describe("applyResign", () => {
  it("gives the win to the opponent, even before two plies", () => {
    const r = applyResign(activeGame(), BLACK, T0 + 5);
    if (!r.ok) throw new Error(r.code);
    expect(r.state).toMatchObject({
      status: "finished",
      result: "1-0",
      termination: "resignation",
      finishedAt: T0 + 5,
    });
    expect(r.events).toEqual([{ type: "ended", result: "1-0", termination: "resignation", finishedAt: T0 + 5 }]);
  });

  it("lets the side not on move resign", () => {
    const s = playLine(activeGame(), ["e4"]);
    const r = applyResign(s, WHITE, T0 + 5_000);
    if (!r.ok) throw new Error(r.code);
    expect(r.state.result).toBe("0-1");
  });

  it("rejects an agent who is not in the game", () => {
    expect(applyResign(activeGame(), "stranger", T0)).toMatchObject({ ok: false, code: "not_a_player" });
  });

  it("rejects resignation of a finished game", () => {
    const s = playLine(activeGame(), ["f3", "e5", "g4", "Qh4"]);
    expect(applyResign(s, WHITE, T0)).toMatchObject({ ok: false, code: "game_not_active" });
  });
});
