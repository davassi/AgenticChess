import { createServer, type Server } from "node:http";

export interface HealthServerInput {
  host: string;
  port: number;
  check: () => Promise<boolean>;
}

export interface HealthServer {
  port: number;
  close: () => Promise<void>;
}

export async function startHealthServer(input: HealthServerInput): Promise<HealthServer> {
  const server: Server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/health") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found", message: "Route not found" }));
      return;
    }
    input
      .check()
      .then((healthy) => {
        response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: healthy ? "ok" : "degraded" }));
      })
      .catch(() => {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "degraded" }));
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.host, () => resolve());
  });
  const address = server.address();
  const port = address !== null && typeof address !== "string" ? address.port : input.port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
        server.closeAllConnections();
      }),
  };
}
