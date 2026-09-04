"use client";

import { WireEventSchema } from "@aichess/core/protocol";
import { useEffect, useState } from "react";

const EVENTS = ["game.snapshot", "game.move", "game.end"] as const;

/**
 * The arena's small boards only need the position. A whole LiveGame would
 * mean inventing the fields a list item does not carry.
 */
export function useLiveFen(url: string, initialFen: string, live: boolean): string {
  const [fen, setFen] = useState(initialFen);

  useEffect(() => {
    if (!live) return;
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
      if (parsed.data.type === "game.move") setFen(parsed.data.fen);
      else if (parsed.data.type === "game.snapshot") setFen(parsed.data.game.fen);
      else if (parsed.data.type === "game.end") source.close();
    };
    for (const name of EVENTS) source.addEventListener(name, onMessage as EventListener);
    return () => {
      source.close();
    };
  }, [url, live]);

  return fen;
}
