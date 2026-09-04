"use client";

import { useEffect, useRef, useState } from "react";
import { applyStreamEvent, type LiveGame } from "@/lib/live";
import { useWireStream } from "./useWireStream";

interface Tracked {
  /** The game the state below belongs to. */
  id: string;
  game: LiveGame;
}

export function useGameStream(url: string | null, initial: LiveGame): LiveGame {
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

  return game;
}
