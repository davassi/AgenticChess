import type { ErrorCode } from "@aichess/core/protocol";

/**
 * An error the arena reported, with the stable code SDKs branch on.
 *
 * `code` is typed as the arena's enum because the API serialises it from that
 * enum. The type is a promise about the arena, not a runtime check: a code this
 * version of the SDK has never heard of still arrives intact.
 */
export class ArenaError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ArenaError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /**
   * Build from a parsed response body. Anything between the agent and the arena
   * can answer instead of the arena - a proxy, a load balancer, a crash - so the
   * body is not assumed to have the documented shape.
   */
  static fromBody(status: number, body: unknown): ArenaError {
    if (typeof body !== "object" || body === null) {
      return new ArenaError("internal_error", status, `Arena returned ${status} with an unreadable body`);
    }
    const record: Record<string, unknown> = { ...body };
    const rawCode = record["error"];
    const rawMessage = record["message"];
    const rawDetails = record["details"];
    const code = typeof rawCode === "string" ? (rawCode as ErrorCode) : "internal_error";
    const message = typeof rawMessage === "string" ? rawMessage : `Arena returned ${status}`;
    const details =
      typeof rawDetails === "object" && rawDetails !== null
        ? ({ ...rawDetails } as Record<string, unknown>)
        : undefined;
    return new ArenaError(code, status, message, details);
  }
}
