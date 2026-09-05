import type { GameListItem } from "@aichess/core/protocol";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveBoardCard } from "./LiveBoardCard";

const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

const GAME: GameListItem = {
  id: "22222222-2222-4222-8222-222222222222",
  status: "active",
  rated: true,
  white: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "opusbot",
    slug: "opusbot",
    modelProvider: "Anthropic",
    modelName: "claude-opus-5",
    isHouse: false,
  },
  black: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "tal-turbo",
    slug: "tal-turbo",
    modelProvider: "OpenAI",
    modelName: "gpt-5",
    isHouse: false,
  },
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  ply: 0,
  turn: "white",
  result: null,
  termination: null,
  moveDeadlineAt: null,
  createdAt: "2026-09-04T09:00:00.000Z",
  startedAt: "2026-09-04T09:00:00.000Z",
  finishedAt: null,
};

class FakeEventSource {
  static last: FakeEventSource | null = null;
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }

  addEventListener(name: string, handler: (event: MessageEvent<string>) => void): void {
    this.listeners.set(name, handler);
  }

  close(): void {
    this.closed = true;
  }

  emit(name: string, data: unknown): void {
    this.listeners.get(name)?.(new MessageEvent(name, { data: JSON.stringify(data) }));
  }
}

describe("LiveBoardCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.last = null;
  });

  function draw(): void {
    vi.stubGlobal("EventSource", FakeEventSource);
    render(<LiveBoardCard game={GAME} apiPublicUrl="http://api.test" />);
  }

  it("turns the board over to the other side as the moves arrive", () => {
    // The side to move is read from the streamed FEN: the list item's `turn`
    // is only true of the position the page was rendered with.
    draw();
    expect(screen.getByText(/White to move/)).toBeInTheDocument();
    act(() => {
      FakeEventSource.last?.emit("game.move", {
        type: "game.move",
        gameId: GAME.id,
        ply: 1,
        color: "white",
        san: "e4",
        uci: "e2e4",
        fen: AFTER_E4,
        comment: null,
        thinkTimeMs: 1_000,
      });
    });
    expect(screen.getByText(/Black to move/)).toBeInTheDocument();
  });

  it("drops the live badge when the game ends under the visitor's eyes", () => {
    draw();
    expect(screen.getByText("live")).toBeInTheDocument();
    act(() => {
      FakeEventSource.last?.emit("game.end", {
        type: "game.end",
        gameId: GAME.id,
        result: "1-0",
        termination: "checkmate",
        pgn: "",
        rating: null,
      });
    });
    expect(screen.queryByText("live")).toBeNull();
    expect(screen.getByText(/Game over/)).toBeInTheDocument();
  });
});
