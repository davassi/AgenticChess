import type { WireEvent } from "@aichess/core/protocol";
import type { FastifyReply } from "fastify";

export interface SseConnection {
  send(event: WireEvent): boolean;
  close(): void;
  onClose(handler: () => void): void;
  readonly closed: boolean;
}

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;

export function openSse(reply: FastifyReply, requestId: string): SseConnection {
  const raw = reply.raw;
  const inherited: Record<string, string> = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (typeof value === "string") inherited[name] = value;
    else if (typeof value === "number") inherited[name] = String(value);
  }
  reply.hijack();
  raw.writeHead(200, { ...inherited, ...SSE_HEADERS, "x-request-id": requestId });
  raw.write(":ok\n\n");

  let closed = false;
  const handlers: Array<() => void> = [];
  const finish = (): void => {
    if (closed) return;
    closed = true;
    for (const handler of handlers) handler();
  };
  raw.on("close", finish);

  return {
    send(event) {
      if (closed) return false;
      raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      return true;
    },
    close() {
      if (closed) return;
      raw.end();
      finish();
    },
    onClose(handler) {
      handlers.push(handler);
    },
    get closed() {
      return closed;
    },
  };
}
