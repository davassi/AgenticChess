import { createDb } from "../client.js";
import { ensureSparringAgent } from "../sparring.js";

/**
 * Makes the database agree with the sparring bot's environment.
 *
 * Runs as a one-shot beside the migration:
 *
 *   docker compose -f docker-compose.prod.yml run --rm --no-deps api \
 *     node packages/db/dist/cli/ensure-sparring.js
 *
 * Re-running it is safe: it adopts a rotated key and puts a suspended house
 * agent back in service, and changes nothing else.
 */

const url = process.env["DATABASE_URL"];
const apiKey = process.env["SPARRING_API_KEY"];

if (url === undefined || url.length === 0) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
// A missing key is not a failure. This runs as a one-shot that the sparring
// container waits on, and `docker compose up -d` fails the whole command when a
// dependency exits non-zero - under the deploy script's `set -e` that would
// abort the release before the Caddy reload, over an optional subsystem. The
// service reads the same variable and idles without it.
if (apiKey === undefined || apiKey.length === 0) {
  console.warn("SPARRING_API_KEY is not set: leaving the house agent alone, the arena runs without one");
  process.exit(0);
}

// One identity per key, so a second house agent is a comma in the environment
// rather than a change here. Each needs its own slug.
const keys = apiKey
  .split(",")
  .map((key) => key.trim())
  .filter((key) => key.length > 0);
const baseSlug = process.env["SPARRING_SLUG"] ?? "sparring";
const baseName = process.env["SPARRING_NAME"] ?? "Sparring Partner";

const handle = createDb(url, { max: 1 });
try {
  for (const [index, key] of keys.entries()) {
    const suffix = index === 0 ? "" : `-${String(index + 1)}`;
    const agent = await ensureSparringAgent(handle.db, {
      apiKey: key,
      slug: `${baseSlug}${suffix}`,
      name: index === 0 ? baseName : `${baseName} ${String(index + 1)}`,
      description:
        process.env["SPARRING_DESCRIPTION"] ??
        "The arena's house agent. It plays gemma3:270m through Ollama, waits in the unrated queue, and its games never move a rating.",
      ownerEmail: process.env["SPARRING_OWNER_EMAIL"] ?? "house@agenticchess.online",
      modelProvider: process.env["SPARRING_MODEL_PROVIDER"] ?? "ollama",
      modelName: process.env["SPARRING_MODEL"] ?? "gemma3:270m",
    });
    console.log(`sparring agent ${baseSlug}${suffix} ${agent.created ? "created" : "already present"}: ${agent.id}`);
  }
} catch (error) {
  console.error("could not ensure the sparring agent:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
