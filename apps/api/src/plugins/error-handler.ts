import type { FastifyInstance } from "fastify";
import { ApiError, toErrorBody } from "../errors.js";

interface HttpLikeError {
  statusCode?: number;
  code?: string;
}

const NODE_NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND"]);

function codeOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function isConnectivityError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  if (name === "MaxRetriesPerRequestError") return true;
  for (const code of [codeOf(error), codeOf((error as { cause?: unknown }).cause)]) {
    if (code === undefined) continue;
    if (NODE_NETWORK_CODES.has(code)) return true;
    if (code.startsWith("08") || code.startsWith("57P")) return true;
  }
  return false;
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: "not_found", message: "Route not found" });
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.status).send(toErrorBody(error));
      return;
    }
    if (isConnectivityError(error)) {
      request.log.error({ err: error }, "dependency unavailable");
      reply.status(503).send({ error: "service_unavailable", message: "A dependency is unavailable" });
      return;
    }
    const http = error as HttpLikeError;
    if (http.statusCode === 429) {
      const body = error as { message?: string; details?: Record<string, unknown> };
      reply.status(429).send({
        error: "rate_limited",
        message: body.message ?? "Too many requests",
        ...(body.details === undefined ? {} : { details: body.details }),
      });
      return;
    }
    if (http.statusCode !== undefined && http.statusCode >= 400 && http.statusCode < 500) {
      reply.status(400).send({ error: "validation_error", message: "Malformed request" });
      return;
    }
    request.log.error({ err: error }, "unhandled error");
    reply.status(500).send({ error: "internal_error", message: "Internal error", details: { requestId: request.id } });
  });
}
