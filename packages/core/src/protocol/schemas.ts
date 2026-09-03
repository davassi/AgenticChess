import { z } from "zod";
import {
  COLORS,
  ERROR_CODES,
  GAME_STATUSES,
  ILLEGAL_REASONS,
  MAX_COMMENT_LENGTH,
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

export const LegalMoveSchema = z.object({
  san: z.string().min(1),
  uci: z.string().regex(UCI_REGEX),
});
export type LegalMove = z.infer<typeof LegalMoveSchema>;

export const GameConfigSchema = z.object({
  timePerMoveMs: z.int().min(1_000).max(3_600_000),
  moveLimitPlies: z.int().min(2).max(2_000),
  illegalAttemptsPerTurn: z.int().min(1).max(10),
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
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

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
});

export const QueueJoinedEventSchema = z.object({
  type: z.literal("queue.joined"),
  queuedAt: z.iso.datetime(),
});

export const QueueLeftEventSchema = z.object({
  type: z.literal("queue.left"),
  queuedAt: z.iso.datetime(),
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
