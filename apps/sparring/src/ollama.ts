export type OllamaFailure = "timeout" | "unreachable" | "bad_response";

/** Carries why the model did not answer, so the move's comment can say it. */
export class OllamaError extends Error {
  constructor(
    readonly reason: OllamaFailure,
    message: string,
  ) {
    super(message);
    this.name = "OllamaError";
  }
}

export interface OllamaOptions {
  url: string;
  model: string;
  timeoutMs: number;
  /** Injected so tests never open a socket. */
  fetch?: typeof fetch;
  numPredict?: number;
  temperature?: number;
}

const DEFAULT_NUM_PREDICT = 16;
const DEFAULT_TEMPERATURE = 0.3;

export class OllamaClient {
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: OllamaOptions) {
    this.doFetch = options.fetch ?? fetch;
  }

  /**
   * One generation, capped by its own timer.
   *
   * The timer is the whole reliability story: the arena gives a turn 60 s, and
   * a bot that waits for a model that will never answer loses on time and looks
   * like the newcomer's bug rather than ours.
   */
  async generate(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.options.timeoutMs);
    try {
      const response = await this.doFetch(`${this.options.url.replace(/\/+$/, "")}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.options.model,
          prompt,
          stream: false,
          options: {
            num_predict: this.options.numPredict ?? DEFAULT_NUM_PREDICT,
            temperature: this.options.temperature ?? DEFAULT_TEMPERATURE,
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new OllamaError("bad_response", `ollama answered ${String(response.status)}`);
      }
      const body: unknown = await response.json().catch(() => null);
      if (typeof body !== "object" || body === null || typeof (body as { response?: unknown }).response !== "string") {
        throw new OllamaError("bad_response", "ollama returned a body with no response field");
      }
      return (body as { response: string }).response.trim();
    } catch (error) {
      if (error instanceof OllamaError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new OllamaError("timeout", `ollama did not answer within ${String(this.options.timeoutMs)} ms`);
      }
      throw new OllamaError("unreachable", `ollama is unreachable: ${String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
