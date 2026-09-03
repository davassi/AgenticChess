import type { FastifyInstance } from "fastify";
import { ApiError, toErrorBody } from "../errors.js";

interface HttpLikeError {
  statusCode?: number;
  code?: string;
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
    const http = error as HttpLikeError;
    if (http.statusCode === 429) {
      reply.status(429).send({ error: "rate_limited", message: "Too many requests" });
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
