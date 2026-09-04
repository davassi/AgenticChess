import { GameTimelineSchema, type GameTimeline } from "@aichess/core/protocol";
import { getJsonFrom } from "./http";

/**
 * The whole move list, read from the browser. Kept out of api.ts because
 * everything there resolves the internal address out of the server
 * environment, which a client component has no business importing.
 */
export function fetchTimelineAt(apiPublicUrl: string, gameId: string): Promise<GameTimeline> {
  const path = `/v1/games/${encodeURIComponent(gameId)}/moves`;
  return getJsonFrom(`${apiPublicUrl}${path}`, GameTimelineSchema, path);
}
