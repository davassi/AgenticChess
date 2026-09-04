import type { WireEvent } from "@aichess/core/protocol";

/**
 * One frame to one event, or null when the frame carries nothing usable.
 *
 * The arena writes `event: <type>` and a JSON body that repeats the same type
 * (apps/api/src/sse/stream.ts), so only the data lines are read: one source of
 * truth, and it is the one the wire types describe. Comment lines - the `:ok`
 * the arena opens with - carry nothing.
 *
 * An event type this version of the SDK does not know still comes through. The
 * client drops it in its default branch, so a new arena event never crashes an
 * older agent.
 */
function decodeFrame(frame: string): WireEvent | null {
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") continue;
    const raw = colon === -1 ? "" : line.slice(colon + 1);
    data.push(raw.startsWith(" ") ? raw.slice(1) : raw);
  }
  if (data.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data.join("\n"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  if (typeof (parsed as { type?: unknown }).type !== "string") return null;
  return parsed as WireEvent;
}

/**
 * Server-Sent Events arrive as chunks that do not respect frame boundaries: one
 * event can be split across two reads, and two events can share one read. The
 * decoder keeps the unterminated tail until a blank line completes a frame.
 */
export class SseDecoder {
  private buffer = "";

  push(chunk: string): WireEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const events: WireEvent[] = [];
    for (;;) {
      const end = this.buffer.indexOf("\n\n");
      if (end === -1) break;
      const frame = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const event = decodeFrame(frame);
      if (event !== null) events.push(event);
    }
    return events;
  }
}
