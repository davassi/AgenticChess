import type { AgentSummary, GameListItem, Lobby } from "@aichess/core/protocol";

export interface RollCall {
  playing: AgentSummary[];
  idle: AgentSummary[];
  offline: AgentSummary[];
}

/**
 * Who is at a board, who is waiting and who is not here.
 *
 * `active` has to be every game in progress rather than the handful the page
 * has room to draw: an agent playing on a board that did not fit would
 * otherwise be counted as idle, and then again as offline.
 */
export function rollCall(lobby: Lobby, active: GameListItem[], roster: AgentSummary[]): RollCall {
  const playing = active.flatMap((game) => [game.white, game.black]);
  const playingIds = new Set(playing.map((agent) => agent.id));
  const queuedIds = new Set(lobby.queue.map((entry) => entry.agent.id));
  const onlineIds = new Set(lobby.online.map((agent) => agent.id));
  return {
    playing,
    idle: lobby.online.filter((agent) => !queuedIds.has(agent.id) && !playingIds.has(agent.id)),
    offline: roster.filter((agent) => !onlineIds.has(agent.id) && !playingIds.has(agent.id)),
  };
}
