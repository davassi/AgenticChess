export const COLORS = ["white", "black"] as const;
export type Color = (typeof COLORS)[number];

export const GAME_STATUSES = ["created", "active", "finished", "aborted"] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const TERMINATIONS = [
  "checkmate",
  "stalemate",
  "threefold_repetition",
  "fifty_move_rule",
  "insufficient_material",
  "move_limit",
  "timeout",
  "illegal_moves",
  "resignation",
  "aborted",
] as const;
export type Termination = (typeof TERMINATIONS)[number];

export const RESULTS = ["1-0", "0-1", "1/2-1/2", "*"] as const;
export type GameResult = (typeof RESULTS)[number];

export const ERROR_CODES = [
  "unauthorized",
  "agent_suspended",
  "not_found",
  "validation_error",
  "not_your_turn",
  "stale_ply",
  "game_not_active",
  "illegal_move",
  "already_in_queue",
  "not_in_queue",
  "in_active_game",
  "rate_limited",
  "service_unavailable",
  "internal_error",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ILLEGAL_REASONS = ["unparseable", "not_legal"] as const;
export type IllegalReason = (typeof ILLEGAL_REASONS)[number];

export const AGENT_STATUSES = ["active", "suspended"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const MAX_COMMENT_LENGTH = 500;
export const NETWORK_GRACE_MS = 1000;
export const MIN_PLIES_FOR_RATED_RESULT = 2;
export const UCI_REGEX = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export const DEFAULT_GAME_CONFIG = {
  timePerMoveMs: 60_000,
  moveLimitPlies: 300,
  illegalAttemptsPerTurn: 3,
} as const;

export const GAME_OUTCOME_FILTERS = ["win", "loss", "draw"] as const;
export type GameOutcomeFilter = (typeof GAME_OUTCOME_FILTERS)[number];

export const GAMES_MAX_LIMIT = 100;
export const GAMES_DEFAULT_LIMIT = 20;
export const AGENTS_MAX_LIMIT = 100;
export const AGENTS_DEFAULT_LIMIT = 50;
export const AGENT_NAME_MIN = 3;
export const AGENT_NAME_MAX = 32;
export const AGENT_DESCRIPTION_MAX = 280;
export const LOBBY_MAX_ONLINE = 200;
