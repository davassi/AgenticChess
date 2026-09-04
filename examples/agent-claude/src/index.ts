import Anthropic from "@anthropic-ai/sdk";
import { AgenticChessClient, type MoveChoice, type Turn } from "@agenticchess/sdk";
import { firstLegal, toLegalChoice } from "./choose.js";

const MODEL = process.env["AGENT_MODEL"] ?? "claude-sonnet-5";
const BASE_URL = process.env["AGENTICCHESS_BASE_URL"] ?? "https://api.agenticchess.online";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. The arena issues the key once, on the dashboard.`);
  }
  return value;
}

function prompt(turn: Turn): string {
  return [
    "You are playing a rated chess game. Answer with one move and nothing else.",
    `Position (FEN): ${turn.fen}`,
    `Moves so far: ${turn.history.join(" ") || "none"}`,
    `Legal moves: ${turn.legalMoves.map((move) => move.san).join(" ")}`,
    "Answer with exactly one move from that list, in SAN.",
  ].join("\n");
}

async function main(): Promise<void> {
  const apiKey = requireEnv("AGENTICCHESS_API_KEY");
  const modelKey = process.env["ANTHROPIC_API_KEY"];
  const anthropic = modelKey === undefined || modelKey === "" ? null : new Anthropic({ apiKey: modelKey });

  if (anthropic === null) {
    console.warn("ANTHROPIC_API_KEY is not set: playing the first legal move every turn.");
  }

  const client = new AgenticChessClient({
    apiKey,
    baseUrl: BASE_URL,
    onEvent: (event) => {
      if (event.type === "game.start")
        console.log(`game ${event.gameId}: ${event.color} against ${event.opponent.name}`);
      if (event.type === "game.end") {
        console.log(`game ${event.gameId}: ${event.result} by ${event.termination}`);
        // One game is not the agent's career: re-queue so it keeps playing
        // instead of holding an open stream and idling forever.
        void client.joinQueue().catch((error: unknown) => console.error("could not re-queue:", error));
      }
    },
    onError: (error) => console.error("recovered:", error),
  });

  client.onYourTurn(async (turn): Promise<MoveChoice> => {
    if (anthropic === null) return firstLegal(turn);
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 64,
      messages: [{ role: "user", content: prompt(turn) }],
    });
    const block = response.content[0];
    const said = block !== undefined && block.type === "text" ? block.text : "";
    return toLegalChoice(said, turn);
  });

  await client.joinQueue();
  console.log("queued. waiting for an opponent.");
  await client.run();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
