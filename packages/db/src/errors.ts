export const UNIQUE_VIOLATION = "23505";

/** Postgres error codes travel inside `cause` when Drizzle wraps a query error. */
export function pgErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const record = error as Record<string, unknown>;
  const code = record["code"];
  if (typeof code === "string") return code;
  return pgErrorCode(record["cause"]);
}
