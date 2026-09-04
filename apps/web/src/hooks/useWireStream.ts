"use client";

import { WireEventSchema, type WireEvent } from "@aichess/core/protocol";
import { useEffect, useRef } from "react";
import { endsTheStream } from "@/lib/live";

const STREAM_EVENTS = ["game.snapshot", "game.turn", "game.move", "game.illegal_attempt", "game.end", "ping"] as const;

/**
 * One spectator subscription, with the rules every page that opens one shares:
 * frames that are not wire events are dropped, and the source is closed by
 * hand once the game is over, because a server that closes the connection
 * leaves the browser reconnecting for ever.
 *
 * The handler is read through a ref, so a page that re-renders on every move
 * does not tear the stream down and open it again.
 */
export function useWireStream(url: string | null, enabled: boolean, onEvent: (event: WireEvent) => void): void {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });

  useEffect(() => {
    if (url === null || !enabled) return;
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
      handler.current(parsed.data);
      if (endsTheStream(parsed.data)) source.close();
    };
    for (const name of STREAM_EVENTS) source.addEventListener(name, onMessage as EventListener);
    return () => {
      source.close();
    };
  }, [url, enabled]);
}
