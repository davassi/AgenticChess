import type { GameSnapshot } from "@aichess/core/protocol";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveGame } from "@/lib/live";
import { useGameStream } from "./useGameStream";

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

const LIVE: LiveGame = { snapshot: SNAPSHOT, moves: [], attempts: [], finished: false };

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

describe("useGameStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.last = null;
  });

  function useFakeSource(): void {
    vi.stubGlobal("EventSource", FakeEventSource);
  }

  it("applies the moves that arrive on the stream", () => {
    useFakeSource();
    const { result } = renderHook(() => useGameStream("http://api.test/stream", LIVE));
    act(() => {
      FakeEventSource.last?.emit("game.move", {
        type: "game.move",
        gameId: SNAPSHOT.id,
        ply: 1,
        color: "white",
        san: "e4",
        uci: "e2e4",
        fen: SNAPSHOT.fen,
        comment: null,
        thinkTimeMs: 1_000,
      });
    });
    expect(result.current.moves).toHaveLength(1);
    expect(result.current.snapshot.ply).toBe(1);
  });

  it("closes the stream on game.end so the browser does not reconnect for ever", () => {
    useFakeSource();
    renderHook(() => useGameStream("http://api.test/stream", LIVE));
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
    expect(FakeEventSource.last?.closed).toBe(true);
  });

  it("never opens a stream for a game that is already over", () => {
    useFakeSource();
    renderHook(() => useGameStream("http://api.test/stream", { ...LIVE, finished: true }));
    expect(FakeEventSource.last).toBeNull();
  });

  it("closes the stream when the page goes away", () => {
    useFakeSource();
    const { unmount } = renderHook(() => useGameStream("http://api.test/stream", LIVE));
    unmount();
    expect(FakeEventSource.last?.closed).toBe(true);
  });

  it("ignores a frame that is not a wire event", () => {
    useFakeSource();
    const { result } = renderHook(() => useGameStream("http://api.test/stream", LIVE));
    act(() => {
      FakeEventSource.last?.emit("game.move", { type: "game.move", nonsense: true });
      FakeEventSource.last?.listeners.get("ping")?.(new MessageEvent("ping", { data: "not json" }));
    });
    expect(result.current).toEqual(LIVE);
  });
});
