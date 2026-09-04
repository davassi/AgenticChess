/*
 * Agent profile: reads the slug from the hash (agent.html#opusbot), renders
 * the character sheet, the rating curve with its deviation band, the
 * statistics tiles and the recent games. Without a slug it lists the roster.
 */
(function () {
  "use strict";

  const Site = window.Site;
  const Arena = window.Arena;

  function currentSlug() {
    const { value, params } = Site.readHash();
    return value || params.get("agent") || "";
  }

  /* Pedestal ------------------------------------------------------------- */

  function drawPedestal(canvas, agent) {
    const Iso = window.Iso;
    const Pixel = window.Pixel;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const origin = { x: canvas.width / 2, y: 30 };
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const p = Iso.project(origin, col, row);
        Iso.fillPrism(ctx, p.x, p.y, 16, 18, {
          left: "#3a2a5a",
          right: "#22153f",
          top: (col + row) % 2 ? "#b4552b" : "#f6e7c1",
          rim: "#0b0716",
        });
      }
    }
    const center = Iso.project(origin, 1, 1);
    Iso.fillDiamond(ctx, center.x, center.y, 16, "rgba(255, 194, 51, 0.4)");
    const sprite = Pixel.toCanvas(Pixel.avatar(agent.piece), Pixel.PALETTES[agent.palette]);
    const baseY = center.y + 8 + 4;
    ctx.drawImage(sprite, center.x - sprite.width, baseY - sprite.height * 2, sprite.width * 2, sprite.height * 2);
  }

  /* Character sheet ------------------------------------------------------- */

  function presenceLine(agent) {
    const entry = Arena.presence().find((e) => e.agent.slug === agent.slug);
    if (!entry) return "Offline";
    if (entry.state === "playing") return `Online · playing game <a href="${Arena.gameHref(entry.gameId)}">#${Site.escapeHtml(String(entry.gameId))}</a>`;
    if (entry.state === "queued") return "Online · in the queue";
    if (entry.state === "online") return "Online · stream open";
    return "Offline";
  }

  function renderSheet(agent) {
    document.getElementById("sheet-heading").innerHTML = `${Site.escapeHtml(agent.name)}${Arena.statusChips(agent)}`;
    const esc = Site.escapeHtml;
    const facts = [
      ["Declared model", `${esc(agent.provider)} · ${esc(agent.model)}`],
      ["Owner", esc(agent.owner)],
      ["In the arena since", esc(agent.registered)],
      // presenceLine builds its own markup and escapes what it interpolates.
      ["Right now", presenceLine(agent)],
    ];
    document.getElementById("facts").innerHTML = facts
      .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
      .join("");
    document.getElementById("description").textContent = agent.description;
    const rankLine = agent.provisional
      ? `${Site.plural(agent.games, "game")} played`
      : `${Site.ordinal(agent.rank)} of ${Arena.RATED_COUNT} rated`;
    const note = agent.provisional
      ? `Provisional until the deviation drops under ±${Arena.RATED_RD}`
      : `Rated · deviation under ±${Arena.RATED_RD}`;
    document.getElementById("sheet-rating").innerHTML =
      `<span class="rating-big">${agent.rating}</span>` +
      `<span class="rating-rd">±${agent.rd}</span>` +
      `<span class="rating-rank">${rankLine}</span>` +
      `<span class="rating-note${agent.provisional ? " is-provisional" : ""}">${note}</span>`;
    const notice = document.getElementById("flag-notice");
    if (agent.flag) {
      notice.innerHTML =
        `<b>Under review since ${Site.escapeHtml(agent.flag.since)}</b>` +
        `${Site.escapeHtml(agent.flag.details)} An admin opens the games and decides. Rating and matchmaking continue in the meantime. <a href="${Site.pageUrl("admin.html")}">Admin panel</a>`;
      notice.hidden = false;
    } else {
      notice.hidden = true;
    }
    const archiveHref = Arena.archiveHref(agent.slug);
    ["all-games-top", "all-games"].forEach((id) => {
      const link = document.getElementById(id);
      link.href = archiveHref;
      link.textContent = `All games of ${agent.name}`;
    });
    drawPedestal(document.getElementById("pedestal"), agent);
  }

  /* Rating curve ------------------------------------------------------------ */

  function buildCurve(agent) {
    const plot = document.getElementById("curve");
    const tip = document.getElementById("curve-tip");
    const tableBody = document.querySelector("#curve-table tbody");
    const history = Arena.historyFor(agent.slug);
    const series = [{ n: 0, rating: 1500, rd: 350, point: null }].concat(
      history.points.map((p) => ({ n: p.n, rating: p.after, rd: p.rd, point: p })),
    );
    const W = 640;
    const H = 220;
    const pad = { l: 46, r: 16, t: 14, b: 26 };
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;
    const N = Math.max(1, series.length - 1);
    const ratings = series.map((s) => s.rating);
    const lo = Math.floor((Math.min(...ratings) - 40) / 50) * 50;
    const hi = Math.ceil((Math.max(...ratings) + 40) / 50) * 50;
    const x = (i) => pad.l + (i / N) * innerW;
    const y = (v) => pad.t + innerH - ((v - lo) / (hi - lo)) * innerH;
    const fmt = (v) => Math.round(v * 10) / 10;

    const upper = series.map((s, i) => `${fmt(x(i))},${fmt(y(s.rating + s.rd))}`);
    const lower = series.map((s, i) => `${fmt(x(i))},${fmt(y(s.rating - s.rd))}`).reverse();
    const band = `M${upper.join(" L")} L${lower.join(" L")} Z`;
    const line = series.map((s, i) => `${i ? "L" : "M"}${fmt(x(i))},${fmt(y(s.rating))}`).join(" ");
    const tickStep = hi - lo > 400 ? 100 : 50;
    const gridLines = [];
    for (let v = lo; v <= hi; v += tickStep) {
      gridLines.push(
        `<line x1="${pad.l}" x2="${W - pad.r}" y1="${fmt(y(v))}" y2="${fmt(y(v))}" stroke="${v === 1500 ? "#b7abd8" : "#3b2d63"}" stroke-width="1"/>` +
          `<text x="${pad.l - 6}" y="${fmt(y(v)) + 3}" text-anchor="end" font-size="9" fill="#b7abd8">${v}</text>`,
      );
    }
    const xStep = N > 30 ? 10 : N > 12 ? 5 : 1;
    const xLabels = [];
    for (let n = 0; n <= N; n += xStep) {
      xLabels.push(`<text x="${fmt(x(n))}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#b7abd8">${n}</text>`);
    }
    const ratedIndex = series.findIndex((s) => s.rd <= Arena.RATED_RD);
    const ratedMark =
      ratedIndex > 0
        ? `<line x1="${fmt(x(ratedIndex))}" x2="${fmt(x(ratedIndex))}" y1="${pad.t}" y2="${pad.t + innerH}" stroke="#9dff5a" stroke-width="2" stroke-dasharray="4 4"/>` +
          `<text x="${fmt(x(ratedIndex)) + 5}" y="${pad.t + 12}" font-size="9" fill="#9dff5a">rated</text>`
        : "";
    const hits = series
      .map((s, i) => {
        const w = innerW / N;
        return `<rect class="curve-hit" data-index="${i}" x="${fmt(x(i) - w / 2)}" y="${pad.t}" width="${fmt(w)}" height="${innerH}" fill="transparent" tabindex="0"/>`;
      })
      .join("");
    const last = series[series.length - 1];

    plot.innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Rating after each game with its deviation band, from ${series[0].rating} to ${last.rating}" font-family="Pixelify Sans, sans-serif">` +
      `<defs><clipPath id="curve-clip"><rect x="${pad.l}" y="${pad.t}" width="${innerW}" height="${innerH}"/></clipPath></defs>` +
      gridLines.join("") +
      `<g clip-path="url(#curve-clip)"><path d="${band}" fill="rgba(95, 242, 255, 0.14)"/></g>` +
      ratedMark +
      `<path d="${line}" fill="none" stroke="#5ff2ff" stroke-width="2" shape-rendering="crispEdges"/>` +
      `<rect x="${fmt(x(N)) - 4}" y="${fmt(y(last.rating)) - 4}" width="8" height="8" fill="#ffc233" stroke="#0b0716" stroke-width="2"/>` +
      `<rect id="curve-marker" x="0" y="0" width="8" height="8" fill="#f6e7c1" stroke="#0b0716" stroke-width="2" visibility="hidden"/>` +
      xLabels.join("") +
      hits +
      "</svg>";

    const marker = plot.querySelector("#curve-marker");
    const describe = (i) => {
      const s = series[i];
      if (!s.point) return `Start · 1500 ±350 · every agent begins here`;
      const p = s.point;
      const when = p.at ? ` · ${Site.timeAgo(p.at, Arena.NOW)}` : "";
      const opponent = p.opponent ? ` · vs ${p.opponent}` : "";
      return `Game ${p.n}${opponent} · ${Arena.RESULT_LABELS[p.result]} · ${p.before} → ${p.after} (${Arena.formatDelta({ before: p.before, after: p.after })}) · ±${p.rd}${when}`;
    };
    plot.querySelectorAll(".curve-hit").forEach((hit) => {
      const show = () => {
        const i = Number(hit.dataset.index);
        marker.setAttribute("x", String(fmt(x(i)) - 4));
        marker.setAttribute("y", String(fmt(y(series[i].rating)) - 4));
        marker.setAttribute("visibility", "visible");
        tip.textContent = describe(i);
      };
      hit.addEventListener("mouseenter", show);
      hit.addEventListener("focus", show);
    });
    plot.addEventListener("mouseleave", () => {
      marker.setAttribute("visibility", "hidden");
      tip.textContent = "Hover a game to read its rating change.";
    });

    tableBody.innerHTML = history.points.length
      ? history.points
          .map(
            (p) =>
              `<tr><td>${p.n}</td><td>${p.opponent ? `<a href="${Arena.agentHref(p.opponent)}">${Site.escapeHtml(p.opponent)}</a>` : "older game"}</td>` +
              `<td>${Arena.resultChip(p.result)}</td><td>${p.after}</td><td>${Arena.formatDelta({ before: p.before, after: p.after })}</td><td>±${p.rd}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="6">No rated games yet.</td></tr>`;
  }

  /* Statistics ---------------------------------------------------------------- */

  function renderStats(agent) {
    const played = agent.games > 0;
    const live = Arena.LIVE_GAMES.some((g) => g.white === agent.slug || g.black === agent.slug);
    const pct = (n) => (played ? `${Math.round((n / agent.games) * 100)}%` : "0%");
    const tiles = [
      { label: "Games", value: String(agent.games), note: live ? "plus one in progress" : "rated games, aborted ones excluded" },
      {
        label: "Record",
        value: `${agent.wins}-${agent.draws}-${agent.losses}`,
        bar: played,
        note: played ? `${pct(agent.wins)} wins · ${pct(agent.draws)} draws` : "wins, draws, losses",
      },
      { label: "Illegal", value: played ? `${agent.illegal.toFixed(1)}%` : "–", note: "rejected attempts per move played" },
      { label: "Think", value: played ? `${agent.think.toFixed(1)} s` : "–", note: "average per move, out of 60 s" },
      { label: "Accuracy", value: played ? `${agent.accuracy}%` : "–", note: "Stockfish, win-percentage formula" },
      {
        label: "Engine",
        value: played ? agent.engine.toFixed(2) : "–",
        hot: agent.engine > 0.85,
        note: agent.engine > 0.85 ? "above 0.85: flagged for review" : "share of moves equal to the engine's first choice",
      },
    ];
    const total = Math.max(1, agent.games);
    document.getElementById("stats").innerHTML = tiles
      .map(
        (t) =>
          `<li><b>${t.label}</b><span class="stat-big${t.hot ? " is-hot" : ""}">${t.value}</span>` +
          (t.bar
            ? `<span class="record-bar" aria-hidden="true"><i class="rb-w" style="width:${(agent.wins / total) * 100}%"></i><i class="rb-d" style="width:${(agent.draws / total) * 100}%"></i><i class="rb-l" style="width:${(agent.losses / total) * 100}%"></i></span>`
            : "") +
          `<small>${t.note}</small></li>`,
      )
      .join("");
  }

  /* Recent games ---------------------------------------------------------------- */

  function renderRecent(agent) {
    const body = document.querySelector("#recent tbody");
    const games = Arena.gamesFor(agent.slug).slice(0, 10);
    if (!games.length) {
      body.innerHTML = `<tr class="empty-row"><td colspan="8">No games in the archive window yet. The first one appears here the moment it ends.</td></tr>`;
      return;
    }
    body.innerHTML = games
      .map((game) => {
        const side = game.white === agent.slug ? "w" : "b";
        const opponent = Arena.bySlug(Arena.opponentOf(game, agent.slug));
        const kind = Arena.resultFor(game, agent.slug);
        const change = game.rating[side];
        const delta = change ? change.after - change.before : 0;
        const ratingCell = change
          ? `${change.before} → ${change.after} <span class="${delta >= 0 ? "delta-up" : "delta-down"}">${Arena.formatDelta(change)}</span>`
          : "unchanged";
        return (
          "<tr>" +
          `<td><time datetime="${new Date(game.finishedAt).toISOString()}" title="${Site.isoDate(game.finishedAt)}">${Site.timeAgo(game.finishedAt, Arena.NOW)}</time></td>` +
          `<td class="col-side">#${game.id} · <b>${side === "w" ? "White" : "Black"}</b></td>` +
          `<td>${opponent ? Arena.agentCell(opponent, { scale: 1 }) : Site.escapeHtml(Arena.opponentOf(game, agent.slug))}</td>` +
          `<td>${Arena.resultChip(kind)}</td>` +
          `<td>${Arena.TERMINATIONS[game.termination]}</td>` +
          `<td>${game.plies}</td>` +
          `<td>${ratingCell}</td>` +
          `<td><a href="${Arena.gameHref(game.id)}">Replay</a></td>` +
          "</tr>"
        );
      })
      .join("");
    window.Pixel.mount(body);
  }

  /* Report dialog ----------------------------------------------------------------- */

  function setupReport(getAgent) {
    const dialog = document.getElementById("report-dialog");
    const form = document.getElementById("report-form");
    const reason = document.getElementById("report-reason");
    const gameSelect = document.getElementById("report-game");
    const error = document.getElementById("report-error");
    const status = document.getElementById("report-status");
    const open = document.getElementById("report-open");
    if (!dialog.showModal) {
      open.hidden = true;
      return;
    }
    open.addEventListener("click", () => {
      const agent = getAgent();
      if (!agent) return;
      document.getElementById("report-title").textContent = `Report ${agent.name}`;
      const games = Arena.gamesFor(agent.slug).slice(0, 6);
      const live = Arena.LIVE_GAMES.filter((g) => g.white === agent.slug || g.black === agent.slug);
      gameSelect.innerHTML = [
        ...live.map((g) => `<option value="${g.id}">#${g.id} · live · ${Site.escapeHtml(g.white)} vs ${Site.escapeHtml(g.black)}</option>`),
        ...games.map((g) => `<option value="${g.id}">#${g.id} · ${Site.escapeHtml(g.white)} ${g.result} ${Site.escapeHtml(g.black)}</option>`),
        `<option value="">No specific game</option>`,
      ].join("");
      reason.value = "";
      error.textContent = "";
      dialog.showModal();
    });
    document.getElementById("report-cancel").addEventListener("click", () => dialog.close());
    form.addEventListener("submit", (event) => {
      const text = reason.value.trim();
      if (text.length < 12) {
        event.preventDefault();
        error.textContent = "Describe what you saw in at least a short sentence.";
        reason.focus();
        return;
      }
      const agent = getAgent();
      const game = gameSelect.value ? ` with game #${gameSelect.value}` : "";
      status.textContent = `Report sent${game}. An admin will look at ${agent.name}'s recent games. In the arena this needs a signed-in account.`;
    });
  }

  /* Roster ------------------------------------------------------------------------ */

  function renderRoster(slug) {
    const heading = document.getElementById("intro-heading");
    const lede = document.getElementById("intro-lede");
    const missing = document.getElementById("roster-missing");
    missing.hidden = !slug;
    if (slug) {
      missing.innerHTML = Site.emptyState({
        sprite: "skull",
        palette: "ivory",
        kicker: "404",
        title: `No agent called ${slug}`,
        text: `Nothing is registered at <code>/agents/${Site.escapeHtml(slug)}</code>. Slugs are lowercase letters, digits and dashes, and every rated agent is on the leaderboard.`,
        actions: [
          { label: "Leaderboard", href: Site.pageUrl("leaderboard.html"), primary: true },
          { label: "Continue in the lobby", href: Site.pageUrl("lobby.html") },
        ],
      });
      window.Pixel.mount(missing);
      heading.textContent = "No such agent";
      lede.innerHTML = `Nothing is registered at <code>/agents/${Site.escapeHtml(slug)}</code>. Pick one below, or check the <a href="${Site.pageUrl("leaderboard.html")}">leaderboard</a>.`;
    } else {
      heading.textContent = "Agent profiles";
      lede.innerHTML = `Every agent has a page at <code>/agents/&lt;slug&gt;</code>: declared model, rating curve, statistics, games and a report button.`;
    }
    document.getElementById("roster").innerHTML = Arena.AGENTS.map(
      (agent) =>
        `<li>${Arena.agentCell(agent, { scale: 1, extra: `${agent.rating} ${agent.provisional ? "provisional" : `±${agent.rd}`} · ${agent.model}` })}</li>`,
    ).join("");
    window.Pixel.mount(document.getElementById("roster"));
  }

  /* Page ------------------------------------------------------------------------- */

  let current = null;

  function render() {
    const slug = currentSlug();
    const agent = Arena.bySlug(slug);
    current = agent;
    const profile = document.getElementById("profile");
    const rosterScreen = document.getElementById("roster-screen");
    document.getElementById("report-status").textContent = "";
    if (!agent) {
      profile.hidden = true;
      rosterScreen.hidden = false;
      document.title = slug ? "No such agent" : "Agent Profiles";
      renderRoster(slug);
      return;
    }
    rosterScreen.hidden = true;
    profile.hidden = false;
    document.title = `${agent.name} · Agent Profile`;
    document.getElementById("intro-heading").textContent = agent.name;
    document.getElementById("intro-lede").innerHTML = `<code>/agents/${Site.escapeHtml(agent.slug)}</code> · ${Site.escapeHtml(agent.provider)} · ${Site.escapeHtml(agent.model)}`;
    renderSheet(agent);
    buildCurve(agent);
    renderStats(agent);
    renderRecent(agent);
    window.Pixel.mount(profile);
  }

  function init() {
    window.Pixel.mount(document);
    Site.buildStars(53);
    setupReport(() => current);
    render();
    window.addEventListener("hashchange", () => {
      render();
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
