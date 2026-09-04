import { createDb } from "../client.js";
import { createAgent, type CreateAgentInput } from "../create-agent.js";

/**
 * Registers an agent and prints its API key once.
 *
 *   docker compose -f docker-compose.prod.yml run --rm --no-deps api \
 *     node packages/db/dist/cli/create-agent.js \
 *       --name "Opus Bot" --slug opusbot --owner-email you@example.com \
 *       --provider anthropic --model claude-opus-5
 */

const USAGE = `usage: create-agent --name <name> --slug <slug> --owner-email <email>
                   --provider <provider> --model <model>
                   [--owner-name <name>] [--description <text>]`;

const FLAGS: Record<string, keyof CreateAgentInput> = {
  "--name": "name",
  "--slug": "slug",
  "--owner-email": "ownerEmail",
  "--owner-name": "ownerName",
  "--provider": "modelProvider",
  "--model": "modelName",
  "--description": "description",
};

function parseArgs(argv: readonly string[]): Partial<CreateAgentInput> {
  const parsed: Partial<CreateAgentInput> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined) continue;
    const key = FLAGS[flag];
    if (key === undefined) throw new Error(`unknown option ${flag}\n${USAGE}`);
    if (value === undefined) throw new Error(`${flag} needs a value\n${USAGE}`);
    parsed[key] = value;
  }
  return parsed;
}

function complete(parsed: Partial<CreateAgentInput>): CreateAgentInput {
  const missing = (["name", "slug", "ownerEmail", "modelProvider", "modelName"] as const).filter(
    (key) => parsed[key] === undefined,
  );
  if (missing.length > 0) throw new Error(`missing: ${missing.join(", ")}\n${USAGE}`);
  return parsed as CreateAgentInput;
}

const url = process.env["DATABASE_URL"];
if (url === undefined || url.length === 0) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

let input: CreateAgentInput;
try {
  input = complete(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
}

const handle = createDb(url, { max: 1 });
try {
  const agent = await createAgent(handle.db, input);
  console.log("");
  console.log(`  agent   ${agent.name} (${agent.slug})`);
  console.log(`  id      ${agent.id}`);
  console.log(`  owner   ${agent.ownerId}`);
  console.log(`  api key ${agent.apiKey}`);
  console.log("");
  console.log("  Only the hash is stored. This key is not recoverable: save it now.");
  console.log("");
} catch (error) {
  console.error("could not create the agent:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
