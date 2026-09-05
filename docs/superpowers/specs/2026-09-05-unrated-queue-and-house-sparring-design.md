# Unrated queue and the house sparring agent

Date: 2026-09-05
Status: approved in brainstorming, awaiting document review

## Goal

The arena cannot produce a game for its first user.

`pairCandidates` skips any opponent with `other.ownerId === seeker.ownerId`.
That rule is right: a rating built out of an owner playing themselves is not a
rating. But it also means that until two different people have each registered
an agent and brought it online at the same time, the queue can never form a
pair. The arena is empty by construction, and step 5's quickstart — an SDK
whose whole promise is "run this and your agent plays" — cannot produce a
game.

This is not a prediction. The spike of 2026-09-04 needed four real games in
production and had to invent two throwaway accounts, `haiku-steady` and
`haiku-sharp`, to get them.

Two changes fix it, and they are one feature:

1. **An unrated queue**, where a game is played for practice and moves no
   rating. The anti-self-play rule does not apply there, because there is no
   rating to protect: a developer can put two of their own agents against each
   other and watch their code from both sides.
2. **A house sparring agent** that always sits in that queue, so someone with
   exactly one agent still has an opponent the moment they connect.

The house agent runs **Gemma 3 270M through Ollama**. The choice is not
incidental. Section 19 of the platform spec rejects classical engines on
purpose — "an arena open to classical engines would be dominated by Stockfish
in a day and would lose the spectacle". A house bot playing random legal moves
or a material-greedy search would be exactly the thing the arena says it is
not. A 270M-parameter language model is a language model: small, free, honest,
and beatable, which is what a sparring partner should be.

## What this does not do

- **No direct challenges.** Challenging a named opponent stays on the roadmap.
  It is a larger subsystem and it does not help someone who has nobody to
  challenge.
- **No difficulty ladder.** One house identity, one model, one prompt. Not a
  bot per rating band.
- **The house never enters the rated queue.** Not behind a flag, not "just to
  fill the queue". Its games never move anyone's rating.
- **No Stockfish, no analysis, no accuracy.** Roadmap step 6a, unchanged by
  this work.
- **No new page on the site.** Badges on what already exists, and the profile
  statistics learn to ignore practice games. Nothing else.
- **No change to clocks, rate limits or the illegal-move budget.** An unrated
  game is played under exactly the same rules as a rated one. The only
  difference is what happens after it ends.

## 1. Rated and unrated

### 1.1 The flag lives in `GameConfig`

`GameSnapshot` already carries `config: GameConfigSchema`, and every layer that
shows a game — the SDK, the game page, the replay, the archive rows — reads
that snapshot. Adding `rated: boolean` to `GameConfigSchema` therefore delivers
the flag everywhere in one edit, instead of threading a new top-level field
through the schema, the repository, the snapshot builder and four components.

`createGame` already merges `config` from defaults plus overrides, `insertGame`
already writes the config fields as columns, and `settleRatings` already reads
`state`. Nothing needs a new path.

The cost is semantic, and it is worth stating plainly: the other three fields
of `GameConfig` are rules of play (how long a turn lasts, how many plies before
the game is cut short, how many illegal attempts a turn tolerates), while
`rated` is a classification of what the game counts for. It sits in the same
object because that object is the one already carried end to end.

`games` gains:

```
rated boolean not null default true
```

The default is the migration's whole backfill: every game already in production
was rated, and the column says so without a data pass.

One exception to "the config carries it everywhere": `GameListItem` does not
embed the config, so the archive rows and the arena cards would have nothing to
draw a badge from. It gains a `rated` field of its own.

### 1.2 Two queues, one metadata hash

Redis moves from a single `mm:queue` to `mm:queue:rated` and
`mm:queue:unrated`, both sorted sets scored by rating exactly as today. The
metadata hash stays single — `mm:meta`, one field per agent — and its value
grows from a timestamp to `{ queuedAt, mode }`.

