import { EventEmitter } from "node:events";
import type { FastifyReply } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { openSse } from "./stream.js";

function mockReply(): { reply: FastifyReply; emitClose: () => void } {
  const raw = new EventEmitter() as EventEmitter & {
    writeHead: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    end: () => void;
  };
  raw.writeHead = vi.fn();
  raw.write = vi.fn();
  raw.end = () => {
    raw.emit("close");
  };
  const reply = {
    raw,
    hijack: vi.fn(),
    getHeaders: () => ({ "x-request-id": "from-app" }),
  };
  return {
    reply: reply as unknown as FastifyReply,
    emitClose: () => raw.emit("close"),
  };
}

describe("openSse", () => {
  it("runs onClose immediately when the socket is already closed", () => {
    const { reply, emitClose } = mockReply();
    const connection = openSse(reply, "req-1");
    emitClose();
    expect(connection.closed).toBe(true);
    const handler = vi.fn();
    connection.onClose(handler);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not send after close", () => {
    const { reply, emitClose } = mockReply();
    const connection = openSse(reply, "req-1");
    emitClose();
    expect(connection.send({ type: "ping", at: "2026-09-04T00:00:00.000Z" })).toBe(false);
  });
});
