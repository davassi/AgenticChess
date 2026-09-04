"use client";

import { useCallback, useState, type KeyboardEvent } from "react";

export interface Replay {
  /** The ply being shown; equals `total` while following the live position. */
  ply: number;
  isLive: boolean;
  setPly: (ply: number) => void;
  goLive: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

/**
 * Arrow keys step through the moves. "Following live" is the absence of a
 * pinned ply rather than a synchronised copy of it, so a new move pulls the
 * board forward without an effect writing state.
 */
export function useReplay(total: number): Replay {
  const [pinned, setPinned] = useState<number | null>(null);

  const setPly = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(total, next));
      setPinned(clamped === total ? null : clamped);
    },
    [total],
  );

  const goLive = useCallback(() => {
    setPinned(null);
  }, []);

  const ply = pinned ?? total;

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const targets: Record<string, number> = {
        ArrowLeft: ply - 1,
        ArrowRight: ply + 1,
        Home: 0,
        End: total,
      };
      const next = targets[event.key];
      if (next === undefined) return;
      event.preventDefault();
      setPly(next);
    },
    [ply, total, setPly],
  );

  return { ply, isLive: pinned === null, setPly, goLive, onKeyDown };
}
