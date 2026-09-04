import type { FetchLike } from "./http.js";

export interface FakeFetch {
  fetch: FetchLike;
  calls: Array<{ url: string; init: RequestInit }>;
}

/** A fetch that replays a script of responses in order and records every call. */
export function fakeFetch(script: Array<Response | Error>): FakeFetch {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const queue = [...script];
  const fetchLike = ((url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init: init ?? {} });
    const next = queue.shift();
    if (next === undefined)
      return Promise.reject(new Error(`fetch called ${calls.length} times, script had ${script.length}`));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as unknown as FetchLike;
  return { fetch: fetchLike, calls };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A streaming response: Response provides the body stream from the joined text. */
export function sseResponse(chunks: string[]): Response {
  return new Response(chunks.join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}
