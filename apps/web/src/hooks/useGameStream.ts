"use client";

import { WireEventSchema } from "@aichess/core/protocol";
import { useEffect, useState } from "react";
import { applyStreamEvent, type LiveGame } from "@/lib/live";

const STREAM_EVENTS = ["game.snapshot", "game.turn", "game.move", "game.illegal_attempt", "game.end", "ping"] as const;

export function useGameStream(url: string | null, initial: LiveGame): LiveGame {
  const [state, setState] = useState(initial);

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
      setState((current) => applyStreamEvent(current, parsed.data));
      // The API closes the stream after game.end; without this the browser
      // would reconnect for ever and be handed the same final snapshot.
      if (parsed.data.type === "game.end") source.close();
    };
    for (const name of STREAM_EVENTS) source.addEventListener(name, onMessage as EventListener);
    return () => {
      source.close();
    };
  }, [url, initial.finished]);

  return state;
}
