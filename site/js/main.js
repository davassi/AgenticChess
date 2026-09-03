/*
 * Page wiring: sprites, starfield, the living board on the title screen,
 * the architecture map and the continue countdown.
 */
(function () {
  "use strict";

  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MOVE_BUDGET_MS = 60000;

  /* Illustrated opening: a Sicilian with one genuinely illegal attempt. */
  const OPENING = [
    {
      side: "w",
      from: "e2",
      to: "e4",
      san: "e4",
      think: 1800,
      say: "Classical centre. I want open lines for the bishops.",
    },
    {
      side: "b",
      from: "c7",
      to: "c5",
      san: "c5",
      think: 2600,
      say: "Sicilian. Asymmetry gives me winning chances as Black.",
    },
    { side: "w", from: "g1", to: "f3", san: "Nf3", think: 1400, hop: 12, say: "Developing with tempo toward d4." },
    { side: "b", from: "b8", to: "c6", san: "Nc6", think: 3100, hop: 12, say: "Guarding d4 and preparing …e6 or …g6." },
    {
      side: "w",
      from: "d2",
      to: "d4",
      san: "d4",
      think: 2200,
      say: "Open Sicilian. Trading the d-pawn for the c-pawn opens the d-file.",
    },
    {
      side: "b",
      from: "f8",
      to: "b4",
      san: "Bb4+",
      think: 2900,
      illegal: "Illegal move: the bishop on f8 is blocked by the pawn on e7. 2 attempts left.",
    },
    { side: "b", from: "c5", to: "d4", san: "cxd4", think: 1500, say: "Correcting myself: the pawn takes on d4." },
    {
      side: "w",
      from: "f3",
      to: "d4",
      san: "Nxd4",
      think: 1700,
      hop: 12,
      say: "Recapturing. My knight sits in the centre.",
    },
  ];

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /*
   * Pixel canvases are scaled by whole numbers so every source pixel becomes
   * an even block on screen. Below 1x they fall back to fluid width.
   */
  function fitPixelCanvas(canvas, options) {
    const opts = options || {};
    const maxScale = opts.maxScale || 3;
    const available = canvas.parentElement.clientWidth;
    let scale = Math.floor(available / canvas.width);
    if (opts.reserveHeight !== undefined) {
      scale = Math.min(scale, Math.floor((window.innerHeight - opts.reserveHeight) / canvas.height));
    }
    scale = Math.min(maxScale, scale);
    if (scale < 1) {
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      return;
    }
    canvas.style.width = `${canvas.width * scale}px`;
    canvas.style.height = `${canvas.height * scale}px`;
  }

  function keepFitted(canvas, options) {
    let pending = false;
    const apply = () => {
      pending = false;
      fitPixelCanvas(canvas, options);
    };
    apply();
    window.addEventListener("resize", () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(apply);
    });
  }

  /* Starfield: one element, many box-shadows, all on a 2px grid. */
  function buildStars() {
    const host = document.getElementById("stars");
    if (!host) return;
    const shadows = [];
    let seed = 7;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 160; i += 1) {
      const x = Math.floor(rand() * 100);
      const y = Math.floor(rand() * 100);
      const bright = rand();
      const color = bright > 0.85 ? "#ffe58a" : bright > 0.6 ? "#f6e7c1" : "#6f5fa3";
      shadows.push(`${x}vw ${y}vh 0 ${bright > 0.9 ? 1 : 0}px ${color}`);
    }
    host.style.boxShadow = shadows.join(",");
  }

  /* Agent HUD panel on the title screen. */
  class AgentPanel {
    constructor(root) {
      this.root = root;
      this.fill = root.querySelector("[data-clock-fill]");
      this.time = root.querySelector("[data-clock-time]");
      this.status = root.querySelector("[data-status]");
      this.bubble = root.querySelector("[data-bubble]");
      this.timer = null;
      this.typing = 0;
    }

    idle() {
      this.stopClock();
      this.fill.style.width = "100%";
      this.time.textContent = "60.0";
      this.status.className = "agent-status";
      this.status.textContent = "waiting";
    }

    think(durationMs) {
      this.status.className = "agent-status is-thinking";
      this.status.textContent = "thinking";
      const start = performance.now();
      this.stopClock();
      this.timer = setInterval(() => {
        const elapsed = performance.now() - start;
        const left = Math.max(0, MOVE_BUDGET_MS - elapsed);
        this.fill.style.width = `${(left / MOVE_BUDGET_MS) * 100}%`;
        this.time.textContent = (left / 1000).toFixed(1);
      }, 100);
      return sleep(durationMs);
    }

    stopClock() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }

    played(san, thinkMs) {
      this.stopClock();
      this.status.className = "agent-status";
      this.status.textContent = `played ${san} in ${(thinkMs / 1000).toFixed(1)}s`;
    }

    rejected(message) {
      this.stopClock();
      this.status.className = "agent-status is-illegal";
      this.status.textContent = "rejected by the arena";
      this.say(message);
    }

    say(text) {
      this.typing += 1;
      const session = this.typing;
      this.bubble.textContent = "";
      if (REDUCED_MOTION) {
        this.bubble.textContent = text;
        return;
      }
      let i = 0;
      const tick = () => {
        if (session !== this.typing) return;
        i += 1;
        this.bubble.textContent = text.slice(0, i);
        if (i < text.length) setTimeout(tick, 28);
      };
      tick();
    }

    clear() {
      this.typing += 1;
      this.bubble.textContent = "";
    }
  }

  async function runOpening(scene, panels) {
    scene.reset();
    panels.w.idle();
    panels.b.idle();
    panels.w.clear();
    panels.b.clear();
    await sleep(1200);
    for (const step of OPENING) {
      const panel = panels[step.side];
      await panel.think(step.think);
      if (step.illegal) {
        panel.rejected(step.illegal);
        await scene.illegal(step.from, step.to);
        await sleep(1400);
        continue;
      }
      // The agent has answered: its clock stops before the piece slides.
      panel.played(step.san, step.think);
      await scene.move(step.from, step.to, { hop: step.hop });
      panel.say(step.say);
      await sleep(600);
    }
    await sleep(4200);
  }

  function setupBoard() {
    const canvas = document.getElementById("board");
    if (!canvas || !window.Iso) return;
    keepFitted(canvas, { maxScale: 3, reserveHeight: 160 });
    const scene = new window.Iso.BoardScene(canvas);
    const panels = {
      w: new AgentPanel(document.getElementById("agent-w")),
      b: new AgentPanel(document.getElementById("agent-b")),
    };

    if (REDUCED_MOTION) {
      // A single still: the position after 4.Nxd4, with both last comments.
      const position = Object.assign({}, window.Iso.START_POSITION);
      delete position.e2;
      position.e4 = "w-pawn";
      delete position.c7;
      delete position.g1;
      delete position.b8;
      position.c6 = "b-knight";
      delete position.d2;
      position.d4 = "w-knight";
      scene.setPosition(position);
      panels.w.played("Nxd4", 1700);
      panels.w.say(OPENING[7].say);
      panels.b.played("cxd4", 1500);
      panels.b.say(OPENING[6].say);
      return;
    }

    scene.start();
    const loop = async () => {
      for (;;) {
        await runOpening(scene, panels);
      }
    };
    loop().catch(() => {
      scene.stop();
    });

    // Pause the animation loop when the board is off screen.
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) scene.start();
          else scene.stop();
        });
      });
      observer.observe(canvas);
    }
  }

  function setupCity() {
    const canvas = document.getElementById("city");
    if (!canvas || !window.Iso) return;
    keepFitted(canvas, { maxScale: 2 });
    const palette = (top, left, right, roof) => ({ top, left, right, roof, window: "#ffe58a" });
    const buildings = [
      { name: "web", col: 0, row: 3, w: 2, d: 2, h: 22, colors: palette("#5ff2ff", "#2bb7c9", "#1a8a99", "#8cf7ff") },
      {
        name: "api",
        col: 3,
        row: 0,
        w: 2,
        d: 2,
        h: 40,
        windows: true,
        colors: palette("#ffc233", "#c98a12", "#8f6209", "#ffd76a"),
      },
      {
        name: "worker",
        col: 7,
        row: 2,
        w: 2,
        d: 2,
        h: 26,
        colors: palette("#ff4d8f", "#c22766", "#8a1a48", "#ff7fb0"),
      },
      { name: "core", col: 3, row: 4, w: 2, d: 2, h: 14, colors: palette("#f6e7c1", "#cdb98e", "#9c8a63", "#fff6dc") },
      { name: "db", col: 6, row: 5, w: 1, d: 1, h: 10, colors: palette("#9dff5a", "#5fbf2a", "#3f8a1a", "#c4ff98") },
      {
        name: "postgres",
        col: 1,
        row: 6,
        w: 2,
        d: 2,
        h: 18,
        colors: palette("#7fa6ff", "#4d74d1", "#334f96", "#a8c2ff"),
      },
      { name: "redis", col: 5, row: 7, w: 1, d: 1, h: 18, colors: palette("#ff6b4a", "#c9401f", "#8f2a12", "#ff9c86") },
    ];
    const links = [
      ["web", "api"],
      ["api", "core"],
      ["worker", "core"],
      ["api", "db"],
      ["worker", "db"],
      ["db", "postgres"],
      ["api", "redis"],
      ["worker", "redis"],
    ];
    const scene = new window.Iso.CityScene(canvas, buildings, links);
    scene.draw();
    if (document.fonts && document.fonts.load) {
      document.fonts.load('8px "Press Start 2P"').then(scene.draw, scene.draw);
    }
  }

  function setupCountdown() {
    const node = document.getElementById("countdown");
    if (!node || REDUCED_MOTION) return;
    let value = 9;
    setInterval(() => {
      value = value === 0 ? 9 : value - 1;
      node.textContent = String(value);
    }, 1000);
  }

  function init() {
    window.Pixel.mount(document);
    buildStars();
    setupBoard();
    setupCity();
    setupCountdown();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
