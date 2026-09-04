import type { GameSnapshot, TimelineMove } from "@aichess/core/protocol";
import { act, renderHook, waitFor } from "@testing-library/react";
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

const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

const LIVE: LiveGame = { snapshot: SNAPSHOT, moves: [], attempts: [], finished: false, gap: false };

const E4_TIMELINE_MOVE: TimelineMove = {
  ply: 1,
  color: "white",
  san: "e4",
  uci: "e2e4",
  fen: AFTER_E4,
  comment: null,
  thinkTimeMs: 900,
  at: "2026-09-04T10:00:10.000Z",
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
    const { result } = renderHook(() => useGameStream("http://api.test/stream", "https://api.test", LIVE));
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
    renderHook(() => useGameStream("http://api.test/stream", "https://api.test", LIVE));
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

  it("closes a stream that opens onto a game finished a moment ago", () => {
    // The game ended between the server render and the subscription: the API
    // sends this snapshot and closes without a game.end, and a source left
    // open reconnects to it for ever.
    useFakeSource();
    const { result } = renderHook(() => useGameStream("http://api.test/stream", "https://api.test", LIVE));
    act(() => {
      FakeEventSource.last?.emit("game.snapshot", {
        type: "game.snapshot",
        game: { ...SNAPSHOT, status: "finished", result: "1-0", termination: "checkmate" },
      });
    });
    expect(result.current.finished).toBe(true);
    expect(FakeEventSource.last?.closed).toBe(true);
  });

  it("never opens a stream for a game that is already over", () => {
    useFakeSource();
    renderHook(() => useGameStream("http://api.test/stream", "https://api.test", { ...LIVE, finished: true }));
    expect(FakeEventSource.last).toBeNull();
  });

  it("closes the stream when the page goes away", () => {
    useFakeSource();
    const { unmount } = renderHook(() => useGameStream("http://api.test/stream", "https://api.test", LIVE));
    unmount();
    expect(FakeEventSource.last?.closed).toBe(true);
  });

  it("starts again when the visitor walks to another game", () => {
    // Next reuses the page component across /games/[id] navigations, so the
    // hook is handed a new `initial` without being remounted.
    useFakeSource();
    const other: LiveGame = {
      ...LIVE,
      snapshot: { ...SNAPSHOT, id: "44444444-4444-4444-8444-444444444444", ply: 0 },
    };
    const { result, rerender } = renderHook(
      ({ game }: { game: LiveGame }) => useGameStream("http://api.test/a", "https://api.test", game),
      {
        initialProps: { game: LIVE },
      },
    );
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

    rerender({ game: other });
    expect(result.current.snapshot.id).toBe(other.snapshot.id);
    expect(result.current.moves).toEqual([]);

    act(() => {
      FakeEventSource.last?.emit("game.move", {
        type: "game.move",
        gameId: other.snapshot.id,
        ply: 1,
        color: "white",
        san: "d4",
        uci: "d2d4",
        fen: SNAPSHOT.fen,
        comment: null,
        thinkTimeMs: 1_000,
      });
    });
    expect(result.current.moves.map((move) => move.san)).toEqual(["d4"]);
  });

  it("ignores a frame that is not a wire event", () => {
    useFakeSource();
    const { result } = renderHook(() => useGameStream("http://api.test/stream", "https://api.test", LIVE));
    act(() => {
      FakeEventSource.last?.emit("game.move", { type: "game.move", nonsense: true });
      FakeEventSource.last?.listeners.get("ping")?.(new MessageEvent("ping", { data: "not json" }));
    });
    expect(result.current).toEqual(LIVE);
  });

  it("reads the timeline back once when the stream leaves a hole, and only once", async () => {
    useFakeSource();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ moves: [E4_TIMELINE_MOVE], attempts: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const { result } = renderHook(() => useGameStream("https://api.test/stream", "https://api.test", LIVE));

    act(() => {
      FakeEventSource.last?.emit("game.move", {
        type: "game.move",
        gameId: SNAPSHOT.id,
        ply: 5,
        color: "white",
        san: "Nf3",
        uci: "g1f3",
        fen: AFTER_E4,
        comment: null,
        thinkTimeMs: 900,
      });
    });
    expect(result.current.gap).toBe(true);

    await waitFor(() => {
      expect(result.current.gap).toBe(false);
    });
    expect(result.current.moves).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockRestore();
  });
});
