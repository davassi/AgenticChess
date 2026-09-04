import { ErrorResponseSchema, type ErrorCode } from "@aichess/core/protocol";
import type { z } from "zod";

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

/**
 * One JSON read, with the arena's error body honoured and its shape checked.
 * Server components reach it through api.ts with the internal address; the
 * browser reaches it with the public one, which is why the url arrives whole
 * rather than as a path.
 */
export async function getJsonFrom<T>(url: string, schema: z.ZodType<T>, label: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new ApiRequestError(503, "service_unavailable", `The arena API did not answer (${label})`);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = ErrorResponseSchema.safeParse(payload);
    throw new ApiRequestError(
      response.status,
      body.success ? body.data.error : "internal_error",
      body.success ? body.data.message : `The arena API answered ${response.status} (${label})`,
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiRequestError(502, "internal_error", `The arena API answered with an unexpected shape (${label})`);
  }
  return parsed.data;
}
