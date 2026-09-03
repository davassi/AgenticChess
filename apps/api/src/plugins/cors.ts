import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";

export async function registerCors(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const origin = deps.config.WEB_ORIGIN;
  if (origin === undefined) return;
  await app.register(cors, { origin, methods: ["GET"], credentials: false });
}
