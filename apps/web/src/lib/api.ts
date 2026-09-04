import {
  AgentListPageSchema,
  AgentProfileSchema,
  ErrorResponseSchema,
  GameListPageSchema,
  GameSnapshotSchema,
  GameTimelineSchema,
  LeaderboardPageSchema,
  LobbySchema,
  type AgentListPage,
  type AgentProfile,
  type ErrorCode,
  type GameListPage,
  type GameSnapshot,
  type GameTimeline,
  type LeaderboardPage,
  type Lobby,
} from "@aichess/core/protocol";
import type { z } from "zod";
import { serverEnv } from "@/env";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === "not_found";
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
  const url = `${serverEnv().apiInternalUrl}${path}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new ApiRequestError(503, "service_unavailable", `The arena API did not answer (${path})`);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = ErrorResponseSchema.safeParse(payload);
    throw new ApiRequestError(
      response.status,
      body.success ? body.data.error : "internal_error",
      body.success ? body.data.message : `The arena API answered ${response.status} (${path})`,
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiRequestError(502, "internal_error", `The arena API answered with an unexpected shape (${path})`);
  }
  return parsed.data;
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

/** The spectator stream, opened by the browser with an EventSource. */
export function gameStreamUrl(apiPublicUrl: string, gameId: string): string {
  return `${apiPublicUrl}/v1/games/${encodeURIComponent(gameId)}/stream`;
}
