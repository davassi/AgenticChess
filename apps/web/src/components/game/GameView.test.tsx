import type { GameSnapshot, TimelineMove } from "@aichess/core/protocol";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveGame } from "@/lib/live";
import { GameView } from "./GameView";

const AGENT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "opusbot",
  slug: "opusbot",
  modelProvider: "Anthropic",
  modelName: "claude-opus-5",
};

const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
const AFTER_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

const SNAPSHOT: GameSnapshot = {
  id: "22222222-2222-4222-8222-222222222222",
  status: "active",
  white: AGENT,
  black: { ...AGENT, id: "33333333-3333-4333-8333-333333333333", slug: "tal-turbo", name: "tal-turbo" },
  config: { timePerMoveMs: 60_000, moveLimitPlies: 300, illegalAttemptsPerTurn: 3 },
  fen: AFTER_E4,
  ply: 1,
  history: ["e4"],
  turn: "black",
  moveDeadlineAt: null,
  result: null,
  termination: null,
  startedAt: "2026-09-04T10:00:00.000Z",
  finishedAt: null,
};

const E4: TimelineMove = {
  ply: 1,
  color: "white",
  san: "e4",
  uci: "e2e4",
  fen: AFTER_E4,
  comment: null,
  thinkTimeMs: 1_000,
  at: "2026-09-04T10:00:10.000Z",
};

class SilentEventSource {
  addEventListener(): void {}
  close(): void {}
}

describe("GameView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function draw(initial: LiveGame): HTMLElement {
    vi.stubGlobal("EventSource", SilentEventSource);
    return render(<GameView initial={initial} apiPublicUrl="http://api.test" />).container;
  }

  it("replays the moves when the list and the snapshot agree, so the pieces keep their identity", () => {
    const container = draw({ snapshot: SNAPSHOT, moves: [E4], attempts: [], finished: false });
    // The pawn now on e4 is still the one that started on e2: that identity is
    // what makes React move the same node and the CSS slide it.
    expect(container.querySelector('[data-piece-id="e2"]')?.getAttribute("style")).toContain("translate(400%, 400%)");
    expect(container.querySelectorAll(".piece")).toHaveLength(32);
  });

  it("draws the snapshot's own position when a move is missing from the list", () => {
    // A move played between the server render and the subscription is only in
    // the snapshot. Replaying the shorter list would show a board one move
    // behind the header, the clock and the result.
    const container = draw({
      snapshot: { ...SNAPSHOT, fen: AFTER_E5, ply: 2, history: ["e4", "e5"], turn: "white" },
      moves: [E4],
      attempts: [],
      finished: false,
    });
    expect(container.querySelector('[data-piece-id="e5"]')).not.toBeNull();
    expect(container.querySelector('[data-piece-id="e7"]')).toBeNull();
  });
});
