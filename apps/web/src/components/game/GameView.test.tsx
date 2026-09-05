import type { GameSnapshot, TimelineMove } from "@aichess/core/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveGame } from "@/lib/live";
import { GameView } from "./GameView";

const AGENT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "opusbot",
  slug: "opusbot",
  modelProvider: "Anthropic",
  modelName: "claude-opus-5",
  isHouse: false,
};

const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
const AFTER_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

const SNAPSHOT: GameSnapshot = {
  id: "22222222-2222-4222-8222-222222222222",
  status: "active",
  white: AGENT,
  black: { ...AGENT, id: "33333333-3333-4333-8333-333333333333", slug: "tal-turbo", name: "tal-turbo" },
  config: { timePerMoveMs: 60_000, moveLimitPlies: 300, illegalAttemptsPerTurn: 3, rated: true },
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

const E5: TimelineMove = {
  ply: 2,
  color: "black",
  san: "e5",
  uci: "e7e5",
  fen: AFTER_E5,
  comment: null,
  thinkTimeMs: 1_200,
  at: "2026-09-04T10:00:20.000Z",
};

class SilentEventSource {
  addEventListener(): void {}
  close(): void {}
}

function draw(initial: LiveGame): HTMLElement {
  vi.stubGlobal("EventSource", SilentEventSource);
  return render(<GameView initial={initial} apiPublicUrl="http://api.test" />).container;
}

describe("GameView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replays the moves when the list and the snapshot agree, so the pieces keep their identity", () => {
    const container = draw({ snapshot: SNAPSHOT, moves: [E4], attempts: [], finished: false, gap: false });
    // The pawn now on e4 is still the one that started on e2: that identity is
    // what makes React move the same node and the CSS slide it.
    expect(container.querySelector('[data-piece-id="e2"]')?.getAttribute("style")).toContain("translate(400%, 400%)");
    expect(container.querySelectorAll(".piece")).toHaveLength(32);
  });

  it("draws the snapshot's own position when a move is missing from the list", () => {
    // A move played between the server render and the subscription is only in
    // the snapshot, and the state says so. Replaying the shorter list would
    // show a board one move behind the header, the clock and the result.
    const container = draw({
      snapshot: { ...SNAPSHOT, fen: AFTER_E5, ply: 2, history: ["e4", "e5"], turn: "white" },
      moves: [E4],
      attempts: [],
      finished: false,
      gap: true,
    });
    expect(container.querySelector('[data-piece-id="e5"]')).not.toBeNull();
    expect(container.querySelector('[data-piece-id="e7"]')).toBeNull();
  });
});

describe("what the viewer is allowed to see", () => {
  function twoMoves(overrides: Partial<LiveGame> = {}): LiveGame {
    return {
      snapshot: { ...SNAPSHOT, fen: AFTER_E5, ply: 2, history: ["e4", "e5"], turn: "white" },
      moves: [
        { ...E4, comment: "solid" },
        { ...E5, comment: "the losing move" },
      ],
      attempts: [],
      finished: false,
      gap: false,
      ...overrides,
    };
  }

  // Clicking a move is how a viewer parks the cursor behind the live edge,
  // which is the state every rule below is about.
  async function park(container: HTMLElement): Promise<void> {
    await userEvent.click(screen.getByRole("button", { name: "e4" }));
    expect(container.querySelector(".moves .is-current")).toHaveTextContent("e4");
  }

  it("counts the plies the viewer has seen, not the ones the server has", async () => {
    const container = draw(twoMoves());
    expect(container.textContent).toContain("2 plies");
    await park(container);
    expect(container.textContent).toContain("1 plies");
    expect(container.textContent).not.toContain("2 plies");
  });

  it("does not print a comment the viewer has not reached", async () => {
    const container = draw(twoMoves());
    expect(container.textContent).toContain("the losing move");
    await park(container);
    expect(container.textContent).toContain("solid");
    expect(container.textContent).not.toContain("the losing move");
  });

  it("trims a live game's move list to the cursor", async () => {
    const container = draw(twoMoves());
    expect(container.querySelectorAll(".moves button")).toHaveLength(2);
    await park(container);
    expect(container.querySelectorAll(".moves button")).toHaveLength(1);
  });

  it("keeps the result panel closed until the cursor arrives at the end", async () => {
    const finished = twoMoves({
      snapshot: {
        ...SNAPSHOT,
        status: "finished",
        fen: AFTER_E5,
        ply: 2,
        history: ["e4", "e5"],
        result: "1-0",
        termination: "checkmate",
      },
      finished: true,
    });
    const container = draw(finished);
    expect(container.textContent).toContain("1-0");

    await park(container);
    expect(container.textContent).not.toContain("1-0");
    expect(container.textContent).toContain("Live");
  });

  // A score sheet is a record and the outcome is already known, so unlike the
  // comments it is not trimmed once the game is over.
  it("keeps the whole score sheet of a finished game while replaying it", async () => {
    const container = draw(twoMoves({ finished: true }));
    await park(container);
    expect(container.querySelectorAll(".moves button")).toHaveLength(2);
  });

  it("flashes the square of a rejected move at the ply it belongs to", () => {
    const container = draw({
      snapshot: { ...SNAPSHOT, fen: AFTER_E4, ply: 1, history: ["e4"] },
      moves: [E4],
      // The attempt carries the ply count before the move it was rejected
      // for, so this one belongs to the board after ply 1.
      attempts: [{ ply: 0, color: "white", submitted: "e2e5", reason: "not_legal", at: "2026-09-04T10:00:05.000Z" }],
      finished: false,
      gap: false,
    });
    expect(container.querySelector(".mark--illegal")).not.toBeNull();
  });
});

describe("the end of a finished game", () => {
  function finished(): LiveGame {
    return {
      snapshot: {
        ...SNAPSHOT,
        fen: AFTER_E5,
        ply: 2,
        history: ["e4", "e5"],
        turn: "white",
        status: "finished",
        result: "1-0",
        termination: "checkmate",
        finishedAt: "2026-09-04T10:00:30.000Z",
      },
      moves: [E4, E5],
      attempts: [],
      finished: true,
      gap: false,
    };
  }

  it("offers a way to watch the game again", async () => {
    // The result panel covers the whole frame, transport included, so the
    // controls underneath it cannot be clicked: without this button a finished
    // game can only be left, never replayed.
    const container = draw(finished());
    expect(container.querySelector(".result")).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /replay/i }));

    // Rewinding to the start is what lifts the panel: the viewer is no longer
    // at the end of the game.
    expect(container.querySelector(".result")).toBeNull();
    expect(container.textContent).toContain("0 plies");
  });

  it("keeps the exits it already had", () => {
    draw(finished());
    expect(screen.getByRole("link", { name: /pgn/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /archive/i })).toBeInTheDocument();
  });
});
