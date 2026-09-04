"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { liveInterval, nextPly, reviewInterval, type Speed } from "@/lib/playback";

export interface Playback {
  /** The ply being shown, which is not the ply the server has reached. */
  ply: number;
  /** How many plies exist. The cursor's target; never drawn on its own. */
  total: number;
  lag: number;
  /** The cursor is chasing the live edge at a watchable pace. */
  following: boolean;
  /** A replay the viewer started is running. */
  playing: boolean;
  atLive: boolean;
  speed: Speed;
  setSpeed: (speed: Speed) => void;
  setPly: (ply: number) => void;
  step: (delta: number) => void;
  goLive: () => void;
  restart: () => void;
  toggle: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

interface Cursor {
  ply: number;
  following: boolean;
  playing: boolean;
}

/**
 * Which ply the viewer is looking at.
 *
 * Two booleans cover paced live viewing, an instant replay and a cursor
 * parked on one move; the pace itself is in lib/playback.ts, so all that is
 * left here is a timer. The timer is rescheduled from scratch on every
 * advance rather than kept running, which is what makes it safe under React's
 * double-mounted effects in development.
 */
export function usePlayback(total: number, active: boolean): Playback {
  const [speed, setSpeed] = useState<Speed>(1);
  const [cursor, setCursor] = useState<Cursor>(() => ({ ply: total, following: active, playing: false }));

  // A game whose moves were re-fetched can be shorter than the cursor for one
  // render; drawing past the end of the list would throw.
  const ply = Math.min(cursor.ply, total);

  useEffect(() => {
    if (ply >= total) return;
    if (!cursor.following && !cursor.playing) return;
    const delay = cursor.following ? liveInterval(total - ply, speed) : reviewInterval(speed);
    const timer = setTimeout(() => {
      setCursor((current) => {
        const next = nextPly(current.ply, total, current.following, speed);
        if (current.following) return { ...current, ply: next };
        // A replay that catches up with a game still being played rejoins the
        // broadcast; on a finished game it simply stops at the end.
        if (next >= total) return { ply: next, following: active, playing: false };
        return { ...current, ply: next };
      });
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [cursor, ply, total, speed, active]);

  const setPly = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(total, next));
      // Landing on the last move is how the viewer says "done reviewing".
      setCursor({ ply: clamped, following: clamped >= total && active, playing: false });
    },
    [total, active],
  );

  const step = useCallback(
    (delta: number) => {
      setPly(ply + delta);
    },
    [ply, setPly],
  );

  const goLive = useCallback(() => {
    setCursor({ ply: total, following: active, playing: false });
  }, [total, active]);

  const restart = useCallback(() => {
    setCursor({ ply: 0, following: false, playing: true });
  }, []);

  const toggle = useCallback(() => {
    setCursor((current) => {
      if (current.playing) return { ...current, playing: false };
      // Play at the end of the list means "watch it again from the start".
      if (current.ply >= total) return { ply: 0, following: false, playing: true };
      return { ...current, following: false, playing: true };
    });
  }, [total]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const actions: Record<string, () => void> = {
        ArrowLeft: () => {
          setPly(ply - 1);
        },
        ArrowRight: () => {
          setPly(ply + 1);
        },
        Home: () => {
          setPly(0);
        },
        End: goLive,
        " ": toggle,
      };
      const action = actions[event.key];
      if (action === undefined) return;
      event.preventDefault();
      action();
    },
    [ply, setPly, goLive, toggle],
  );

  return {
    ply,
    total,
    lag: total - ply,
    following: cursor.following,
    playing: cursor.playing,
    atLive: cursor.following && ply >= total,
    speed,
    setSpeed,
    setPly,
    step,
    goLive,
    restart,
    toggle,
    onKeyDown,
  };
}
