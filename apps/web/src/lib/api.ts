import {
  AGENTS_MAX_LIMIT,
  AgentListPageSchema,
  AgentProfileSchema,
  GameListPageSchema,
  GameSnapshotSchema,
  GameTimelineSchema,
  LeaderboardPageSchema,
  LobbySchema,
  type AgentListItem,
  type AgentListPage,
  type AgentProfile,
  type GameListPage,
  type GameSnapshot,
  type GameTimeline,
  type LeaderboardPage,
  type Lobby,
} from "@aichess/core/protocol";
import type { z } from "zod";
import { serverEnv } from "@/env";
import { ApiRequestError as ApiRequestErrorClass, getJsonFrom } from "./http";

export { ApiRequestError } from "./http";

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestErrorClass && error.code === "not_found";
}

/**
 * A path parameter the API refuses to parse — a game id that is not a uuid, a
 * slug with a slash in it — describes a page that cannot exist, so it belongs
 * on the 404 rather than on the error page.
 */
export function isMissingOrMalformed(error: unknown): boolean {
  return error instanceof ApiRequestErrorClass && (error.code === "not_found" || error.code === "validation_error");
}

export type QueryValue = string | number | undefined;

function queryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered === "" ? "" : `?${rendered}`;
}

/** Every page reads live state, so nothing here is cached. */
async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return getJsonFrom(`${serverEnv().apiInternalUrl}${path}`, schema, path);
}

export interface LeaderboardParams {
  limit?: number;
  cursor?: string;
}

export function fetchLeaderboard(params: LeaderboardParams = {}): Promise<LeaderboardPage> {
  return getJson(`/v1/leaderboard${queryString({ ...params })}`, LeaderboardPageSchema);
}

export interface GamesParams {
  limit?: number;
  cursor?: string;
  status?: string;
  agent?: string;
  outcome?: string;
  termination?: string;
}

export function fetchGames(params: GamesParams = {}): Promise<GameListPage> {
  return getJson(`/v1/games${queryString({ ...params })}`, GameListPageSchema);
}

export function fetchGame(id: string): Promise<GameSnapshot> {
  return getJson(`/v1/games/${encodeURIComponent(id)}`, GameSnapshotSchema);
}

export function fetchGameTimeline(id: string): Promise<GameTimeline> {
  return getJson(`/v1/games/${encodeURIComponent(id)}/moves`, GameTimelineSchema);
}

export interface AgentsParams {
  limit?: number;
  cursor?: string;
}

export function fetchAgents(params: AgentsParams = {}): Promise<AgentListPage> {
  return getJson(`/v1/agents${queryString({ ...params })}`, AgentListPageSchema);
}

/** Enough pages for a thousand agents; beyond that the selector is a search box, not a list. */
export const ROSTER_PAGE_CAP = 10;

/**
 * The whole roster, for the places that have to name every agent rather than
 * show a few: a filter that only knows the first page silently cannot find
 * the agents that come after it.
 */
export async function fetchAllAgents(cap = ROSTER_PAGE_CAP): Promise<AgentListItem[]> {
  const all: AgentListItem[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < cap; page += 1) {
    const answer = await fetchAgents({ limit: AGENTS_MAX_LIMIT, ...(cursor === undefined ? {} : { cursor }) });
    all.push(...answer.items);
    if (answer.nextCursor === null) break;
    cursor = answer.nextCursor;
  }
  return all;
}

export function fetchAgent(slug: string): Promise<AgentProfile> {
  return getJson(`/v1/agents/${encodeURIComponent(slug)}`, AgentProfileSchema);
}

export function fetchLobby(): Promise<Lobby> {
  return getJson("/v1/lobby", LobbySchema);
}

/** The PGN is served by the API, so the browser downloads it directly. */
export function pgnUrl(apiPublicUrl: string, gameId: string): string {
  return `${apiPublicUrl}/v1/games/${encodeURIComponent(gameId)}/pgn`;
}

/** The timeline, read by the browser when the stream leaves a hole in the list. */
export function gameTimelineUrl(apiPublicUrl: string, gameId: string): string {
  return `${apiPublicUrl}/v1/games/${encodeURIComponent(gameId)}/moves`;
}

/** The spectator stream, opened by the browser with an EventSource. */
export function gameStreamUrl(apiPublicUrl: string, gameId: string): string {
  return `${apiPublicUrl}/v1/games/${encodeURIComponent(gameId)}/stream`;
}
