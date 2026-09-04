import { describe, expect, it } from "vitest";
import { SseDecoder } from "./sse.js";

const hello = 'event: hello\ndata: {"type":"hello","agentId":"a1","activeGame":null,"queue":null}\n\n';
const ping = 'event: ping\ndata: {"type":"ping","at":"2026-09-04T10:00:00.000Z"}\n\n';

describe("SseDecoder", () => {
  it("decodes one complete frame into one event", () => {
    const events = new SseDecoder().push(hello);

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("hello");
  });

  it("decodes two frames arriving in one chunk", () => {
    const events = new SseDecoder().push(hello + ping);

    expect(events.map((e) => e.type)).toEqual(["hello", "ping"]);
  });

  it("holds a frame split across chunks until the blank line arrives", () => {
    const decoder = new SseDecoder();
    const half = Math.floor(hello.length / 2);

    expect(decoder.push(hello.slice(0, half))).toEqual([]);
    expect(decoder.push(hello.slice(half)).map((e) => e.type)).toEqual(["hello"]);
  });

  it("ignores the comment line the arena opens the stream with", () => {
    const decoder = new SseDecoder();

    expect(decoder.push(":ok\n\n")).toEqual([]);
    expect(decoder.push(ping).map((e) => e.type)).toEqual(["ping"]);
  });

  it("accepts CRLF line endings, which a proxy may rewrite", () => {
    const events = new SseDecoder().push(hello.replace(/\n/g, "\r\n"));

    expect(events.map((e) => e.type)).toEqual(["hello"]);
  });

  it("drops a frame whose data is not JSON and keeps decoding the next one", () => {
    const decoder = new SseDecoder();

    expect(decoder.push("event: hello\ndata: {not json\n\n")).toEqual([]);
    expect(decoder.push(ping).map((e) => e.type)).toEqual(["ping"]);
  });

  it("joins a data payload spread over several data lines", () => {
    const events = new SseDecoder().push('data: {"type":"ping",\ndata: "at":"2026-09-04T10:00:00.000Z"}\n\n');

    expect(events.map((e) => e.type)).toEqual(["ping"]);
  });

  it("handles CRLF split at a chunk boundary without creating false frame boundaries", () => {
    const decoder = new SseDecoder();
    const crlfFrame = hello.replace(/\n/g, "\r\n");
    // Split after the first "hello\r", so next chunk starts with "\n"
    const splitPoint = crlfFrame.indexOf("hello") + "hello".length + 1; // +1 for the \r

    expect(decoder.push(crlfFrame.slice(0, splitPoint))).toEqual([]);
    expect(decoder.push(crlfFrame.slice(splitPoint)).map((e) => e.type)).toEqual(["hello"]);
  });
});
