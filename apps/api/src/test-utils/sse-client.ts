import { WireEventSchema, type WireEvent } from "@aichess/core/protocol";

export interface SseClient {
  status: number;
  body: string;
  take(type?: WireEvent["type"], timeoutMs?: number): Promise<WireEvent>;
  closed: Promise<void>;
  close(): void;
}

interface Waiter {
  type: WireEvent["type"] | undefined;
  resolve: (event: WireEvent) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function parseFrame(frame: string): WireEvent | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  return WireEventSchema.parse(JSON.parse(dataLines.join("\n")));
}

export async function openSseClient(url: string, headers: Record<string, string> = {}): Promise<SseClient> {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { accept: "text/event-stream", ...headers },
    signal: controller.signal,
  });
  const queue: WireEvent[] = [];
  const waiters: Waiter[] = [];
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const deliver = (event: WireEvent): void => {
    const index = waiters.findIndex((w) => w.type === undefined || w.type === event.type);
    if (index === -1) {
      queue.push(event);
      return;
    }
    const [waiter] = waiters.splice(index, 1);
    if (waiter === undefined) return;
    clearTimeout(waiter.timer);
    waiter.resolve(event);
  };

  const client: SseClient = {
    status: response.status,
    body: "",
    take: (type, timeoutMs = 5_000) => {
      const index = queue.findIndex((e) => type === undefined || e.type === type);
      if (index !== -1) {
        const [event] = queue.splice(index, 1);
        if (event !== undefined) return Promise.resolve(event);
      }
      return new Promise<WireEvent>((resolve, reject) => {
        const timer = setTimeout(() => {
          const at = waiters.findIndex((w) => w.resolve === resolve);
          if (at !== -1) waiters.splice(at, 1);
          reject(
            new Error(`timed out waiting for ${type ?? "any event"}; queued: ${queue.map((e) => e.type).join(",")}`),
          );
        }, timeoutMs);
        waiters.push({ type, resolve, reject, timer });
      });
    },
    closed,
    close: () => controller.abort(),
  };

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || response.body === null || !contentType.includes("text/event-stream")) {
    client.body = await response.text();
    resolveClosed();
    return client;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  void (async () => {
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = parseFrame(frame);
          if (event !== null) deliver(event);
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // aborted by the client or closed by the server
    } finally {
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("stream closed"));
      }
      resolveClosed();
    }
  })();

  return client;
}
