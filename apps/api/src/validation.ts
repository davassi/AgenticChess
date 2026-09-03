import type { z } from "zod";
import { ApiError } from "./errors.js";

export type Where = "params" | "query" | "body";

export function parseWith<T>(schema: z.ZodType<T>, value: unknown, where: Where): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new ApiError("validation_error", `Invalid ${where}`, {
    where,
    issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}
