import { z } from "zod";
import {
  AGENT_DESCRIPTION_MAX,
  AGENT_NAME_MAX,
  AGENT_NAME_MIN,
  AGENT_STATUSES,
  AGENTS_DEFAULT_LIMIT,
  AGENTS_MAX_LIMIT,
  COLORS,
  ERROR_CODES,
  GAME_OUTCOME_FILTERS,
  GAME_STATUSES,
  GAMES_DEFAULT_LIMIT,
  GAMES_MAX_LIMIT,
  ILLEGAL_REASONS,
  MAX_COMMENT_LENGTH,
  QUEUE_MODES,
  RESULTS,
  TERMINATIONS,
  UCI_REGEX,
} from "./enums.js";

export const ColorSchema = z.enum(COLORS);
export const GameStatusSchema = z.enum(GAME_STATUSES);
export const TerminationSchema = z.enum(TERMINATIONS);
export const GameResultSchema = z.enum(RESULTS);
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export const IllegalReasonSchema = z.enum(ILLEGAL_REASONS);
export const AgentStatusSchema = z.enum(AGENT_STATUSES);

export const LegalMoveSchema = z.object({
  san: z.string().min(1),
  uci: z.string().regex(UCI_REGEX),
});
export type LegalMove = z.infer<typeof LegalMoveSchema>;

export const GameConfigSchema = z.object({
  timePerMoveMs: z.int().min(1_000).max(3_600_000),
  moveLimitPlies: z.int().min(2).max(2_000),
  illegalAttemptsPerTurn: z.int().min(1).max(10),
  /**
   * Whether the result moves the players' ratings. It rides in the config
   * because the config is the one object already carried from `createGame`
   * through the snapshot to the SDK and the board.
   */
  rated: z.boolean(),
});
export type GameConfig = z.infer<typeof GameConfigSchema>;

export const MoveRequestSchema = z.object({
  ply: z.int().min(0),
  move: z.string().trim().min(1).max(10),
  comment: z.string().max(MAX_COMMENT_LENGTH).optional(),
});
export type MoveRequest = z.infer<typeof MoveRequestSchema>;

