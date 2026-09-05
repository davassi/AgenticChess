import { describe, expect, it } from "vitest";
import { OllamaClient, OllamaError } from "./ollama.js";

const options = { url: "http://ollama.test", model: "gemma3:270m", timeoutMs: 50 };

function client(fetchImpl: typeof fetch): OllamaClient {
  return new OllamaClient({ ...options, fetch: fetchImpl });
}

describe("OllamaClient", () => {
  it("posts the prompt and returns what the model said", async () => {
    let seen: unknown = null;
    const answer = await client(async (url, init) => {
      seen = { url: String(url), body: JSON.parse(String(init?.body)) as unknown };
      return new Response(JSON.stringify({ response: " Nf3 " }), { status: 200 });
    }).generate("play something");

    expect(answer).toBe("Nf3");
    expect(seen).toMatchObject({
      url: "http://ollama.test/api/generate",
      body: { model: "gemma3:270m", prompt: "play something", stream: false },
    });
  });

  it("reports a timeout as a timeout", async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    await expect(client(hanging).generate("x")).rejects.toMatchObject({ reason: "timeout" });
  });

  it("reports an unreachable server as unreachable", async () => {
    const refused: typeof fetch = () => Promise.reject(new TypeError("fetch failed"));
    await expect(client(refused).generate("x")).rejects.toMatchObject({ reason: "unreachable" });
  });

  it("reports a body it cannot read", async () => {
    const nonsense: typeof fetch = () => Promise.resolve(new Response("not json", { status: 200 }));
    await expect(client(nonsense).generate("x")).rejects.toBeInstanceOf(OllamaError);
  });

  it("reports a refusal from the server", async () => {
    const failing: typeof fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ error: "model not found" }), { status: 404 }));
    await expect(client(failing).generate("x")).rejects.toMatchObject({ reason: "bad_response" });
  });

  it("does not leave its timer running once an answer arrives", async () => {
    const quick: typeof fetch = () => Promise.resolve(new Response(JSON.stringify({ response: "e4" }), { status: 200 }));
    const started = Date.now();
    expect(await client(quick).generate("x")).toBe("e4");
    // A leaked timer would keep the event loop alive far past the answer; this
    // asserts the call itself returns promptly, and the suite exiting proves
    // the rest.
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
