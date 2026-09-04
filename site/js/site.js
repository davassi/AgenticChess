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

  /* A hand-typed hash can hold a broken percent-escape; keep it as text. */
  function decodeHash(raw) {
    try {
      return decodeURIComponent(raw);
    } catch (error) {
      return raw;
    }
  }

  /*
   * Hash routing. A bare hash ("#opusbot") is a single value; a hash with
   * "=" is a query string ("#agent=opusbot&result=win"). Both survive the
   * single-file artifact hosting, unlike real query strings.
   */
  function readHash() {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw) return { value: "", params: new URLSearchParams() };
    if (!raw.includes("=")) return { value: decodeHash(raw), params: new URLSearchParams() };
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

  /* "1st", "2nd", "111th": the teens always take "th". */
  function ordinal(n) {
    const teen = n % 100;
    const suffix = teen >= 11 && teen <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
    return `${n}${suffix}`;
  }

  /* "1 game" / "3 games". */
  function plural(count, singular, pluralForm) {
    return `${count} ${count === 1 ? singular : pluralForm || `${singular}s`}`;
  }

  /* API keys have the arena's real shape: ac_ + 8-char lookup prefix + 43-char secret. */
  const KEY_PREFIX = "ac_";
  const LOOKUP_PREFIX_BYTES = 6;
  const SECRET_BYTES = 32;

  function base64url(bytes) {
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function randomBytes(size) {
    const bytes = new Uint8Array(size);
    window.crypto.getRandomValues(bytes);
    return bytes;
  }

  function previewKey() {
    return `${KEY_PREFIX}${base64url(randomBytes(LOOKUP_PREFIX_BYTES))}${base64url(randomBytes(SECRET_BYTES))}`;
  }

  /* A stable-looking lookup prefix for illustrative agents. */
  function previewKeyPrefix(seed) {
    const rand = seededRandom(seed);
    const bytes = new Uint8Array(LOOKUP_PREFIX_BYTES);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(rand() * 256);
    return base64url(bytes);
  }

  /*
   * Copy to the clipboard, or select the text so it can be copied by hand
   * where the clipboard is blocked. `select` is the fallback, `status` a node
   * that reads the outcome aloud.
   */
  async function copyText(text, options) {
    const opts = options || {};
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      if (opts.status) opts.status.textContent = "Copied.";
      return true;
    } catch (error) {
      if (opts.select) opts.select();
      if (opts.status) opts.status.textContent = `Clipboard blocked here. ${opts.what || "The text"} is selected: copy it by hand.`;
      return false;
    }
  }

  function selectContents(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /* The snippet shown next to a fresh key. */
  function connectSnippet(agent) {
    return [
      "# where the agent runs, never in the repository",
      `export AICHESS_API_KEY="${agent.key}"`,
      "",
      `// ${agent.name} · ${agent.provider} · ${agent.model}`,
      'import { AiChessClient } from "@aichess/sdk";',
      "",
      "const client = new AiChessClient({",
      "  apiKey: process.env.AICHESS_API_KEY,",
      `  baseUrl: "${(window.Protocol && window.Protocol.BASE_URL) || "https://api.aichess.example"}",`,
      "});",
      "client.onYourTurn(async (turn) => askMyModel(turn));",
      "await client.joinQueue();",
      "await client.run();",
    ].join("\n");
  }

  /*
   * An agent created on the registration page shows up on the dashboard.
   * sessionStorage keeps it for the tab only, and never holds the key: that
   * is shown once, on the page that issued it.
   */
  const HANDOVER_KEY = "agentic-chess-new-agents";

  function rememberNewAgent(agent) {
    try {
      const kept = newAgents();
      kept.push({
        slug: agent.slug,
        name: agent.name || agent.slug,
        provider: agent.provider,
        model: agent.model,
        description: agent.description || "",
        piece: agent.piece,
        palette: agent.palette,
        keyPrefix: agent.key ? agent.key.slice(3, 11) : "",
        createdAt: new Date().toISOString().slice(0, 10),
      });
      window.sessionStorage.setItem(HANDOVER_KEY, JSON.stringify(kept));
    } catch (error) {
      // Private windows and blocked storage: the dashboard simply shows the demo agents.
    }
  }

  function newAgents() {
    try {
      const raw = window.sessionStorage.getItem(HANDOVER_KEY);
      const kept = raw ? JSON.parse(raw) : [];
      return Array.isArray(kept) ? kept : [];
    } catch (error) {
      return [];
    }
  }

  /*
   * Empty and error states as screens of the same game: an icon, a title,
   * a line of text and the ways out. Call Pixel.mount on the container.
   */
  function emptyState(options) {
    const actions = (options.actions || [])
      .map((a) => `<a class="btn ${a.primary ? "btn--start" : "btn--ghost"}" href="${a.href}">${escapeHtml(a.label)}</a>`)
      .join(" ");
    return (
      `<div class="empty-screen${options.compact ? " empty-screen--compact" : ""}" role="status">` +
      `<span class="empty-art" data-sprite="${options.sprite || "skull"}" data-palette="${options.palette || "ivory"}" data-scale="${options.scale || (options.compact ? 3 : 5)}"></span>` +
      (options.kicker ? `<p class="empty-kicker">${escapeHtml(options.kicker)}</p>` : "") +
      `<p class="empty-title">${escapeHtml(options.title)}</p>` +
      (options.text ? `<p class="empty-text">${options.text}</p>` : "") +
      (actions ? `<p class="empty-actions">${actions}</p>` : "") +
      "</div>"
    );
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.Site = {
    seededRandom,
    buildStars,
    readHash,
    writeHash,
    pageUrl,
    timeAgo,
    isoDate,
    plural,
    ordinal,
    escapeHtml,
    emptyState,
    rememberNewAgent,
    newAgents,
    previewKey,
    previewKeyPrefix,
    copyText,
    selectContents,
    connectSnippet,
  };
})();
