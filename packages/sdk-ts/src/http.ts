import { nextDelay } from "./backoff.js";
import { ArenaError } from "./errors.js";

export type FetchLike = typeof fetch;

export interface HttpOptions {
  baseUrl: string;
  apiKey: string;
  fetch: FetchLike;
  sleep: (ms: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
}

const RETRY_BASE_MS = 250;
const RETRY_CAP_MS = 2_000;
const DEFAULT_MAX_ATTEMPTS = 3;

async function toError(response: Response): Promise<ArenaError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return ArenaError.fromBody(response.status, body);
}

/**
 * Requests to the arena, retrying only what is safe to retry.
 *
 * A network failure and a 503 are retried with the same body: every mutating
 * endpoint carries the `ply` the caller believes it is playing, which is what
 * makes a repeat idempotent server-side. Nothing else is retried - repeating a
 * rejected move verbatim would spend the turn's three attempts on one mistake.
 *
 * Both retryable failures share one attempt counter: it is incremented at the
 * point the retry decision is made, and the wait before the next try is
 * `nextDelay(attempt - 1, ...)`. A network failure has no body to report, so
 * exhausting it raises a synthetic `service_unavailable`. A 503 does have a
 * body, so exhausting it raises the arena's own error via `ArenaError.fromBody`
 * instead of that synthetic error.
 */
export class ArenaHttp {
  readonly maxAttempts: number;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly doFetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: (() => number) | undefined;

  constructor(options: HttpOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.doFetch = options.fetch;
    this.sleep = options.sleep;
    this.random = options.random;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /** Open the event stream. Not retried here: reconnection belongs to the client. */
  async open(path: string, signal: AbortSignal): Promise<Response> {
    const response = await this.doFetch(this.url(path), {
      headers: { authorization: `Bearer ${this.apiKey}`, accept: "text/event-stream" },
      signal,
    });
    if (!response.ok) throw await toError(response);
    return response;
  }

  async requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    let attempt = 0;
    for (;;) {
      let response: Response;
      try {
        response = await this.doFetch(this.url(path), {
          method,
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            ...(payload === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(payload === undefined ? {} : { body: payload }),
        });
      } catch (cause) {
        attempt += 1;
        if (attempt >= this.maxAttempts) {
          throw new ArenaError("service_unavailable", 0, `Arena unreachable: ${String(cause)}`);
        }
        await this.sleep(this.delay(attempt - 1));
        continue;
      }

      if (response.status === 503) {
        attempt += 1;
        if (attempt >= this.maxAttempts) {
          throw await toError(response);
        }
        await this.sleep(this.delay(attempt - 1));
        continue;
      }
      if (!response.ok) throw await toError(response);
      return (await response.json()) as T;
    }
  }

  private delay(attempt: number): number {
    return nextDelay(attempt, {
      base: RETRY_BASE_MS,
      cap: RETRY_CAP_MS,
      ...(this.random === undefined ? {} : { random: this.random }),
    });
  }
}