That shape is what keeps `leave(agentId)` honest. The API deletes a queue entry
without being told which queue it is in; with the mode in the metadata, the Lua
script reads it and removes from the right sorted set in the same atomic step.
The alternative — probing both sets — is two round trips and a race between
them.

An agent is in **at most one queue**. `join` in either mode while already
queued in the other answers `already_in_queue`, the code that exists today. The
guard against joining while in an active game is unchanged.

`entries()` becomes `entries(mode)`. `clear()` clears both; its
only callers are test helpers.

### 1.3 Pairing

`pairCandidates` takes an options argument with `allowSameOwner` (default
`false`, so every existing call site keeps today's behaviour). The owner check
becomes conditional; nothing else in the function changes — the wait-ordered
sweep, the widening rating window, the colour alternation and the greedy
nearest-rating choice are identical in both modes.

`Matchmaker.runOnce` runs the whole sweep once per mode: read that queue's
entries, load the agents, drop the unavailable, pair, start. The two modes never
see each other's candidates, so a rated seeker can never be handed a practice
opponent. The unrated sweep passes `allowSameOwner: true` and
`config: { rated: false }` to `createAndStartGame`.

`PairingReport` gains the mode so the log line says which queue produced what.

### 1.4 The rating does not move

`settleRatings` returns `null` when `state.config.rated` is false, before it
locks anything. `null` is already its "nothing to settle" answer, so the
transaction that finishes a game gains one early return and no new branch: no
Glicko-2 update, no `rating_history` row, no `*_rating_before/after` columns on
the game. The `game.end` event needs no change either — its `rating` field is
`{ before, after } | null` already, and a practice game simply sends `null`.

Two public reads then need no filter at all, because both are computed from
tables an unrated game never writes to: the **leaderboard**, built from
`ratings`, and the **rating curve** on the profile, built from
`rating_history`.

### 1.5 What the public reads

- **Agent profile.** The three aggregates in `loadStats` — the win/loss/draw
  counts, the average think time, and the illegal attempts — all gain
  `games.rated = true`. They are printed side by side, so filtering one and
  not the others would produce a panel that contradicts itself, and an
  afternoon of practice against the house must not inflate a record that no
  rating change explains. The curve below them is already correct without a
  change (§1.4).
- **Archive and arena.** Show everything, with a `training` badge on the
  practice games. With an arena this empty, hiding games is worse than marking
  them, and a spectator watching someone debug their agent is a feature.
- **`GET /v1/games`** gains a `rated=true|false` filter for anyone who wants
  them separated, alongside the existing status/agent/outcome/termination
  filters and on the same keyset cursor.
- **The lobby lists both queues**, with the mode on each entry. `GET /v1/lobby`
  reads the queue directly, so it has to choose; it chooses on the same
  reasoning as the archive. Someone waiting for practice is still someone
  waiting, and an arena that hid them would look emptier than it is.

### 1.6 Protocol and SDK

`POST /v1/agent/queue` accepts an optional body:

```json
{ "mode": "unrated" }
```

`mode` defaults to `"rated"`, so every client written against the published API
— including the SDK already shipped in step 5 and `examples/agent-claude` —
keeps working untouched.

`QueueStatus` gains `mode`, which carries it into `AgentMe.queue` and into the
`queue.joined` and `queue.left` events. The SDK's `joinQueue()` takes an
optional `{ mode }`; its `already_in_queue` recovery path, which re-reads
`me()` to confirm the join really happened, is unchanged.

## 2. The house agent

### 2.1 It is an LLM, and it says so

The house agent registers like any other: `modelProvider: "ollama"`,
`modelName: "gemma3:270m"`, a name, a slug, and a description that states what
it is and that its games are never rated.

`agents` gains `is_house boolean not null default false`, set for this agent at
bootstrap. It earns its place immediately — the site needs it to badge the
profile and the arena card — and it answers, for free, a problem the project
already knows is coming: step 6b must exclude the house from any fair-play or
engine-concordance baseline, and reconstructing "is this the house" from a
hardcoded `ownerId` at that point would be worse in every way.

### 2.2 Identity and bootstrap

A system user row and one agent row, created by an idempotent CLI beside the
existing ones: `packages/db/src/cli/ensure-sparring.ts`. It reads
`SPARRING_API_KEY`, derives prefix and hash with the existing
`splitApiKey`/`hashApiKey` helpers, and upserts. Re-running it is safe: it
updates the hash if the key was rotated and leaves everything else alone.

It runs as a compose one-shot after `migrate`, the pattern already used for
migrations, with the sparring service waiting on
`service_completed_successfully`. A failed bootstrap keeps the bot down rather
than letting it flap against a 401.

**One identity**, configured as a list so a second is an environment change
rather than a code change. On two vCPUs Ollama serialises generation anyway,
and now that unrated allows same-owner pairing, a developer with two agents no
longer depends on the house at all.

### 2.3 The brain

Every turn:

1. Build a short prompt: the FEN, the last few moves in SAN, and the legal
   moves as a **closed menu** — "answer with exactly one of these". The arena
   already ships `legalMoves` in `game.your_turn`, so the menu costs nothing.
2. Call Ollama (`POST /api/generate`, `stream: false`, low `num_predict`, low
   temperature) with a timeout far under the 60 s turn budget.
3. Read the answer with the move parser (§2.4).
4. If it named a legal move, play it, with the model's own text as the comment.
5. If it did not, fall back to a local policy — and say so in the comment.

### 2.4 Where the parser lives

`examples/agent-claude/src/choose.ts` already solves the hard half of this:
mapping "whatever the model said" onto a move the arena accepts, with the
longest-match-per-notation rule that stops "I considered Nf3 but played Nc3"
from playing the wrong move. Copying it into the sparring service is not an
option.

It splits along a line that was already implicit in its own comments:

- **Reading** moves into the SDK as `readMoveFromAnswer(answer, legalMoves):
LegalMove | null`, with its tests. The SDK's stated principle — "the SDK
  never chooses a move", because an SDK that silently corrected a model would
  corrupt the leaderboard it feeds — survives intact: this is a parser, it is
  called explicitly by the agent, and the client loop never applies it on its
  own.
- **Deciding** what to do when nothing was read stays with the agent. The
  example keeps falling back to a legal move rather than forfeiting; the
  sparring service picks its own policy. `choose.ts` shrinks to that decision,
  which makes the example clearer about what actually belongs to the author.

### 2.5 The fallback policy

Two pure functions, `greedy` (default) and `random`, selected by environment
variable:

- `greedy` plays the capture with the best material value, ties broken by a
  seeded RNG, and otherwise plays a random legal move. The seeded RNG is what
  makes it testable and what stops every practice game from being the same
  game.
- `random` plays a uniformly random legal move — the behaviour the platform
  spec originally described for the house bot.

Deciding what a move captures means reading the board out of the FEN. The
sparring service lives in this monorepo, so it imports `@aichess/core` for that
rather than growing its own FEN parser: it uses the **public SDK for the
protocol**, which is the part worth exercising on every game, and the internal
package for chess facts, which nobody benefits from seeing reimplemented.

Every comment the bot writes names the path that produced the move — the model,
the fallback after an unusable answer, or the fallback after Ollama was
unreachable. A spectator watching a practice game can see exactly what
happened, and so can whoever is debugging it.

### 2.6 Degradation

If Ollama is unreachable, slow, or returns nonsense, the bot plays the fallback
policy and keeps going. It must never lose on time because of infrastructure: a
sparring partner that forfeits teaches the newcomer nothing and looks like their
bug, not ours. `SPARRING_ENABLED=false` takes the whole thing out of the loop.

## 3. Process and deployment

`apps/sparring`, a Node service alongside `apps/api` and `apps/worker`, with a
health endpoint in the shape the worker already uses.

Environment:

| Variable               | Meaning                                                       | Default               |
| ---------------------- | ------------------------------------------------------------- | --------------------- |
| `SPARRING_ENABLED`     | Master switch                                                 | `true`                |
| `SPARRING_API_KEY`     | The house agent's key, comma-separated for several identities | —                     |
| `SPARRING_BASE_URL`    | Where the arena's API is                                      | `http://api:3001`     |
| `SPARRING_SLUG`        | Slug to ensure at bootstrap                                   | `sparring`            |
| `OLLAMA_URL`           | Ollama's address                                              | `http://ollama:11434` |
| `SPARRING_MODEL`       | Model tag                                                     | `gemma3:270m`         |
| `SPARRING_TIMEOUT_MS`  | Generation timeout                                            | `15000`               |
| `SPARRING_FALLBACK`    | `greedy` or `random`                                          | `greedy`              |
| `SPARRING_HEALTH_PORT` | Health endpoint                                               | `3003`                |

Three services in `docker-compose.prod.yml`:

- **`ollama`** — `ollama/ollama`, a named volume for models, **no published
  ports**, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1`,
  `OLLAMA_KEEP_ALIVE=5m`, and a memory limit of 1 GB.
- **`ollama-pull`** — one-shot, `ollama pull gemma3:270m`, waits for `ollama`
  to be healthy, exits 0.
- **`sparring`** — waits for `api` healthy, `ollama-pull` completed and the
  bootstrap one-shot completed.

The box is a t3.medium: 2 vCPU, 4 GiB, 30 GB gp3, plus the 2 GB swap
`provision.sh` creates. The current stack sits around 1 GB resident; a Q4
Gemma 3 270M is roughly 300 MB of weights plus a few hundred MB of runtime, and
`KEEP_ALIVE=5m` releases it between practice sessions instead of holding it
resident all day. A move is a couple of seconds against a 60 s budget, so
generation losing the CPU race to a burst of API traffic costs latency, not
forfeits.

Locally the three services sit behind a compose profile. Development does not
require Ollama; without it the bot simply is not running.

`deploy/env.prod.example` gains the variables and `deploy/init-env.sh` mints
`SPARRING_API_KEY` for a fresh host. **The live host needs a manual one-time
edit**: `init-env.sh` refuses to touch an existing `.env` on purpose, because
regenerating the Postgres password there would lock the API out of its own
database. Adding the key to `/srv/agenticchess/.env` by hand is an explicit
step in the plan, not something a script does behind the operator's back.

## 4. The site

- A `training` badge on unrated games: the game page, the archive rows, the
  arena cards.
- A "house" badge on the sparring agent's profile and wherever its name is
  rendered, driven by `is_house`.
- Profile statistics and the rating curve count rated games only, per §1.5.
- Copy: the docs page explains the unrated queue and how to ask for it; the
  README roadmap and status table say practice games exist.

## 5. Files

**New**

| Path                                     | What                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `apps/sparring/`                         | The service: config, client wiring, turn handler, Ollama client, fallback policies |
| `packages/db/src/cli/ensure-sparring.ts` | Idempotent bootstrap of the house user and agent                                   |
| `packages/db/drizzle/000<n>_*.sql`       | One drizzle-kit migration adding `games.rated` and `agents.is_house`               |

**Changed**

| Path                                                                         | What                                                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/core/src/protocol/schemas.ts`                                      | `rated` in `GameConfig`, `mode` in `QueueStatus` and the queue events, queue-join request schema |
| `packages/db/src/schema/{games,agents}.ts`                                   | The two columns                                                                                  |
| `packages/runtime/src/matchmaking/{queue,pairing,matchmaker,service}.ts`     | Two queues, `allowSameOwner`, per-mode sweep                                                     |
| `packages/runtime/src/rating/settle.ts`                                      | Skip unrated                                                                                     |
| `packages/runtime/src/agents/profile.ts`                                     | `loadStats` over rated games only                                                                |
| `packages/runtime/src/games/{service,listing,repository}.ts`                 | `rated` through create, list filter, snapshot                                                    |
| `apps/api/src/routes/{agent,games}.ts`                                       | Queue body, `rated` filter                                                                       |
| `packages/sdk-ts/src/{client,index}.ts`, new `read-move.ts`                  | `joinQueue({ mode })`, `readMoveFromAnswer`                                                      |
| `examples/agent-claude/src/choose.ts`                                        | Reduced to the fallback decision                                                                 |
| `apps/web`                                                                   | Badges, profile statistics                                                                       |
| `docker-compose*.yml`, `Dockerfile`, `deploy/*`, `.env.example`, `README.md` | Deployment and documentation                                                                     |

## 6. Testing

- **Unit.** The fallback policies with a seeded RNG (greedy takes the best
  capture, both stay inside the legal list, the seed reproduces the game); the
  move parser, with its existing tests moved into the SDK; the prompt builder;
  `rated` round-tripping through the config schema.
- **Fake HTTP.** The Ollama client against a stub server: a good answer, an
  answer naming an illegal move, prose naming nothing, a timeout, a refused
  connection. Each must produce a legal move and the right comment.
- **Integration, real Postgres and Redis.** The two-mode queue Lua scripts
  (join, leave without knowing the mode, remove a pair, an agent barred from
  the second queue); the per-mode sweep pairing only within a mode; same-owner
  pairing allowed in unrated and refused in rated; `settleRatings` leaving
  `ratings` and `rating_history` untouched after an unrated game, and the
  leaderboard unchanged by one.
- **Over HTTP.** Joining unrated through the API, the default staying rated for
  a body-less request, the `rated` filter on `GET /v1/games`.
- **Opt-in.** One test against a real Ollama, behind an environment variable,
  in the shape 6a plans for the real Stockfish binary.

## 7. Risks and deliberate compromises

- **A 270M model will usually fail to name a legal move.** The fallback, not
  the model, will shape most practice games. This is accepted rather than
  hidden: the comment on every move says which path produced it, so nobody
  reading a game is misled about how much of it was the LLM. If the ratio turns
  out to be dire, the fix is a better prompt or a bigger tag in
  `SPARRING_MODEL`, not a change of architecture.
- **`rated` inside `GameConfig`** is a stretch of what "config" means, taken
  because that object is already carried end to end. If a second classification
  field ever appears, the pair should move out together.
- **`agents.is_house` anticipates 6b.** Justified by the badge the site needs
  now; if 6b never lands, the column still earns its keep.
- **One house identity is a bottleneck.** Two newcomers wanting practice at the
  same moment will queue behind each other. Accepted: the load is
  approximately zero, self-play covers the developer with two agents, and the
  configuration is already list-shaped.
- **Ollama shares two vCPUs with the API.** Mitigated by a single parallel
  request, a single loaded model, a memory cap and a 5-minute keep-alive. If it
  ever hurts, `SPARRING_ENABLED=false` is one line and one restart.
- **Practice games are stored, streamed and will be analysed by 6a like any
  other.** That is intended: they are real games. `rated` and `is_house` are
  the filters 6a and 6b need, and both exist after this work.

## 8. Rollout

In this order, each step leaving the system working:

1. Schema and migration (`rated`, `is_house`) — inert on their own.
2. Queue, pairing and settlement, behind the default `rated: true`. Nothing
   observable changes yet.
3. API and SDK: the queue mode and the `rated` filter. Backward compatible.
4. `apps/sparring` with its bootstrap CLI, runnable locally against Ollama.
5. Compose services and the web badges.
6. `SPARRING_API_KEY` added by hand to the live `.env`, then deploy.
7. Verify end to end in production: register a second agent, join unrated, play
   a game against the house, confirm no rating moved and the badge shows.
