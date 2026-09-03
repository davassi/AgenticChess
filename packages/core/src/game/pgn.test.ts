import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_CONFIG } from "../protocol/enums.js";
import { applyMove } from "./apply-move.js";
import { createGame, startGame } from "./create.js";
import { toPgn } from "./pgn.js";
import type { GameState } from "./state.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);
const WHITE = "agent-w";
const BLACK = "agent-b";
const META = { white: "Claude Bot", black: "Llama Bot" };

function activeGame(): GameState {
  return startGame(
    createGame({ id: "g1", whiteAgentId: WHITE, blackAgentId: BLACK, config: DEFAULT_GAME_CONFIG, now: T0 }),
    T0,
  ).state;
}

function play(state: GameState, moves: Array<{ san: string; comment?: string }>): GameState {
  let s = state;
  let now = T0 + 1_000;
  for (const m of moves) {
    const agent = s.ply % 2 === 0 ? WHITE : BLACK;
    const r = applyMove(s, { agentId: agent, ply: s.ply, move: m.san, comment: m.comment, now });
    if (!r.ok) throw new Error(`setup move rejected: ${m.san} -> ${r.code}`);
    s = r.state;
    now += 1_000;
  }
  return s;
}

describe("toPgn", () => {
  it("writes the tag roster for a finished game", () => {
    const s = play(activeGame(), [{ san: "f3" }, { san: "e5" }, { san: "g4" }, { san: "Qh4" }]);
    const pgn = toPgn(s, META);
    expect(pgn).toContain('[Event "aichess rated game"]');
    expect(pgn).toContain('[Site "aichess"]');
    expect(pgn).toContain('[Date "2026.09.03"]');
    expect(pgn).toContain('[Round "-"]');
    expect(pgn).toContain('[White "Claude Bot"]');
    expect(pgn).toContain('[Black "Llama Bot"]');
    expect(pgn).toContain('[Result "0-1"]');
    expect(pgn).toContain('[Termination "checkmate"]');
    expect(pgn).toContain('[TimePerMoveMs "60000"]');
    expect(pgn).toContain("1. f3 e5 2. g4 Qh4#");
  });

  it("places agent comments after their move", () => {
    const s = play(activeGame(), [{ san: "e4", comment: "Centre." }, { san: "e5" }, { san: "Nf3", comment: "Develop." }]);
    const pgn = toPgn(s, META);
    expect(pgn).toContain("1. e4 {Centre.} e5 2. Nf3 {Develop.}");
  });

  it("sanitises braces and newlines inside comments", () => {
    const s = play(activeGame(), [{ san: "e4", comment: "a}b\nc" }]);
    expect(toPgn(s, META)).toContain("{a)b c}");
  });

  it("marks an unfinished game with an asterisk", () => {
    const s = play(activeGame(), [{ san: "d4" }]);
    const pgn = toPgn(s, META);
    expect(pgn).toContain('[Result "*"]');
    expect(pgn).not.toContain("[Termination");
  });

  it("handles a game with no moves", () => {
    const pgn = toPgn(activeGame(), META);
    expect(pgn).toContain('[Result "*"]');
    expect(pgn).toContain('[White "Claude Bot"]');
  });

  it("uses the supplied date and event when given", () => {
    const pgn = toPgn(activeGame(), { ...META, event: "Test Cup", date: new Date(Date.UTC(2030, 0, 15)) });
    expect(pgn).toContain('[Event "Test Cup"]');
    expect(pgn).toContain('[Date "2030.01.15"]');
  });
});
