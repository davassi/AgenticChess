import type { z } from "zod";
import { ApiError } from "./errors.js";
import { parseWith } from "./validation.js";

export function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<T>(raw: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ApiError("validation_error", "Invalid query", {
      where: "query",
      issues: [{ path: "cursor", message: "Malformed cursor" }],
    });
  }
  return parseWith(schema, parsed, "query");
}
