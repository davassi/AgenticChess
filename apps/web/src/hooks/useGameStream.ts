"use client";

import { useEffect, useRef, useState } from "react";
import { applyStreamEvent, type LiveGame } from "@/lib/live";
import { fetchTimelineAt } from "@/lib/timeline";
import { useWireStream } from "./useWireStream";

interface Tracked {
  /** The game the state below belongs to. */
  id: string;
  game: LiveGame;
}

export function useGameStream(url: string | null, apiPublicUrl: string, initial: LiveGame): LiveGame {
  const gameId = initial.snapshot.id;
  const [tracked, setTracked] = useState<Tracked>({ id: gameId, game: initial });

  // Walking from one game to another swaps `initial` without remounting the
  // page, and state kept from the game just left would have the new game's
  // moves appended to it.
  const game = tracked.id === gameId ? tracked.game : initial;

  const latest = useRef(initial);
  useEffect(() => {
    latest.current = initial;
  });

  useWireStream(url, !initial.finished, (event) => {
    setTracked((current) => ({
      id: gameId,
      game: applyStreamEvent(current.id === gameId ? current.game : latest.current, event),
    }));
  });

  // A hole in the list is not survivable by waiting: every later move is
  // non-contiguous too, so the list would stay short for the whole session
  // and every position replayed past the hole would be wrong. One read of the
  // timeline repairs it. One, and only one — a failing API must not turn into
  // a request per render.
  const repaired = useRef<string | null>(null);
  useEffect(() => {
    if (!game.gap || repaired.current === gameId) return;
    repaired.current = gameId;
    let cancelled = false;
    fetchTimelineAt(apiPublicUrl, gameId)
      .then((timeline) => {
        if (cancelled) return;
        setTracked((current) => ({
          id: gameId,
          game: { ...current.game, moves: timeline.moves, attempts: timeline.attempts, gap: false },
        }));
      })
      .catch((error: unknown) => {
        // The board still has the snapshot's FEN to draw, so the page degrades
        // to what it did before rather than breaking.
        console.error(`Could not re-read the move list for game ${gameId}`, error);
      });
    return () => {
      cancelled = true;
    };
  }, [game.gap, gameId, apiPublicUrl]);

  return game;
}
