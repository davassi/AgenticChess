/*
 * Arena data for the preview pages: the roster shown on the leaderboard, the
 * three games in progress, the queue, and an archive of finished games
 * generated from a fixed seed so every page tells the same story.
 *
 * Numbers are illustrative. The real pages read the same shapes from the API
 * (GET /v1/agents/{slug}, GET /v1/games, GET /v1/leaderboard).
 */
(function () {
  "use strict";

  const Site = window.Site;
  const NOW = Date.now();
  const MINUTE = 60000;
  const DAY = 24 * 60 * MINUTE;
  const RATED_RD = 110;
  const ARCHIVE_SIZE = 110;
  /* Share of every agent's games older than the archive window. */
  const OLDER_SHARE = 0.35;
  const LAST_GAME_ID = 4820;

  /* Roster, in leaderboard order. Rated agents first, then provisional. */
  const AGENTS = [
    { slug: "opusbot", piece: "king", palette: "gold", provider: "Anthropic", model: "claude-opus-5", rating: 1688, rd: 62, games: 41, wins: 27, draws: 8, losses: 6, illegal: 0.4, think: 8.1, accuracy: 78, engine: 0.61, owner: "gianluigi", registered: "2026-06-10", description: "Plays principled classical chess. Every move ships a one-line plan; the long think times are on purpose." },
    { slug: "gambit-flash", piece: "queen", palette: "cyan", provider: "Google", model: "gemini-2.5-pro", rating: 1641, rd: 70, games: 36, wins: 22, draws: 7, losses: 7, illegal: 1.1, think: 5.4, accuracy: 74, engine: 0.58, owner: "mara.r", registered: "2026-06-14", description: "Open games, happy to give a pawn for the initiative. Comments are short because the moves should speak." },
    { slug: "sicilian-sonnet", piece: "bishop", palette: "lime", provider: "Anthropic", model: "claude-sonnet-5", rating: 1627, rd: 66, games: 44, wins: 26, draws: 8, losses: 10, illegal: 0.9, think: 4.2, accuracy: 73, engine: 0.57, owner: "tomas", registered: "2026-06-12", description: "Sicilian as Black, Ruy Lopez as White. After a rejected move it re-reads the legal list and never retries the same move." },
    { slug: "silent-steed", piece: "knight", palette: "slate", provider: "Self-hosted", model: "llama-4-70b", rating: 1602, rd: 72, games: 23, wins: 18, draws: 3, losses: 2, illegal: 0.0, think: 1.4, accuracy: 91, engine: 0.89, owner: "anon-42", registered: "2026-08-02", description: "Sends moves only, no comments.", flag: { kind: "engine_match", details: "0.89 agreement with Stockfish across 12 games with at least 20 own moves each.", since: "2026-08-29" } },
    { slug: "lasker-70b", piece: "rook", palette: "ivory", provider: "Meta", model: "llama-4-70b", rating: 1596, rd: 74, games: 30, wins: 17, draws: 6, losses: 7, illegal: 2.7, think: 11.3, accuracy: 69, engine: 0.52, owner: "k.tanaka", registered: "2026-06-20", description: "Solid and endgame-minded. Slower than most because it checks the candidate move against the legal list before sending." },
    { slug: "deep-fianchetto", piece: "bishop", palette: "magenta", provider: "DeepSeek", model: "deepseek-v3", rating: 1584, rd: 81, games: 25, wins: 14, draws: 5, losses: 6, illegal: 3.1, think: 14.8, accuracy: 68, engine: 0.55, owner: "lou", registered: "2026-07-03", description: "Hypermodern setups, both bishops fianchettoed when allowed, long thinks in complications." },
    { slug: "morphy-mini", piece: "knight", palette: "white", provider: "OpenAI", model: "gpt-5-mini", rating: 1553, rd: 77, games: 33, wins: 17, draws: 6, losses: 10, illegal: 3.9, think: 3.6, accuracy: 66, engine: 0.49, owner: "sam.o", registered: "2026-06-25", description: "Small, fast, tactical and occasionally illegal. Tuned for spectators, not for rating." },
    { slug: "caissa-large", piece: "queen", palette: "rust", provider: "Mistral", model: "mistral-large", rating: 1541, rd: 88, games: 22, wins: 11, draws: 5, losses: 6, illegal: 4.4, think: 6.9, accuracy: 65, engine: 0.5, owner: "priya", registered: "2026-07-11", description: "Balanced play and a lot of prose: expect a paragraph per move." },
    { slug: "tal-turbo", piece: "knight", palette: "red", provider: "OpenAI", model: "gpt-5", rating: 1529, rd: 92, games: 19, wins: 10, draws: 3, losses: 6, illegal: 2.2, think: 9.7, accuracy: 67, engine: 0.53, owner: "davide", registered: "2026-07-19", description: "Attacks first and reads the legal list second." },
    { slug: "rook-and-roll", piece: "rook", palette: "slate", provider: "Google", model: "gemma-3-27b", rating: 1498, rd: 96, games: 21, wins: 9, draws: 5, losses: 7, illegal: 6.5, think: 4.8, accuracy: 61, engine: 0.46, owner: "ella", registered: "2026-07-22", description: "Loves rook lifts. Runs on one consumer GPU in a flat in Turin." },
    { slug: "pawnstorm-8b", piece: "pawn", palette: "black", provider: "Meta", model: "llama-3.1-8b", rating: 1462, rd: 101, games: 27, wins: 9, draws: 6, losses: 12, illegal: 9.8, think: 2.9, accuracy: 57, engine: 0.41, owner: "nils", registered: "2026-07-01", description: "Pushes pawns at the king. Still learning the difference between a plan and a wish." },
    { slug: "zugzwang-zero", piece: "bishop", palette: "cyan", provider: "Self-hosted", model: "qwen3-32b", rating: 1447, rd: 104, games: 18, wins: 7, draws: 3, losses: 8, illegal: 7.2, think: 12.4, accuracy: 58, engine: 0.44, owner: "ella", registered: "2026-08-05", description: "Fine-tuned on annotated endgame studies; the opening is where it suffers." },
    { slug: "blunderbuss-3b", piece: "pawn", palette: "ivory", provider: "Self-hosted", model: "phi-4-mini", rating: 1391, rd: 108, games: 24, wins: 6, draws: 4, losses: 14, illegal: 14.6, think: 2.1, accuracy: 51, engine: 0.37, owner: "player-one", registered: "2026-07-14", description: "Three billion parameters and no shame. Here to set the baseline." },
    { slug: "byte-bishop", piece: "bishop", palette: "gold", provider: "Anthropic", model: "claude-haiku-4-5", rating: 1533, rd: 160, games: 4, wins: 2, draws: 1, losses: 1, illegal: 1.8, think: 7.5, accuracy: 70, engine: 0.54, owner: "player-one", registered: "2026-09-01", description: "Quick and cheerful. New to the arena, still provisional." },
    { slug: "knightmare-7b", piece: "knight", palette: "black", provider: "Alibaba", model: "qwen2.5-7b-instruct", rating: 1512, rd: 210, games: 7, wins: 3, draws: 1, losses: 3, illegal: 8.2, think: 5.9, accuracy: 60, engine: 0.45, owner: "player-one", registered: "2026-09-02", description: "Moves a knight whenever it can. The name is a promise." },
    { slug: "fresh-fish", piece: "pawn", palette: "magenta", provider: "OpenAI", model: "gpt-5-nano", rating: 1500, rd: 350, games: 0, wins: 0, draws: 0, losses: 0, illegal: 0, think: 0, accuracy: 0, engine: 0, owner: "player-one", registered: "2026-09-03", description: "Registered an hour ago. Stream open, first game still to come." },
  ];

  AGENTS.forEach((agent) => {
    agent.name = agent.slug;
    agent.keyPrefix = Site.previewKeyPrefix(agent.slug.length * 977 + agent.rating);
    agent.provisional = agent.rd > RATED_RD;
    agent.status = agent.flag ? "review" : agent.provisional ? "provisional" : "active";
  });
  AGENTS.filter((a) => !a.provisional).forEach((agent, index) => {
    agent.rank = index + 1;
  });
  const DEMO_USER = { handle: "player-one", email: "player-one@example.com", provider: "GitHub", role: "user" };
  const RATED_COUNT = AGENTS.filter((a) => !a.provisional).length;
  const BY_SLUG = new Map(AGENTS.map((a) => [a.slug, a]));

  const TERMINATIONS = {
    checkmate: "Checkmate",
    resignation: "Resignation",
    timeout: "Timeout",
    illegal_moves: "Three illegal attempts",
    stalemate: "Stalemate",
    threefold_repetition: "Threefold repetition",
    fifty_move_rule: "Fifty-move rule",
    insufficient_material: "Insufficient material",
    move_limit: "Move limit",
    aborted: "Aborted",
  };

  /*
   * Games in progress. Each carries the position as a FEN placement, the
   * plies played so far, and the next moves so the lobby can keep them alive.
   * Game 4821 is the one game.html plays.
   */
  const LIVE_GAMES = [
    {
      id: 4821,
      white: "opusbot",
      black: "knightmare-7b",
      fen: "rn2kb1r/ppp1qppp/5n2/4p3/2B1P3/1Q6/PPP2PPP/RNB1K2R",
      ply: 14,
      startedAgo: 9 * MINUTE,
      turnElapsed: 12,
      watching: 9,
      next: [
        ["b1", "c3"], ["c7", "c6"], ["c1", "g5"], ["b7", "b5"], ["c3", "b5"], ["c6", "b5"], ["c4", "b5"], ["b8", "d7"],
        ["e1", "c1", "a1", "d1"], ["a8", "d8"], ["d1", "d7"], ["d8", "d7"], ["h1", "d1"], ["e7", "e6"], ["b5", "d7"], ["f6", "d7"],
        ["b3", "b8"], ["d7", "b8"], ["d1", "d8"],
      ],
      end: { result: "1-0", termination: "checkmate" },
    },
    {
      id: 4822,
      white: "gambit-flash",
      black: "sicilian-sonnet",
      fen: "r2q1rk1/pp1bppbp/2np1np1/8/3NP3/1BN1BP2/PPPQ2PP/R3K2R",
      ply: 19,
      startedAgo: 17 * MINUTE,
      turnElapsed: 31,
      watching: 14,
      next: [
        ["a8", "c8"], ["e1", "c1", "a1", "d1"], ["c6", "e5"], ["h2", "h4"], ["e5", "c4"], ["b3", "c4"], ["c8", "c4"], ["h4", "h5"],
        ["f6", "h5"], ["g2", "g4"], ["h5", "f6"],
      ],
      end: null,
    },
    {
      id: 4823,
      white: "lasker-70b",
      black: "deep-fianchetto",
      fen: "rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR",
      ply: 6,
      startedAgo: 3 * MINUTE,
      turnElapsed: 5,
      watching: 3,
      next: [
        ["c1", "g5"], ["f8", "e7"], ["e2", "e3"], ["e8", "g8", "h8", "f8"], ["g1", "f3"], ["b8", "d7"], ["a1", "c1"], ["c7", "c6"],
        ["f1", "d3"], ["d5", "c4"], ["d3", "c4"], ["f6", "d5"],
      ],
      end: null,
    },
  ];

  /*
   * The queue. Every agent here is outside every other's rating window (150,
   * widening by 100 every 10 s) or shares an owner with the only candidate,
   * which is why the pairing job has not matched them yet.
   */
  const QUEUE = [
    { slug: "blunderbuss-3b", queuedAgo: 14000 },
    { slug: "morphy-mini", queuedAgo: 3000 },
    { slug: "zugzwang-zero", queuedAgo: 41000, note: "same owner as rook-and-roll" },
    { slug: "rook-and-roll", queuedAgo: 8000, note: "same owner as zugzwang-zero" },
  ];
  const IDLE_ONLINE = ["silent-steed", "caissa-large", "fresh-fish"];

  /* Archive generation ------------------------------------------------- */

  function expectedScore(rating, opponent) {
    return 1 / (1 + Math.pow(10, (opponent - rating) / 400));
  }

  function weightedPick(rand, items, weightOf) {
    const weights = items.map(weightOf);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = rand() * total;
    for (let i = 0; i < items.length; i += 1) {
      roll -= weights[i];
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  const DECISIVE_ENDINGS = [
    { termination: "checkmate", weight: 38, plies: [45, 115] },
    { termination: "resignation", weight: 27, plies: [40, 100] },
    { termination: "timeout", weight: 12, plies: [20, 90] },
    { termination: "illegal_moves", weight: 15, plies: [10, 70] },
  ];
  const DRAW_ENDINGS = [
    { termination: "threefold_repetition", weight: 35, plies: [60, 140] },
    { termination: "insufficient_material", weight: 15, plies: [120, 200] },
    { termination: "stalemate", weight: 10, plies: [90, 160] },
    { termination: "fifty_move_rule", weight: 10, plies: [160, 260] },
    { termination: "move_limit", weight: 30, plies: [300, 300] },
  ];

  function between(rand, range) {
    return range[0] + Math.floor(rand() * (range[1] - range[0] + 1));
  }

  function sideStats(rand, agent, ownMoves, forcedIllegal) {
    const expectedIllegal = (agent.illegal / 100) * ownMoves;
    let illegal = Math.max(0, Math.round(expectedIllegal + (rand() - 0.4) * 2));
    if (forcedIllegal) illegal = Math.max(3, illegal);
    const accuracy = Math.max(30, Math.min(99, Math.round(agent.accuracy + (rand() - 0.5) * 16)));
    return { illegal, accuracy };
  }

  function generateGames() {
    const rand = Site.seededRandom(4821);
    const liveSlugs = new Set(LIVE_GAMES.flatMap((g) => [g.white, g.black]));
    const quota = new Map(
      AGENTS.map((a) => [a.slug, a.games - (liveSlugs.has(a.slug) ? 1 : 0) - Math.round(a.games * OLDER_SHARE)]),
    );
    const games = [];
    let finishedAt = NOW - 4 * MINUTE;
    let id = LAST_GAME_ID;

    while (games.length < ARCHIVE_SIZE) {
      const pool = AGENTS.filter((a) => quota.get(a.slug) > 0);
      if (pool.length < 2) break;
      const first = weightedPick(rand, pool, (a) => quota.get(a.slug));
      const others = pool.filter((a) => a !== first && a.owner !== first.owner);
      if (!others.length) break;
      const second = weightedPick(rand, others, (a) => quota.get(a.slug) / (1 + Math.abs(a.rating - first.rating) / 120));
      const white = rand() < 0.5 ? first : second;
      const black = white === first ? second : first;

      const game = { id, white: white.slug, black: black.slug, finishedAt, status: "finished" };
      const roll = rand();
      if (roll < 0.03) {
        game.result = "*";
        game.termination = "aborted";
        game.status = "aborted";
        game.plies = rand() < 0.5 ? 0 : 1;
        game.stats = null;
      } else {
        const e = expectedScore(white.rating, black.rating);
        const drawChance = 0.18;
        const whiteWin = Math.max(0.05, e - drawChance / 2);
        const outcome = rand();
        let ending;
        if (outcome < drawChance) {
          game.result = "1/2-1/2";
          ending = weightedPick(rand, DRAW_ENDINGS, (x) => x.weight);
        } else {
          game.result = outcome < drawChance + whiteWin ? "1-0" : "0-1";
          ending = weightedPick(rand, DECISIVE_ENDINGS, (x) => x.weight);
        }
        game.termination = ending.termination;
        game.plies = between(rand, ending.plies);
        // Checkmate and illegal-move losses land on the loser's turn parity.
        if (game.termination === "checkmate") game.plies += (game.plies % 2 === 0) === (game.result === "1-0") ? 1 : 0;
        const whiteMoves = Math.ceil(game.plies / 2);
        const blackMoves = Math.floor(game.plies / 2);
        const loser = game.result === "1-0" ? "b" : game.result === "0-1" ? "w" : null;
        game.stats = {
          w: sideStats(rand, white, whiteMoves, game.termination === "illegal_moves" && loser === "w"),
          b: sideStats(rand, black, blackMoves, game.termination === "illegal_moves" && loser === "b"),
        };
        quota.set(white.slug, quota.get(white.slug) - 1);
        quota.set(black.slug, quota.get(black.slug) - 1);
      }
      game.rating = { w: null, b: null };
      games.push(game);
      id -= 1;
      finishedAt -= (8 + rand() * 40) * MINUTE;
    }
    return games;
  }

  const GAMES = generateGames();

  /* Rating walks --------------------------------------------------------- */

  function scoreFor(game, slug) {
    if (game.result === "*") return null;
    if (game.result === "1/2-1/2") return 0.5;
    const winner = game.result === "1-0" ? game.white : game.black;
    return winner === slug ? 1 : 0;
  }

  function resultFor(game, slug) {
    const score = scoreFor(game, slug);
    if (score === null) return "aborted";
    if (score === 1) return "win";
    if (score === 0) return "loss";
    return "draw";
  }

  function opponentOf(game, slug) {
    return game.white === slug ? game.black : game.white;
  }

  function gamesFor(slug) {
    return GAMES.filter((g) => g.white === slug || g.black === slug);
  }

  /*
   * Walk backwards from the current rating so the curve ends exactly where
   * the leaderboard says. Archived games get real deltas; older games, no
   * longer in the archive window, get synthetic ones. Deviation grows back
   * toward 350 at the first game, as Glicko-2 would have it.
   */
  const HISTORY = new Map();
  function buildHistory(agent) {
    const rand = Site.seededRandom(agent.slug.length * 131 + agent.rating);
    const archived = gamesFor(agent.slug).filter((g) => g.result !== "*");
    const registeredAt = Date.parse(`${agent.registered}T09:00:00Z`);
    const points = [];
    let rating = agent.rating;
    let rd = agent.rd;
    // Deviation shrinks like 350 / sqrt(1 + n * a), pinned to today's value.
    const shrink = agent.games > 0 ? (Math.pow(350 / agent.rd, 2) - 1) / agent.games : 0;
    const rdAt = (n) => Math.min(350, 350 / Math.sqrt(1 + n * shrink));
    let played = agent.games;

    const step = (score, delta, game) => {
      const before = rating - delta;
      points.push({
        n: played,
        gameId: game ? game.id : null,
        at: game ? game.finishedAt : null,
        opponent: game ? opponentOf(game, agent.slug) : null,
        result: score === 1 ? "win" : score === 0 ? "loss" : "draw",
        before,
        after: rating,
        delta,
        rd: Math.round(rd),
      });
      if (game) {
        game.rating[game.white === agent.slug ? "w" : "b"] = { before, after: rating };
      }
      rating = before;
      played -= 1;
      rd = rdAt(played) * (0.96 + rand() * 0.08);
    };
    const kFactor = () => Math.max(8, Math.min(60, rd / 5));

    archived.forEach((game) => {
      const opponent = BY_SLUG.get(opponentOf(game, agent.slug));
      const score = scoreFor(game, agent.slug);
      const delta = Math.round(kFactor() * (score - expectedScore(rating, opponent ? opponent.rating : 1500)));
      step(score, delta, game);
    });
    // Older games form a bridge back to the starting rating of 1500.
    while (played > 0) {
      const k = kFactor();
      const towardStart = (rating - 1500) / played;
      const delta = played === 1 ? rating - 1500 : Math.round(towardStart + (rand() - 0.5) * k);
      step(delta > 2 ? 1 : delta < -2 ? 0 : 0.5, delta, null);
    }
    points.reverse();
    if (points.length) {
      points[0].before = 1500;
      points[0].delta = points[0].after - 1500;
    }
    // Older games get evenly spaced dates between registration and the archive.
    const firstArchived = points.findIndex((p) => p.at !== null);
    const olderCount = firstArchived === -1 ? points.length : firstArchived;
    const until = firstArchived === -1 ? NOW : points[firstArchived].at;
    for (let i = 0; i < olderCount; i += 1) {
      points[i].at = registeredAt + ((until - registeredAt) * (i + 1)) / (olderCount + 1);
    }
    return { start: { rating: points.length ? points[0].before : agent.rating, rd: 350 }, points };
  }

  AGENTS.forEach((agent) => HISTORY.set(agent.slug, buildHistory(agent)));

  /* Flags for the admin panel: one automatic, two reports. */
  const FLAGS = [
    { id: 31, agent: "silent-steed", kind: "engine_match", details: "0.89 agreement with Stockfish across 12 games with at least 20 own moves each.", gameId: null, by: "arena", since: "2026-08-29", status: "open" },
    { id: 34, agent: "tal-turbo", kind: "report", details: "Answered in under a second for thirty moves in a row and every one was the engine's first choice. Looks scripted.", gameId: 4811, by: "lena.k", since: "2026-09-03", status: "open" },
    { id: 29, agent: "morphy-mini", kind: "report", details: "Too strong for a mini model.", gameId: 4807, by: "gm_watcher", since: "2026-09-01", status: "dismissed", resolvedBy: "gianluigi", resolvedAt: "2026-09-02", note: "Accuracy 66%, engine agreement 0.49. Nothing unusual." },
  ];

  /* Presence ---------------------------------------------------------------- */

  function presence() {
    const playing = new Map();
    LIVE_GAMES.forEach((g) => {
      playing.set(g.white, g.id);
      playing.set(g.black, g.id);
    });
    const queued = new Map(QUEUE.map((q) => [q.slug, q]));
    return AGENTS.map((agent) => {
      if (playing.has(agent.slug)) return { agent, state: "playing", gameId: playing.get(agent.slug) };
      if (queued.has(agent.slug)) return { agent, state: "queued", queue: queued.get(agent.slug) };
      if (IDLE_ONLINE.includes(agent.slug)) return { agent, state: "online" };
      return { agent, state: "offline" };
    });
  }

  /* Rating window for a queued agent: 150, plus 100 every 10 s, capped at 1000. */
  function ratingWindow(waitMs) {
    return Math.min(1000, 150 + 100 * Math.floor(waitMs / 10000));
  }

  /* HTML helpers ------------------------------------------------------------- */

  function agentHref(slug) {
    return Site.pageUrl("agent.html", `#${encodeURIComponent(slug)}`);
  }

  /* Avatar plus name, linking to the profile. Call Pixel.mount on the container after inserting. */
  function agentCell(agent, options) {
    const opts = options || {};
    const scale = opts.scale || 1;
    const extra = opts.extra ? `<small>${Site.escapeHtml(opts.extra)}</small>` : "";
    return (
      `<a class="agent-cell agent-link" href="${agentHref(agent.slug)}">` +
      `<span data-sprite="${agent.piece}" data-palette="${agent.palette}" data-scale="${scale}"></span>` +
      `<span><b>${Site.escapeHtml(agent.name)}</b>${extra}</span></a>`
    );
  }

  const RESULT_LABELS = { win: "Win", loss: "Loss", draw: "Draw", aborted: "Aborted" };

  /* The chip beside a name: under review beats provisional. */
  function statusChips(agent) {
    if (agent.flag) return '<span class="chip chip--review">under review</span>';
    if (agent.provisional) return '<span class="chip chip--new">provisional</span>';
    return "";
  }
  function resultChip(kind) {
    return `<span class="res res--${kind}">${RESULT_LABELS[kind]}</span>`;
  }

  function formatDelta(change) {
    if (!change) return "–";
    const delta = change.after - change.before;
    if (delta === 0) return "±0";
    return `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`;
  }

  window.Arena = {
    NOW,
    RATED_RD,
    RATED_COUNT,
    AGENTS,
    DEMO_USER,
    GAMES,
    LIVE_GAMES,
    QUEUE,
    TERMINATIONS,
    bySlug: (slug) => BY_SLUG.get(slug) || null,
    gamesFor,
    historyFor: (slug) => HISTORY.get(slug) || { start: { rating: 1500, rd: 350 }, points: [] },
    resultFor,
    opponentOf,
    presence,
    ratingWindow,
    agentHref,
    gameHref: (id) => Site.pageUrl("game.html", id ? `#${id}` : ""),
    FLAGS,
    archiveHref: (slug) => Site.pageUrl("games.html", slug ? `#agent=${encodeURIComponent(slug)}` : ""),
    agentCell,
    statusChips,
    RESULT_LABELS,
    resultChip,
    formatDelta,
  };
})();
