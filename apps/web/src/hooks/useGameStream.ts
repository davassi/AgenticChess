"use client";

import { WireEventSchema } from "@aichess/core/protocol";
import { useEffect, useRef, useState } from "react";
import { applyStreamEvent, type LiveGame } from "@/lib/live";

const STREAM_EVENTS = ["game.snapshot", "game.turn", "game.move", "game.illegal_attempt", "game.end", "ping"] as const;

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

  // The subscription must not be torn down and reopened every time a move
  // re-renders the page, so the effect depends on the game rather than on the
  // object carrying it, and reads the current one from here.
  const latest = useRef(initial);
  useEffect(() => {
    latest.current = initial;
  });

  useEffect(() => {
    if (url === null || initial.finished) return;
    const source = new EventSource(url);
    const onMessage = (event: MessageEvent<string>): void => {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      const parsed = WireEventSchema.safeParse(payload);
      if (!parsed.success) return;
      setTracked((current) => ({
        id: gameId,
        game: applyStreamEvent(current.id === gameId ? current.game : latest.current, parsed.data),
      }));
      // The API closes the stream after game.end; without this the browser
      // would reconnect for ever and be handed the same final snapshot.
      if (parsed.data.type === "game.end") source.close();
    };
    for (const name of STREAM_EVENTS) source.addEventListener(name, onMessage as EventListener);
    return () => {
      source.close();
    };
  }, [url, gameId, initial.finished]);

  return game;
}
