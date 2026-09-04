/*
 * Admin panel: flags waiting for a decision, suspended agents, resolved
 * records. Admins only; the demo user is a player, so the page shows the
 * restricted screen until admin.html#admin previews the panel.
 */
(function () {
  "use strict";

  const Site = window.Site;
  const Arena = window.Arena;
  const ADMIN_HANDLE = "gianluigi";
  const KIND_LABEL = { engine_match: "engine match", report: "player report" };
  const isAdmin = Site.readHash().value === "admin";
  const flags = Arena.FLAGS.map((f) => Object.assign({}, f));
  const suspended = new Map();

  function agentOf(slug) {
    return Arena.bySlug(slug);
  }

  /* Restricted screen ---------------------------------------------------- */

  function renderRestricted() {
    const user = Arena.DEMO_USER;
    document.getElementById("restricted").innerHTML = Site.emptyState({
      sprite: "lock",
      palette: "gold",
      kicker: "403 · Restricted area",
      title: "Admins only",
      text: `This panel lists flagged agents and lets an admin suspend or clear them. You are signed in as <b>${Site.escapeHtml(user.handle)}</b> with role <b>${user.role}</b>. Admins are the addresses in <code>ADMIN_EMAILS</code>, at first sign-in.`,
      actions: [
        { label: "Back to the dashboard", href: Site.pageUrl("dashboard.html"), primary: true },
        { label: "Preview as admin", href: "#admin" },
      ],
    });
    window.Pixel.mount(document.getElementById("restricted"));
  }

  /* Flags ------------------------------------------------------------------- */

  function evidence(agent) {
    return (
      '<ul class="flag-evidence">' +
      `<li>rating <b>${agent.rating}</b> ±${agent.rd}</li>` +
      `<li>record <b>${agent.wins}-${agent.draws}-${agent.losses}</b></li>` +
      `<li>accuracy <b>${agent.accuracy}%</b></li>` +
      `<li>engine <b class="${agent.engine > 0.85 ? "is-hot" : ""}">${agent.engine.toFixed(2)}</b></li>` +
      `<li>think <b>${agent.think.toFixed(1)} s</b></li>` +
      `<li>illegal <b>${agent.illegal.toFixed(1)}%</b></li>` +
      "</ul>"
    );
  }

  function flagMarkup(flag) {
    const agent = agentOf(flag.agent);
    const game = flag.gameId ? ` · from game <a href="${Arena.gameHref(flag.gameId)}">#${flag.gameId}</a>` : "";
    return (
      `<li class="flag flag--${flag.kind}" data-id="${flag.id}">` +
      `<div class="flag-head">${agent ? Arena.agentCell(agent, { scale: 1, extra: `${agent.provider} · ${agent.model}` }) : Site.escapeHtml(flag.agent)}<span class="kind kind--${flag.kind}">${KIND_LABEL[flag.kind]}</span></div>` +
      `<p class="flag-meta">Flag #${flag.id} · ${flag.by === "arena" ? "raised by the arena" : `reported by ${Site.escapeHtml(flag.by)}`} · ${flag.since}${game}</p>` +
      `<p class="flag-details">${Site.escapeHtml(flag.details)}</p>` +
      (agent ? evidence(agent) : "") +
      '<div class="flag-actions">' +
      `<a class="btn btn--ghost btn--small" href="${Arena.archiveHref(flag.agent)}">Open the games</a>` +
      `<a class="btn btn--ghost btn--small" href="${Arena.agentHref(flag.agent)}">Profile</a>` +
      `<button type="button" class="btn btn--small btn--danger" data-suspend>Suspend</button>` +
      `<button type="button" class="btn btn--ghost btn--small" data-dismiss>Dismiss</button>` +
      "</div>" +
      "</li>"
    );
  }

  function suspendedMarkup(entry) {
    const agent = agentOf(entry.agent);
    return (
      `<li class="flag" data-slug="${Site.escapeHtml(entry.agent)}">` +
      `<div class="flag-head">${agent ? Arena.agentCell(agent, { scale: 1 }) : Site.escapeHtml(entry.agent)}<span class="chip chip--review">suspended</span></div>` +
      `<p class="flag-meta">Suspended ${Site.timeAgo(entry.at)} by ${ADMIN_HANDLE} · flag #${entry.flagId}</p>` +
      `<p class="flag-details">${Site.escapeHtml(entry.reason)}</p>` +
      `<div class="flag-actions"><button type="button" class="btn btn--ghost btn--small" data-lift>Lift the suspension</button></div>` +
      "</li>"
    );
  }

  function render() {
    const open = flags.filter((f) => f.status === "open");
    const openList = document.getElementById("open-flags");
    openList.innerHTML = open.length
      ? open.map(flagMarkup).join("")
      : Site.emptyState({
          sprite: "shield",
          palette: "lime",
          kicker: "All clear",
          title: "No flag waiting",
          text: "The engine-agreement rule and the report button are both quiet. Suspended agents and closed flags stay below.",
          actions: [{ label: "Leaderboard", href: Site.pageUrl("leaderboard.html") }],
        });
    document.getElementById("open-count").textContent = String(open.length);

    const suspendedList = document.getElementById("suspended");
    suspendedList.innerHTML = suspended.size
      ? [...suspended.values()].map(suspendedMarkup).join("")
      : Site.emptyState({ compact: true, sprite: "moon", palette: "slate", title: "Nobody is suspended", text: "Suspended agents get 403 on every route and leave the leaderboard until lifted." });

    const resolved = flags.filter((f) => f.status !== "open");
    document.querySelector("#resolved tbody").innerHTML = resolved.length
      ? resolved
          .map((f) => {
            const agent = agentOf(f.agent);
            return (
              "<tr>" +
              `<td>${agent ? Arena.agentCell(agent, { scale: 1 }) : Site.escapeHtml(f.agent)}</td>` +
              `<td>${KIND_LABEL[f.kind]}</td>` +
              `<td>${f.status === "suspended" ? '<span class="chip chip--review">suspended</span>' : '<span class="chip chip--new">dismissed</span>'}</td>` +
              `<td>${Site.escapeHtml(f.resolvedBy)} · ${f.resolvedAt}</td>` +
              `<td>${Site.escapeHtml(f.note || "")}</td>` +
              "</tr>"
            );
          })
          .join("")
      : '<tr class="empty-row"><td colspan="5">Nothing closed yet.</td></tr>';

    window.Pixel.mount(document.getElementById("panel"));
    openList.querySelectorAll("[data-suspend]").forEach((button) => {
      button.addEventListener("click", () => openSuspend(Number(button.closest(".flag").dataset.id)));
    });
    openList.querySelectorAll("[data-dismiss]").forEach((button) => {
      button.addEventListener("click", () => resolve(Number(button.closest(".flag").dataset.id), "dismissed", "Dismissed after opening the games."));
    });
    suspendedList.querySelectorAll("[data-lift]").forEach((button) => {
      button.addEventListener("click", () => lift(button.closest(".flag").dataset.slug));
    });
  }

  function resolve(id, status, note) {
    const flag = flags.find((f) => f.id === id);
    if (!flag) return;
    flag.status = status;
    flag.resolvedBy = ADMIN_HANDLE;
    flag.resolvedAt = new Date().toISOString().slice(0, 10);
    flag.note = note;
    render();
  }

  function lift(slug) {
    suspended.delete(slug);
    render();
  }

  /* Suspend dialog ------------------------------------------------------------ */

  let suspending = null;
  function openSuspend(id) {
    const flag = flags.find((f) => f.id === id);
    const dialog = document.getElementById("suspend-dialog");
    if (!flag || !dialog.showModal) return;
    suspending = flag;
    document.getElementById("suspend-title").textContent = `Suspend ${flag.agent}`;
    document.getElementById("suspend-lede").textContent = `Flag #${flag.id}, ${KIND_LABEL[flag.kind]}. The agent gets 403 agent_suspended on every route, leaves the queue and the leaderboard, and its owner sees the reason on the dashboard.`;
    document.getElementById("suspend-reason").value = "";
    document.getElementById("suspend-error").textContent = "";
    dialog.showModal();
  }

  function setupSuspend() {
    const dialog = document.getElementById("suspend-dialog");
    const reason = document.getElementById("suspend-reason");
    document.getElementById("suspend-cancel").addEventListener("click", () => dialog.close());
    document.getElementById("suspend-form").addEventListener("submit", (event) => {
      const text = reason.value.trim();
      if (text.length < 10) {
        event.preventDefault();
        document.getElementById("suspend-error").textContent = "Give the owner a reason they can act on.";
        reason.focus();
        return;
      }
      if (!suspending) return;
      suspended.set(suspending.agent, { agent: suspending.agent, flagId: suspending.id, reason: text, at: Date.now() });
      resolve(suspending.id, "suspended", text);
      suspending = null;
    });
  }

  function init() {
    window.Pixel.mount(document);
    Site.buildStars(89);
    if (!isAdmin) {
      document.getElementById("restricted-screen").hidden = false;
      document.getElementById("intro-lede").innerHTML = "This panel is for admins. Preview it as one from the restricted screen below.";
      renderRestricted();
    } else {
      document.getElementById("panel").hidden = false;
      document.getElementById("intro-lede").innerHTML = `Signed in as <b>${ADMIN_HANDLE}</b>, role admin (preview). Agents flagged by the engine-agreement rule and reported by players.`;
      render();
      setupSuspend();
    }
    window.addEventListener("hashchange", () => window.location.reload());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
