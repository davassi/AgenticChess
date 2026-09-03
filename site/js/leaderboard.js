/*
 * Leaderboard: winners' circle on canvas, then a sortable, filterable table.
 * The table is complete in the HTML; this script only enhances it, so the
 * standings read fine without JavaScript.
 */
(function () {
  "use strict";

  const PODIUM_HEIGHTS = { 1: 44, 2: 30, 3: 20 };
  const PODIUM_COLORS = {
    1: { left: "#c98a12", right: "#8f6209", rim: "#3d2a05" },
    2: { left: "#cdb98e", right: "#9c8a63", rim: "#3a2a1a" },
    3: { left: "#b4552b", right: "#7e3a1c", rim: "#3a1608" },
  };
  const NUMERIC_KEYS = ["rating", "rd", "games", "illegal", "think", "accuracy", "engine"];

  /* Winners' circle ---------------------------------------------------- */

  function drawPodium(canvas, cards) {
    const Iso = window.Iso;
    const Pixel = window.Pixel;
    const ctx = canvas.getContext("2d");
    const groundY = canvas.height - 18;
    const slotX = { 2: 40, 1: 120, 3: 200 };
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Shared floor under the three pedestals.
    ctx.fillStyle = "rgba(6, 3, 20, 0.5)";
    ctx.fillRect(8, groundY + 4, canvas.width - 16, 6);

    cards.forEach((card) => {
      const slot = Number(card.dataset.slot);
      const height = PODIUM_HEIGHTS[slot];
      const colors = PODIUM_COLORS[slot];
      const origin = { x: slotX[slot], y: groundY - height - 32 };
      for (let row = 0; row < 2; row += 1) {
        for (let col = 0; col < 2; col += 1) {
          const p = Iso.project(origin, col, row);
          Iso.fillPrism(ctx, p.x, p.y, 16, height, {
            left: colors.left,
            right: colors.right,
            top: (col + row) % 2 ? "#b4552b" : "#f6e7c1",
            rim: colors.rim,
          });
        }
      }
      const center = Iso.project(origin, 1, 1);
      Iso.fillDiamond(ctx, center.x, center.y - 8, 16, "rgba(255, 194, 51, 0.35)");
      const sprite = Pixel.toCanvas(Pixel.PIECES[card.dataset.piece], Pixel.PALETTES[card.dataset.palette]);
      const baseY = center.y + 4;
      Iso.fillDiamond(ctx, center.x, baseY - 5, 6, "rgba(6, 3, 20, 0.35)");
      ctx.drawImage(sprite, center.x - Math.floor(sprite.width / 2), baseY - sprite.height);
    });
  }

  /* Standings ---------------------------------------------------------- */

  function readRow(row) {
    const data = { el: row, provisional: row.dataset.provisional === "true" };
    NUMERIC_KEYS.forEach((key) => {
      data[key] = Number(row.dataset[key] || 0);
    });
    data.text = row.textContent.toLowerCase();
    return data;
  }

  function compare(a, b, key, direction) {
    const diff = a[key] - b[key];
    if (diff !== 0) return direction === "descending" ? -diff : diff;
    // Rating ties break on deviation, lower first, as the arena does.
    return a.rd - b.rd;
  }

  function setupStandings() {
    const table = document.getElementById("standings-table");
    const body = document.getElementById("standings-body");
    const emptyRow = document.getElementById("empty-row");
    const filter = document.getElementById("filter");
    const toggle = document.getElementById("show-provisional");
    const summary = document.getElementById("summary");
    if (!table || !body) return;

    const rows = [...body.querySelectorAll("tr[data-rating]")].map(readRow);
    let sortKey = "rating";
    let direction = "descending";

    const render = () => {
      const query = filter.value.trim().toLowerCase();
      const showProvisional = toggle.checked;
      const rated = rows.filter((r) => !r.provisional).sort((a, b) => compare(a, b, sortKey, direction));
      const provisional = rows.filter((r) => r.provisional).sort((a, b) => compare(a, b, sortKey, direction));
      let visible = 0;
      let hiddenProvisional = 0;
      [...rated, ...provisional].forEach((r) => {
        const matches = !query || r.text.includes(query);
        const allowed = !r.provisional || showProvisional;
        if (r.provisional && !showProvisional) hiddenProvisional += 1;
        r.el.hidden = !(matches && allowed);
        if (!r.el.hidden) visible += 1;
        body.appendChild(r.el);
      });
      body.appendChild(emptyRow);
      emptyRow.hidden = visible > 0;
      const parts = [`${visible} agent${visible === 1 ? "" : "s"} shown`];
      if (hiddenProvisional > 0) parts.push(`${hiddenProvisional} provisional hidden`);
      summary.textContent = parts.join(" · ");
      table.querySelectorAll("th[data-key]").forEach((th) => {
        const button = th.querySelector(".sort");
        if (!button) return;
        if (button.dataset.sort === sortKey) th.setAttribute("aria-sort", direction);
        else th.removeAttribute("aria-sort");
      });
    };

    table.querySelectorAll(".sort").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.sort;
        if (key === sortKey) {
          direction = direction === "descending" ? "ascending" : "descending";
        } else {
          sortKey = key;
          // Lower is better for illegal-move rate and think time.
          direction = key === "illegal" || key === "think" ? "ascending" : "descending";
        }
        render();
      });
    });
    filter.addEventListener("input", render);
    toggle.addEventListener("change", render);
    render();
  }

  function init() {
    window.Pixel.mount(document);
    window.Site.buildStars(23);
    const canvas = document.getElementById("podium-scene");
    const cards = document.querySelectorAll(".podium-card[data-slot]");
    if (canvas && window.Iso && cards.length) drawPodium(canvas, cards);
    setupStandings();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
