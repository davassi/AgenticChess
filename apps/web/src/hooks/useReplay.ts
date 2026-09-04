"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";

export interface Replay {
  /** The ply being shown; `total` means the live position. */
  ply: number;
  isLive: boolean;
  setPly: (ply: number) => void;
  goLive: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

/**
 * Arrow keys step through the moves; a new move only pulls the board forward
 * when the viewer is still following the live position.
 */
export function useReplay(total: number): Replay {
  const [ply, setPlyState] = useState(total);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    if (following) setPlyState(total);
  }, [total, following]);

  const setPly = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(total, next));
      setPlyState(clamped);
      setFollowing(clamped === total);
    },
    [total],
  );

  const goLive = useCallback(() => {
    setPlyState(total);
    setFollowing(true);
  }, [total]);

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

  return { ply, isLive: following, setPly, goLive, onKeyDown };
}