export const ErrorResponseSchema = z.object({
  error: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const AgentSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  modelProvider: z.string(),
  modelName: z.string(),
  /** The arena's own sparring agent, so a viewer knows who they are looking at. */
  isHouse: z.boolean(),
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

export const QueueModeSchema = z.enum(QUEUE_MODES);

export const QueueStatusSchema = z.object({
  queuedAt: z.iso.datetime(),
  /** Which queue the agent is waiting in. A practice game moves no rating. */
  mode: QueueModeSchema,
});
export type QueueStatus = z.infer<typeof QueueStatusSchema>;

export const RatingSummarySchema = z.object({
  rating: z.number(),
  rd: z.number().min(0),
  gamesPlayed: z.int().min(0),
  provisional: z.boolean(),
});
export type RatingSummary = z.infer<typeof RatingSummarySchema>;

export const AgentMeSchema = z.object({
  agent: AgentSummarySchema,
  status: AgentStatusSchema,
  online: z.boolean(),
  activeGameId: z.uuid().nullable(),
  queue: QueueStatusSchema.nullable(),
  rating: RatingSummarySchema,
});
export type AgentMe = z.infer<typeof AgentMeSchema>;

export const LeaderboardEntrySchema = z.object({
  rank: z.int().min(1),
  agent: AgentSummarySchema,
  rating: z.number(),
  rd: z.number().min(0),
  gamesPlayed: z.int().min(0),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardPageSchema = z.object({
  items: z.array(LeaderboardEntrySchema),
  nextCursor: z.string().nullable(),
});
export type LeaderboardPage = z.infer<typeof LeaderboardPageSchema>;

export const LEADERBOARD_MAX_LIMIT = 100;
export const LEADERBOARD_DEFAULT_LIMIT = 50;

export const LeaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(LEADERBOARD_MAX_LIMIT).default(LEADERBOARD_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
});
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;

export const GameSnapshotSchema = z.object({
  id: z.uuid(),
  status: GameStatusSchema,
  white: AgentSummarySchema,
  black: AgentSummarySchema,
  config: GameConfigSchema,
  fen: z.string(),
  ply: z.int().min(0),
  history: z.array(z.string()),
  turn: ColorSchema,
  moveDeadlineAt: z.iso.datetime().nullable(),
  result: GameResultSchema.nullable(),
  termination: TerminationSchema.nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  legalMoves: z.array(LegalMoveSchema).optional(),
  attemptsLeft: z.int().min(0).optional(),
});
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;

export const HelloEventSchema = z.object({
  type: z.literal("hello"),
  agentId: z.uuid(),
  activeGame: GameSnapshotSchema.nullable(),
  queue: QueueStatusSchema.nullable(),
});

// Extended from the status rather than repeating its fields: the two are the
// same fact, and a field added to one and not the other is silently dropped by
// the wire schema on its way to the agent.
export const QueueJoinedEventSchema = QueueStatusSchema.extend({
  type: z.literal("queue.joined"),
});

export const QueueLeftEventSchema = QueueStatusSchema.extend({
  type: z.literal("queue.left"),
});

export const GameStartEventSchema = z.object({
  type: z.literal("game.start"),
  gameId: z.uuid(),
  color: ColorSchema,
  opponent: AgentSummarySchema,
  timePerMoveMs: z.int().min(1_000),
  startedAt: z.iso.datetime(),
});

export const YourTurnEventSchema = z.object({
  type: z.literal("game.your_turn"),
  gameId: z.uuid(),
  ply: z.int().min(0),
  fen: z.string(),
  history: z.array(z.string()),
  lastMove: LegalMoveSchema.nullable(),
  legalMoves: z.array(LegalMoveSchema),
  deadlineAt: z.iso.datetime(),
  attemptsLeft: z.int().min(0),
});

export const MoveEventSchema = z.object({
  type: z.literal("game.move"),
  gameId: z.uuid(),
  ply: z.int().min(1),
  color: ColorSchema,
  san: z.string(),
  uci: z.string().regex(UCI_REGEX),
  fen: z.string(),
  comment: z.string().nullable(),
  thinkTimeMs: z.int().min(0),
});

export const GameEndEventSchema = z.object({
  type: z.literal("game.end"),
  gameId: z.uuid(),
  result: GameResultSchema,
  termination: TerminationSchema,
  pgn: z.string(),
  rating: z.object({ before: z.number(), after: z.number() }).nullable(),
});

export const SnapshotEventSchema = z.object({
  type: z.literal("game.snapshot"),
  game: GameSnapshotSchema,
});

export const TurnEventSchema = z.object({
  type: z.literal("game.turn"),
  gameId: z.uuid(),
  color: ColorSchema,
  ply: z.int().min(0),
  deadlineAt: z.iso.datetime(),
});

export const IllegalAttemptEventSchema = z.object({
  type: z.literal("game.illegal_attempt"),
  gameId: z.uuid(),
  color: ColorSchema,
  ply: z.int().min(0),
  submitted: z.string().max(64),
  reason: IllegalReasonSchema,
  attemptsLeft: z.int().min(0),
});

export const PingEventSchema = z.object({
  type: z.literal("ping"),
  at: z.iso.datetime(),
});

export const GameListItemSchema = z.object({
  id: z.uuid(),
  status: GameStatusSchema,
  // The list item does not carry the game config, so it needs the flag of its
  // own: the archive rows and the arena cards draw their badge from here.
  rated: z.boolean(),
  white: AgentSummarySchema,
  black: AgentSummarySchema,
  fen: z.string(),
  ply: z.int().min(0),
  turn: ColorSchema,
  result: GameResultSchema.nullable(),
  termination: TerminationSchema.nullable(),
  moveDeadlineAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});
export type GameListItem = z.infer<typeof GameListItemSchema>;

export const GameListPageSchema = z.object({
  items: z.array(GameListItemSchema),
  nextCursor: z.string().nullable(),
});
export type GameListPage = z.infer<typeof GameListPageSchema>;

export const AGENT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;
export const AgentSlugSchema = z.string().min(AGENT_NAME_MIN).max(AGENT_NAME_MAX).regex(AGENT_SLUG_REGEX);

export const GamesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(GAMES_MAX_LIMIT).default(GAMES_DEFAULT_LIMIT),
    cursor: z.string().min(1).max(512).optional(),
    status: GameStatusSchema.optional(),
    agent: AgentSlugSchema.optional(),
    outcome: z.enum(GAME_OUTCOME_FILTERS).optional(),
    termination: TerminationSchema.optional(),
  })
  .refine((query) => query.outcome === undefined || query.agent !== undefined, {
    message: "outcome requires agent",
    path: ["outcome"],
  });
export type GamesQuery = z.infer<typeof GamesQuerySchema>;

export const TimelineMoveSchema = z.object({
  ply: z.int().min(1),
  color: ColorSchema,
  san: z.string().min(1),
  uci: z.string().regex(UCI_REGEX),
  fen: z.string(),
  comment: z.string().nullable(),
  thinkTimeMs: z.int().min(0),
  at: z.iso.datetime(),
});
export type TimelineMove = z.infer<typeof TimelineMoveSchema>;

export const TimelineAttemptSchema = z.object({
  ply: z.int().min(0),
  color: ColorSchema,
  submitted: z.string().max(64),
  reason: IllegalReasonSchema,
  at: z.iso.datetime(),
});
export type TimelineAttempt = z.infer<typeof TimelineAttemptSchema>;

export const GameTimelineSchema = z.object({
  moves: z.array(TimelineMoveSchema),
  attempts: z.array(TimelineAttemptSchema),
});
export type GameTimeline = z.infer<typeof GameTimelineSchema>;

export const AgentListItemSchema = z.object({
  agent: AgentSummarySchema,
  description: z.string(),
  status: AgentStatusSchema,
  rating: RatingSummarySchema,
});
export type AgentListItem = z.infer<typeof AgentListItemSchema>;

export const AgentListPageSchema = z.object({
  items: z.array(AgentListItemSchema),
  nextCursor: z.string().nullable(),
});
export type AgentListPage = z.infer<typeof AgentListPageSchema>;

export const AgentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(AGENTS_MAX_LIMIT).default(AGENTS_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
});
export type AgentsQuery = z.infer<typeof AgentsQuerySchema>;

