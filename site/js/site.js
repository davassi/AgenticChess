/*
 * Shared page plumbing: the starfield behind every screen, hash parameters
 * for pages that address one record (agent.html#opusbot,
 * games.html#agent=opusbot&result=win) and relative time labels.
 */
(function () {
  "use strict";

  /* Deterministic generator so a page draws the same sky on every visit. */
  function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  /* Starfield: one element, many box-shadows, all on a 2px grid. */
  function buildStars(seed) {
    const host = document.getElementById("stars");
    if (!host) return;
    const rand = seededRandom(seed || 7);
    const shadows = [];
    for (let i = 0; i < 160; i += 1) {
      const x = Math.floor(rand() * 100);
      const y = Math.floor(rand() * 100);
      const bright = rand();
      const color = bright > 0.85 ? "#ffe58a" : bright > 0.6 ? "#f6e7c1" : "#6f5fa3";
      shadows.push(`${x}vw ${y}vh 0 ${bright > 0.9 ? 1 : 0}px ${color}`);
    }
    host.style.boxShadow = shadows.join(",");
  }

  /*
   * Hash routing. A bare hash ("#opusbot") is a single value; a hash with
   * "=" is a query string ("#agent=opusbot&result=win"). Both survive the
   * single-file artifact hosting, unlike real query strings.
   */
  function readHash() {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw) return { value: "", params: new URLSearchParams() };
    if (!raw.includes("=")) return { value: decodeURIComponent(raw), params: new URLSearchParams() };
    return { value: "", params: new URLSearchParams(raw) };
  }

  function writeHash(params) {
    const entries = [...params.entries()].filter(([, v]) => v && v !== "any");
    const next = entries.length ? `#${new URLSearchParams(entries).toString()}` : "";
    if (next === window.location.hash || (!next && !window.location.hash)) return;
    // replaceState keeps filter changes out of the back-button history.
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next}`);
  }

  /* "4 min ago", "2 h ago", "yesterday", "3 days ago". */
  function timeAgo(timestamp, now) {
    const diff = Math.max(0, (now || Date.now()) - timestamp);
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return "yesterday";
    return `${days} days ago`;
  }

  function isoDate(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }

  /*
   * Links to other pages of the site. The single-file bundles publish every
   * page at its own address and inject window.SITE_PAGES so generated links
   * keep working there; locally the relative path is used as-is.
   */
  function pageUrl(page, hash) {
    const pages = window.SITE_PAGES || {};
    return `${pages[page] || page}${hash || ""}`;
  }

  /* "1 game" / "3 games". */
  function plural(count, singular, pluralForm) {
    return `${count} ${count === 1 ? singular : pluralForm || `${singular}s`}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.Site = { seededRandom, buildStars, readHash, writeHash, pageUrl, timeAgo, isoDate, plural, escapeHtml };
})();
