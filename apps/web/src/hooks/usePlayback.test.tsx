import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayback } from "./usePlayback";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePlayback", () => {
  it("opens an active game at the live edge, following", () => {
    const { result } = renderHook(() => usePlayback(4, true));
    expect(result.current.ply).toBe(4);
    expect(result.current.following).toBe(true);
    expect(result.current.atLive).toBe(true);
    expect(result.current.lag).toBe(0);
  });

  it("opens a finished game parked on the final position", () => {
    const { result } = renderHook(() => usePlayback(4, false));
    expect(result.current.ply).toBe(4);
    expect(result.current.following).toBe(false);
    expect(result.current.playing).toBe(false);
  });

  it("walks towards the live edge as moves arrive, one at a time", () => {
    const { result, rerender } = renderHook(({ total }) => usePlayback(total, true), {
      initialProps: { total: 0 },
    });
    rerender({ total: 3 });
    expect(result.current.ply).toBe(0);
    expect(result.current.lag).toBe(3);

    act(() => {
      vi.advanceTimersByTime(1250);
    });
    expect(result.current.ply).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1667);
    });
    expect(result.current.ply).toBe(2);
  });

  it("parks the cursor when the viewer picks a move, and stops following", () => {
    const { result } = renderHook(() => usePlayback(10, true));
    act(() => {
      result.current.setPly(3);
    });
    expect(result.current.ply).toBe(3);
    expect(result.current.following).toBe(false);
    expect(result.current.atLive).toBe(false);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.ply).toBe(3);
  });

  it("treats picking the last move as going back to live", () => {
    const { result } = renderHook(() => usePlayback(10, true));
    act(() => {
      result.current.setPly(3);
    });
    act(() => {
      result.current.setPly(10);
    });
    expect(result.current.following).toBe(true);
  });

  it("replays from the start and rejoins a game still being played", () => {
    const { result } = renderHook(() => usePlayback(2, true));
    act(() => {
      result.current.restart();
    });
    expect(result.current.ply).toBe(0);
    expect(result.current.playing).toBe(true);
    expect(result.current.following).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.ply).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.ply).toBe(2);
    expect(result.current.playing).toBe(false);
    expect(result.current.following).toBe(true);
  });

  it("stops at the end of a finished game instead of rejoining anything", () => {
    const { result } = renderHook(() => usePlayback(1, false));
    act(() => {
      result.current.restart();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.ply).toBe(1);
    expect(result.current.playing).toBe(false);
    expect(result.current.following).toBe(false);
  });

  it("pauses and resumes on toggle", () => {
    const { result } = renderHook(() => usePlayback(5, false));
    act(() => {
      result.current.restart();
    });
    act(() => {
      result.current.toggle();
    });
    expect(result.current.playing).toBe(false);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.ply).toBe(0);

    act(() => {
      result.current.toggle();
    });
    expect(result.current.playing).toBe(true);
  });

  it("plays a finished game again from the start when it is already at the end", () => {
    const { result } = renderHook(() => usePlayback(5, false));
    act(() => {
      result.current.toggle();
    });
    expect(result.current.ply).toBe(0);
    expect(result.current.playing).toBe(true);
  });

  it("jumps rather than fast-forwarding when the tab was hidden for a long time", () => {
    const { result, rerender } = renderHook(({ total }) => usePlayback(total, true), {
      initialProps: { total: 0 },
    });
    rerender({ total: 60 });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.ply).toBe(60);
  });

  it("goes straight to the live edge at instant speed", () => {
    const { result, rerender } = renderHook(({ total }) => usePlayback(total, true), {
      initialProps: { total: 0 },
    });
    act(() => {
      result.current.setSpeed("instant");
    });
    rerender({ total: 6 });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current.ply).toBe(6);
  });

  it("follows the live position until the viewer steps back", () => {
    const { result, rerender } = renderHook(({ total }) => usePlayback(total, true), {
      initialProps: { total: 2 },
    });
    expect(result.current).toMatchObject({ ply: 2, atLive: true });

    act(() => {
      result.current.setPly(1);
    });
    expect(result.current).toMatchObject({ ply: 1, atLive: false });

    rerender({ total: 3 });
    expect(result.current.ply).toBe(1);

    act(() => {
      result.current.goLive();
    });
    expect(result.current).toMatchObject({ ply: 3, atLive: true });
  });

  it("clamps the ends and ignores keys it does not own", () => {
    const { result } = renderHook(() => usePlayback(2, true));
    act(() => {
      result.current.setPly(-5);
    });
    expect(result.current.ply).toBe(0);
    act(() => {
      result.current.setPly(99);
    });
    expect(result.current).toMatchObject({ ply: 2, atLive: true });
  });
});