/** `illegalRate` is rejected attempts divided by own moves played, so 0.04 is one attempt in twenty-five. */
export const AgentStatsSchema = z.object({
  games: z.int().min(0),
  wins: z.int().min(0),
  draws: z.int().min(0),
  losses: z.int().min(0),
  illegalRate: z.number().min(0),
  avgThinkTimeMs: z.number().min(0),
});
export type AgentStats = z.infer<typeof AgentStatsSchema>;

export const RatingPointSchema = z.object({
  gameId: z.uuid(),
  rating: z.number(),
  rd: z.number().min(0),
  at: z.iso.datetime(),
});
export type RatingPoint = z.infer<typeof RatingPointSchema>;

export const AgentProfileSchema = z.object({
  agent: AgentSummarySchema,
  description: z.string(),
  status: AgentStatusSchema,
  online: z.boolean(),
  queue: QueueStatusSchema.nullable(),
  activeGameId: z.uuid().nullable(),
  rating: RatingSummarySchema,
  rank: z.int().min(1).nullable(),
  createdAt: z.iso.datetime(),
  stats: AgentStatsSchema,
  ratingHistory: z.array(RatingPointSchema),
  recentGames: z.array(GameListItemSchema),
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export const QueueEntryPublicSchema = z.object({
  agent: AgentSummarySchema,
  rating: z.number(),
  queuedAt: z.iso.datetime(),
  mode: QueueModeSchema,
});
export type QueueEntryPublic = z.infer<typeof QueueEntryPublicSchema>;

export const LobbySchema = z.object({
  online: z.array(AgentSummarySchema),
  queue: z.array(QueueEntryPublicSchema),
});
export type Lobby = z.infer<typeof LobbySchema>;

export const AgentCreateSchema = z.object({
  name: z.string().trim().min(AGENT_NAME_MIN).max(AGENT_NAME_MAX),
  slug: AgentSlugSchema,
  description: z.string().trim().max(AGENT_DESCRIPTION_MAX).default(""),
  modelProvider: z.string().trim().min(1).max(40),
  modelName: z.string().trim().min(1).max(60),
});
export type AgentCreateInput = z.infer<typeof AgentCreateSchema>;

export const WireEventSchema = z.discriminatedUnion("type", [
  HelloEventSchema,
  QueueJoinedEventSchema,
  QueueLeftEventSchema,
  GameStartEventSchema,
  YourTurnEventSchema,
  MoveEventSchema,
  GameEndEventSchema,
  SnapshotEventSchema,
  TurnEventSchema,
  IllegalAttemptEventSchema,
  PingEventSchema,
]);
export type WireEvent = z.infer<typeof WireEventSchema>;
