import type { GameSnapshot } from "@aichess/core/protocol";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLiveBoard } from "./useLiveBoard";

const AGENT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "opusbot",
  slug: "opusbot",
  modelProvider: "Anthropic",
  modelName: "claude-opus-5",
};

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

const SNAPSHOT: GameSnapshot = {
  id: "22222222-2222-4222-8222-222222222222",
  status: "active",
  white: AGENT,
  black: { ...AGENT, id: "33333333-3333-4333-8333-333333333333", slug: "tal-turbo", name: "tal-turbo" },
  config: { timePerMoveMs: 60_000, moveLimitPlies: 300, illegalAttemptsPerTurn: 3 },
  fen: START,
  ply: 0,
  history: [],
  turn: "white",
  moveDeadlineAt: null,
  result: null,
  termination: null,
  startedAt: "2026-09-04T10:00:00.000Z",
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

describe("useLiveBoard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.last = null;
  });

  function open(active = true): ReturnType<typeof renderHook<ReturnType<typeof useLiveBoard>, unknown>> {
    vi.stubGlobal("EventSource", FakeEventSource);
    return renderHook(() => useLiveBoard("http://api.test/stream", START, active));
  }

  it("follows the position on the stream", () => {
    const { result } = open();
    act(() => {
      FakeEventSource.last?.emit("game.move", {
        type: "game.move",
        gameId: SNAPSHOT.id,
        ply: 1,
        color: "white",
        san: "e4",
        uci: "e2e4",
        fen: AFTER_E4,
        comment: null,
        thinkTimeMs: 1_000,
      });
    });
    expect(result.current).toMatchObject({ fen: AFTER_E4, active: true });
  });

  it("stops calling the game live once it ends", () => {
    const { result } = open();
    act(() => {
      FakeEventSource.last?.emit("game.end", {
        type: "game.end",
        gameId: SNAPSHOT.id,
        result: "1-0",
        termination: "checkmate",
        pgn: "",
        rating: null,
      });
    });
    expect(result.current.active).toBe(false);
    expect(FakeEventSource.last?.closed).toBe(true);
  });

  it("closes a stream that opens onto a game already over", () => {
    // The API sends this snapshot and closes the connection without a
    // game.end; a source left open reconnects to it for ever.
    const { result } = open();
    act(() => {
      FakeEventSource.last?.emit("game.snapshot", {
        type: "game.snapshot",
        game: { ...SNAPSHOT, status: "finished", result: "1-0", termination: "checkmate", fen: AFTER_E4 },
      });
    });
    expect(result.current).toMatchObject({ fen: AFTER_E4, active: false });
    expect(FakeEventSource.last?.closed).toBe(true);
  });

  it("never opens a stream for a game that was over before the page was drawn", () => {
    open(false);
    expect(FakeEventSource.last).toBeNull();
  });

  it("moves the piece rather than redrawing the board, so the card can animate", () => {
    const { result } = open();
    expect(result.current.position.get("e2")?.id).toBe("e2");

    act(() => {
      FakeEventSource.last?.emit("game.move", {
        type: "game.move",
        gameId: SNAPSHOT.id,
        ply: 1,
        color: "white",
        san: "e4",
        uci: "e2e4",
        fen: AFTER_E4,
        comment: null,
        thinkTimeMs: 900,
      });
    });

    expect(result.current.fen).toBe(AFTER_E4);
    expect(result.current.position.get("e4")).toEqual({ id: "e2", kind: "w-pawn", square: "e4" });
    expect(result.current.position.get("e2")).toBeUndefined();
  });

  it("keeps the identities it can when a snapshot replaces the position wholesale", () => {
    const { result } = open();
    act(() => {
      FakeEventSource.last?.emit("game.snapshot", {
        type: "game.snapshot",
        gameId: SNAPSHOT.id,
        game: { ...SNAPSHOT, fen: AFTER_E4, ply: 1, turn: "black" },
      });
    });
    expect(result.current.position.get("e4")?.id).toBe("e2");
  });

  // A move the position cannot apply would leave the card drawing a board the
  // FEN disagrees with, which is worse than losing the animation for one ply.
  it("falls back to the FEN when the move does not fit the position it holds", () => {
    const { result } = open();
    act(() => {
      FakeEventSource.last?.emit("game.move", {
        type: "game.move",
        gameId: SNAPSHOT.id,
        ply: 1,
        color: "white",
        san: "e4",
        uci: "a6a7",
        fen: AFTER_E4,
        comment: null,
        thinkTimeMs: 900,
      });
    });
    // The FEN won: the pawn is on e4 and e2 is empty, which is what the card
    // must draw whatever the move event claimed.
    expect(result.current.position.get("e4")?.kind).toBe("w-pawn");
    expect(result.current.position.get("e2")).toBeUndefined();
  });
});
