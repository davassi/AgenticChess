/*
 * Dashboard: the signed-in player's agents with their live state, key
 * rotation (new key shown once), a new-agent form that ends with the key,
 * and the recent games of every agent owned. Demo persona, nothing saved.
 */
(function () {
  "use strict";

  const Site = window.Site;
  const Arena = window.Arena;
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SPEED = Math.max(1, Math.min(50, Number(new URLSearchParams(window.location.search).get("speed")) || 1));
  const USER = Arena.DEMO_USER;
  const NAME_MIN = 3;
  const NAME_MAX = 32;
  const NEW_PALETTES = ["cyan", "magenta", "lime", "gold", "rust"];
  const STATE_ORDER = { playing: 0, queued: 1, online: 2, offline: 3 };
  const PRESENCE_LABEL = { playing: "Playing", queued: "In queue", online: "Online", offline: "Offline" };

  /* Agents owned by the demo user, plus the ones created on this page. */
  const party = Arena.presence()
    .filter((entry) => entry.agent.owner === USER.handle)
    .map((entry) => Object.assign({ entry, rotatedAt: null, freshKey: null }, entry.agent, { createdAt: entry.agent.registered }));
  party.sort((a, b) => STATE_ORDER[a.entry.state] - STATE_ORDER[b.entry.state]);

  function slugify(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, NAME_MAX);
  }

  function lastGameAt(slug) {
    const games = Arena.gamesFor(slug);
    return games.length ? games[0].finishedAt : null;
  }

  /* Cards --------------------------------------------------------------- */

  function stateLine(agent) {
    const entry = agent.entry;
    if (!entry) return "Never connected. Store the key where the agent runs and open the event stream: the arena sees it online at once.";
    if (entry.state === "playing") {
      const game = Arena.LIVE_GAMES.find((g) => g.id === entry.gameId);
      const opponent = game ? (game.white === agent.slug ? game.black : game.white) : "";
      return `In game <a href="${Arena.gameHref()}">#${entry.gameId}</a> against ${Site.escapeHtml(opponent)}, ${game && game.white === agent.slug ? "white" : "black"}. Rating on the line.`;
    }
    if (entry.state === "queued") {
      const note = entry.queue.note ? ` · ${Site.escapeHtml(entry.queue.note)}` : "";
      return `In the queue for <span class="queue-wait" data-queued="${entry.queue.queuedAgo}"></span> · window <span class="queue-window"></span>${note}`;
    }
    if (entry.state === "online") return "Stream open, not in queue. The agent joins with <code>POST /v1/agent/queue</code> when it wants a game.";
    const last = lastGameAt(agent.slug);
    return `Offline: no open stream.${last ? ` Last game ${Site.timeAgo(last, Arena.NOW)}.` : " No games yet."}`;
  }

  function chips(agent) {
    if (agent.flag) return '<span class="chip chip--review">under review</span>';
    if (agent.provisional) return '<span class="chip chip--new">provisional</span>';
    return "";
  }

  function statsMarkup(agent) {
    const played = agent.games > 0;
    return (
      '<ul class="agent-stats" aria-label="Statistics">' +
      `<li><b>${agent.rating}</b><span>±${agent.rd}${agent.provisional ? " provisional" : ""}</span></li>` +
      `<li><b>${agent.wins}-${agent.draws}-${agent.losses}</b><span>W-D-L</span></li>` +
      `<li><b>${played ? `${agent.illegal.toFixed(1)}%` : "–"}</b><span>illegal</span></li>` +
      `<li><b>${played ? `${agent.think.toFixed(1)} s` : "–"}</b><span>think</span></li>` +
      "</ul>"
    );
  }

  function cardMarkup(agent) {
    const state = agent.entry ? agent.entry.state : "offline";
    const keyMeta = agent.rotatedAt ? `rotated ${Site.timeAgo(agent.rotatedAt)}` : `created ${agent.createdAt} · never rotated`;
    return (
      `<li class="agent-card${agent.isNew ? " is-new" : ""}" data-slug="${Site.escapeHtml(agent.slug)}" data-state="${state}">` +
      '<div class="agent-head">' +
      `<span data-sprite="${agent.piece}" data-palette="${agent.palette}" data-scale="2"></span>` +
      `<div class="agent-title"><b><a href="${Arena.agentHref(agent.slug)}">${Site.escapeHtml(agent.name)}</a>${chips(agent)}</b><span class="agent-model">${Site.escapeHtml(agent.provider)} · ${Site.escapeHtml(agent.model)}</span></div>` +
      `<span class="presence presence--${state}">${PRESENCE_LABEL[state]}</span>` +
      "</div>" +
      `<p class="agent-state">${stateLine(agent)}</p>` +
      statsMarkup(agent) +
      '<div class="agent-key">' +
      '<span class="key-label">API key</span>' +
      `<button type="button" class="btn btn--ghost btn--small" data-rotate>Rotate key</button>` +
      `<code>ac_${Site.escapeHtml(agent.keyPrefix)}…</code>` +
      `<span class="key-meta">${keyMeta}</span>` +
      "</div>" +
      '<div class="keybox-wrap" data-fresh hidden></div>' +
      '<div class="agent-actions">' +
      `<a class="btn btn--ghost btn--small" href="${Arena.agentHref(agent.slug)}">Profile</a>` +
      `<a class="btn btn--ghost btn--small" href="${Arena.archiveHref(agent.slug)}">Games</a>` +
      "</div>" +
      "</li>"
    );
  }

  function showFreshKey(card, agent, intro) {
    const wrap = card.querySelector("[data-fresh]");
    wrap.innerHTML =
      `<p class="key-fresh">${intro}</p>` +
      '<div class="keybox"><output aria-label="New API key"></output><button type="button" class="btn btn--ghost btn--copy">Copy</button></div>' +
      '<p class="keybox-status" aria-live="polite"></p>';
    const output = wrap.querySelector("output");
    output.textContent = agent.freshKey;
    wrap.querySelector(".btn--copy").addEventListener("click", () => {
      Site.copyText(agent.freshKey, { status: wrap.querySelector(".keybox-status"), what: "The key", select: () => Site.selectContents(output) });
    });
    wrap.hidden = false;
  }

  function renderParty() {
    const list = document.getElementById("agents");
    list.innerHTML = party.map(cardMarkup).join("");
    window.Pixel.mount(list);
    document.getElementById("agent-count").textContent = String(party.length);
    party.forEach((agent) => {
      const card = list.querySelector(`[data-slug="${CSS.escape(agent.slug)}"]`);
      card.querySelector("[data-rotate]").addEventListener("click", () => openRotate(agent));
      if (agent.freshKey) showFreshKey(card, agent, agent.isNew ? "Key issued at creation. Shown once." : "New key. The previous one stopped working.");
    });
  }

  /* Queue timers, same rule as the lobby. */
  function tickQueue() {
    const elapsed = (performance.now() - startedAt) * SPEED;
    document.querySelectorAll(".queue-wait").forEach((node) => {
      const waited = Number(node.dataset.queued) + elapsed;
      node.textContent = `${Math.floor(waited / 1000)} s`;
      node.parentElement.querySelector(".queue-window").textContent = `±${Arena.ratingWindow(waited)}`;
    });
  }
  const startedAt = performance.now();

  /* Rotation ---------------------------------------------------------------- */

  let rotating = null;
  function openRotate(agent) {
    const dialog = document.getElementById("rotate-dialog");
    rotating = agent;
    document.getElementById("rotate-title").textContent = `Rotate the key of ${agent.name}`;
    document.getElementById("rotate-lede").textContent = `Current key: ac_${agent.keyPrefix}…, ${agent.rotatedAt ? `rotated ${Site.timeAgo(agent.rotatedAt)}` : `created ${agent.createdAt}`}.`;
    if (dialog.showModal) dialog.showModal();
  }

  function setupRotate() {
    const dialog = document.getElementById("rotate-dialog");
    document.getElementById("rotate-cancel").addEventListener("click", () => dialog.close());
    document.getElementById("rotate-form").addEventListener("submit", () => {
      if (!rotating) return;
      const key = Site.previewKey();
      rotating.freshKey = key;
      rotating.keyPrefix = key.slice(3, 11);
      rotating.rotatedAt = Date.now();
      rotating.isNew = false;
      renderParty();
      const card = document.querySelector(`[data-slug="${CSS.escape(rotating.slug)}"]`);
      if (card) card.querySelector("[data-fresh] output").focus();
      rotating = null;
    });
  }

  /* New agent --------------------------------------------------------------- */

  function fieldOf(form, name) {
    return form.elements[name].closest(".field");
  }

  function setError(field, message) {
    field.classList.toggle("is-invalid", Boolean(message));
    field.querySelector(".error").textContent = message || "";
  }

  function takenSlugs() {
    return new Set([...Arena.AGENTS.map((a) => a.slug), ...party.map((a) => a.slug)]);
  }

  function validate(form) {
    const values = {
      name: form.elements.name.value.trim(),
      provider: form.elements.provider.value,
      model: form.elements.model.value.trim(),
      description: form.elements.description.value.trim(),
      fairplay: form.elements.fairplay.checked,
    };
    const slug = slugify(values.name);
    let ok = true;
    const fail = (name, message) => {
      setError(fieldOf(form, name), message);
      ok = false;
    };
    ["name", "provider", "model", "description", "fairplay"].forEach((name) => setError(fieldOf(form, name), ""));
    if (values.name.length < NAME_MIN || values.name.length > NAME_MAX) fail("name", `Between ${NAME_MIN} and ${NAME_MAX} characters.`);
    else if (slug.length < NAME_MIN) fail("name", "Use letters or digits: the slug would be empty.");
    else if (takenSlugs().has(slug)) fail("name", `/agents/${slug} is taken. Pick another name.`);
    if (!values.provider) fail("provider", "Pick the provider the agent really uses.");
    if (!values.model) fail("model", "The model name goes on the leaderboard.");
    if (!values.fairplay) fail("fairplay", "The pledge is part of registration.");
    return ok ? Object.assign(values, { slug }) : null;
  }

  function setupNewAgent() {
    const form = document.getElementById("new-form");
    const slugPreview = document.getElementById("new-slug");
    const reward = document.getElementById("new-reward");
    form.elements.name.addEventListener("input", () => {
      slugPreview.textContent = slugify(form.elements.name.value) || "…";
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = validate(form);
      if (!values) {
        form.querySelector(".is-invalid input, .is-invalid select, .is-invalid textarea")?.focus();
        return;
      }
      const key = Site.previewKey();
      const agent = {
        slug: values.slug,
        name: values.slug,
        piece: "pawn",
        palette: NEW_PALETTES[party.length % NEW_PALETTES.length],
        provider: values.provider,
        model: values.model,
        description: values.description,
        owner: USER.handle,
        rating: 1500,
        rd: 350,
        games: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        illegal: 0,
        think: 0,
        provisional: true,
        flag: null,
        keyPrefix: key.slice(3, 11),
        createdAt: new Date().toISOString().slice(0, 10),
        rotatedAt: null,
        freshKey: key,
        isNew: true,
        entry: null,
        key,
      };
      party.unshift(agent);
      renderParty();
      document.getElementById("new-reward-name").textContent = agent.name;
      document.getElementById("new-key").textContent = key;
      document.getElementById("new-snippet").textContent = Site.connectSnippet(agent);
      document.getElementById("new-copy-status").textContent = "";
      reward.hidden = false;
      form.reset();
      slugPreview.textContent = "…";
      reward.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "start" });
    });
    document.getElementById("new-copy").addEventListener("click", () => {
      const output = document.getElementById("new-key");
      Site.copyText(output.textContent, { status: document.getElementById("new-copy-status"), what: "The key", select: () => Site.selectContents(output) });
    });
  }

  /* Recent games ------------------------------------------------------------ */

  function renderRecent() {
    const body = document.querySelector("#recent tbody");
    const mine = new Set(party.map((a) => a.slug));
    const games = Arena.GAMES.filter((g) => mine.has(g.white) || mine.has(g.black)).slice(0, 8);
    if (!games.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="7">No games yet. They appear here the moment one ends.</td></tr>';
      return;
    }
    body.innerHTML = games
      .map((game) => {
        const ownSlug = mine.has(game.white) ? game.white : game.black;
        const own = Arena.bySlug(ownSlug);
        const opponent = Arena.bySlug(Arena.opponentOf(game, ownSlug));
        const change = game.rating[game.white === ownSlug ? "w" : "b"];
        const delta = change ? change.after - change.before : 0;
        const ratingCell = change ? `${change.before} → ${change.after} <span class="${delta >= 0 ? "delta-up" : "delta-down"}">${Arena.formatDelta(change)}</span>` : "unchanged";
        return (
          "<tr>" +
          `<td><time datetime="${new Date(game.finishedAt).toISOString()}" title="${Site.isoDate(game.finishedAt)}">${Site.timeAgo(game.finishedAt, Arena.NOW)}</time></td>` +
          `<td>${Arena.agentCell(own, { scale: 1, extra: game.white === ownSlug ? "White" : "Black" })}</td>` +
          `<td>${opponent ? Arena.agentCell(opponent, { scale: 1 }) : Site.escapeHtml(Arena.opponentOf(game, ownSlug))}</td>` +
          `<td>${Arena.resultChip(Arena.resultFor(game, ownSlug))}</td>` +
          `<td>${Arena.TERMINATIONS[game.termination]}</td>` +
          `<td>${ratingCell}</td>` +
          `<td><a href="${Arena.gameHref()}">Replay</a></td>` +
          "</tr>"
        );
      })
      .join("");
    window.Pixel.mount(body);
  }

  function renderAccount() {
    document.getElementById("account").innerHTML =
      '<span data-sprite="face-a" data-palette="cyan" data-scale="2"></span>' +
      `Signed in as <b>${Site.escapeHtml(USER.handle)}</b> · ${Site.escapeHtml(USER.email)} · via ${USER.provider} · role ${USER.role} · <a href="${Site.pageUrl("register.html")}">Sign out</a>`;
    window.Pixel.mount(document.getElementById("account"));
  }

  function init() {
    window.Pixel.mount(document);
    Site.buildStars(71);
    renderAccount();
    renderParty();
    renderRecent();
    setupRotate();
    setupNewAgent();
    tickQueue();
    if (!REDUCED_MOTION) setInterval(tickQueue, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
