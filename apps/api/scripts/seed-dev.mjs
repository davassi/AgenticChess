/*
 * Local development seed: two owners, four agents with real API keys, a few
 * finished games with moves and ratings, and one live game to watch. Run it
 * against a throwaway database only.
 *
 *   DATABASE_URL=... node apps/web/seed-dev.mjs
 */
import { generateApiKey } from "@aichess/core";
import { agents, createDb, games, moves, ratingHistory, ratings, users } from "@aichess/db";

const url = process.env.DATABASE_URL;
if (url === undefined) throw new Error("DATABASE_URL is required");
const handle = createDb(url);
const db = handle.db;

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const ROSTER = [
  { slug: "opusbot", name: "opusbot", provider: "Anthropic", model: "claude-opus-5", rating: 1688, rd: 62, games: 41 },
  {
    slug: "gambit-flash",
    name: "gambit-flash",
    provider: "Google",
    model: "gemini-2.5-pro",
    rating: 1641,
    rd: 70,
    games: 36,
  },
  { slug: "tal-turbo", name: "tal-turbo", provider: "OpenAI", model: "gpt-5", rating: 1529, rd: 92, games: 19 },
  { slug: "fresh-fish", name: "fresh-fish", provider: "OpenAI", model: "gpt-5-nano", rating: 1500, rd: 350, games: 0 },
];

async function main() {
  const [owner, other] = await db
    .insert(users)
    .values([
      { email: "player-one@example.com", name: "player-one" },
      { email: "mara@example.com", name: "mara" },
    ])
    .returning({ id: users.id });

  const keys = new Map();
  const rows = [];
  for (const [index, entry] of ROSTER.entries()) {
    const key = generateApiKey();
    keys.set(entry.slug, key.key);
    rows.push({
      ownerId: index % 2 === 0 ? owner.id : other.id,
      name: entry.name,
      slug: entry.slug,
      description: `${entry.provider} ${entry.model}, seeded for local development.`,
      modelProvider: entry.provider,
      modelName: entry.model,
      apiKeyPrefix: key.prefix,
      apiKeyHash: key.hash,
    });
  }
  const inserted = await db.insert(agents).values(rows).returning({ id: agents.id, slug: agents.slug });
  const bySlug = new Map(inserted.map((row) => [row.slug, row.id]));

  await db.insert(ratings).values(
    ROSTER.map((entry) => ({
      agentId: bySlug.get(entry.slug),
      rating: entry.rating,
      rd: entry.rd,
      volatility: 0.06,
      gamesPlayed: entry.games,
    })),
  );

  const now = Date.now();
  const finished = [
    { white: "opusbot", black: "tal-turbo", result: "1-0", termination: "checkmate", minutesAgo: 20 },
    { white: "gambit-flash", black: "opusbot", result: "0-1", termination: "resignation", minutesAgo: 90 },
    { white: "tal-turbo", black: "gambit-flash", result: "1/2-1/2", termination: "stalemate", minutesAgo: 400 },
  ];
  for (const game of finished) {
    const createdAt = new Date(now - game.minutesAgo * 60_000);
    const [row] = await db
      .insert(games)
      .values({
        whiteAgentId: bySlug.get(game.white),
        blackAgentId: bySlug.get(game.black),
        status: "finished",
        result: game.result,
        termination: game.termination,
        timePerMoveMs: 60_000,
        moveLimitPlies: 300,
        illegalAttemptsPerTurn: 3,
        currentFen: START_FEN,
        ply: 4,
        createdAt,
        startedAt: createdAt,
        finishedAt: new Date(createdAt.getTime() + 8 * 60_000),
        pgn: `[Event "AgenticChess rated game"]\n\n1. e4 e5 2. Nf3 Nc6 ${game.result}`,
      })
      .returning({ id: games.id });
    await db.insert(moves).values([
      {
        gameId: row.id,
        ply: 1,
        color: "white",
        san: "e4",
        uci: "e2e4",
        fenAfter: START_FEN,
        comment: "Centre.",
        thinkTimeMs: 8_100,
        illegalAttemptsBefore: 0,
      },
      {
        gameId: row.id,
        ply: 2,
        color: "black",
        san: "e5",
        uci: "e7e5",
        fenAfter: START_FEN,
        comment: "Symmetry for now.",
        thinkTimeMs: 4_200,
        illegalAttemptsBefore: 0,
      },
      {
        gameId: row.id,
        ply: 3,
        color: "white",
        san: "Nf3",
        uci: "g1f3",
        fenAfter: START_FEN,
        comment: "Pressure on e5.",
        thinkTimeMs: 6_400,
        illegalAttemptsBefore: 0,
      },
      {
        gameId: row.id,
        ply: 4,
        color: "black",
        san: "Nc6",
        uci: "b8c6",
        fenAfter: START_FEN,
        comment: "Defending.",
        thinkTimeMs: 3_900,
        illegalAttemptsBefore: 0,
      },
    ]);
    await db.insert(ratingHistory).values([
      { agentId: bySlug.get(game.white), gameId: row.id, ratingBefore: 1600, ratingAfter: 1620, rdAfter: 80 },
      { agentId: bySlug.get(game.black), gameId: row.id, ratingBefore: 1600, ratingAfter: 1580, rdAfter: 82 },
    ]);
  }

  console.log("seeded agents:");
  for (const [slug, key] of keys) console.log(`  ${slug}: ${key}`);
  console.log("\nstart a live game with:");
  console.log(`  whiteAgentId=${bySlug.get("opusbot")} blackAgentId=${bySlug.get("gambit-flash")}`);
}

try {
  await main();
} finally {
  await handle.close();
}
