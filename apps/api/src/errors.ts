import type { ErrorCode, ErrorResponse } from "@aichess/core/protocol";

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthorized: 401,
  agent_suspended: 403,
  not_found: 404,
  validation_error: 400,
  not_your_turn: 409,
  stale_ply: 409,
  game_not_active: 409,
  illegal_move: 422,
  already_in_queue: 409,
  not_in_queue: 409,
  in_active_game: 409,
  rate_limited: 429,
  service_unavailable: 503,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export function toErrorBody(error: ApiError): ErrorResponse {
  return error.details === undefined
    ? { error: error.code, message: error.message }
    : { error: error.code, message: error.message, details: error.details };
}
