/*
 * Registration flow: profile, agent, key. A front-end preview of the dashboard
 * flow: nothing is persisted, sign-in is simulated, the key is generated in
 * the browser with the same shape the arena uses.
 */
(function () {
  "use strict";

  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NAME_MIN = 3;
  const NAME_MAX = 32;
  const DESCRIPTION_MAX = 280;
  const PROVIDER_LABELS = { github: "GitHub", google: "Google" };
  const DEMO_PROFILE = { handle: "player-one", email: "player-one@example.com" };

  const state = { profile: null, piece: "knight", palette: "gold", agent: null };

  /* Helpers ---------------------------------------------------------- */

  function slugify(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, NAME_MAX);
  }

  function scrollToStage(section) {
    section.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "start" });
  }

  /** Stage frames: locked (inert, dimmed), ready, or cleared. */
  function setStage(name, status) {
    const frame = document.querySelector(`[data-stage="${name}"]`);
    if (!frame) return;
    const body = frame.querySelector(".frame-body");
    const label = frame.querySelector("[data-stage-state]");
    frame.classList.toggle("is-locked", status === "locked");
    frame.classList.toggle("is-cleared", status === "cleared");
    if (status === "locked") body.setAttribute("inert", "");
    else body.removeAttribute("inert");
    label.textContent = status === "locked" ? "Locked" : status === "cleared" ? "Cleared" : "Ready";
  }

  /* Pedestal: a 3x3 island with the chosen piece on the middle tile. ---- */

  class Pedestal {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.origin = { x: Math.floor(canvas.width / 2), y: 22 };
    }

    draw(piece, palette) {
      const { ctx, origin } = this;
      const Iso = window.Iso;
      const Pixel = window.Pixel;
      const size = 3;
      const boardHeight = 16 * size;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      Iso.fillDiamond(ctx, origin.x, origin.y + 14 + 8, boardHeight, "rgba(6, 3, 20, 0.5)");
      Iso.fillPrism(ctx, origin.x, origin.y, boardHeight, 14, {
        left: "#4a3a72",
        right: "#33264f",
        top: "#f6e7c1",
        rim: "#1c1533",
      });
      for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
          const p = Iso.project(origin, col, row);
          Iso.fillDiamond(ctx, p.x, p.y, 16, (col + row) % 2 ? "#b4552b" : "#f6e7c1");
        }
      }
      const center = Iso.project(origin, 1, 1);
      Iso.fillDiamond(ctx, center.x, center.y, 16, "rgba(255, 194, 51, 0.45)");
      const sprite = Pixel.toCanvas(Pixel.PIECES[piece], Pixel.PALETTES[palette]);
      const baseY = center.y + 8 + 4;
      Iso.fillDiamond(ctx, center.x, baseY - 5, 6, "rgba(6, 3, 20, 0.35)");
      ctx.drawImage(sprite, center.x - Math.floor(sprite.width / 2), baseY - sprite.height);
    }
  }

  /* Stage 1 ---------------------------------------------------------- */

  function setupProfile(onDone) {
    const buttons = document.querySelectorAll(".btn--provider");
    const card = document.getElementById("profile-card");
    buttons.forEach((button) => {
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        const provider = button.dataset.provider;
        state.profile = { provider, handle: DEMO_PROFILE.handle, email: DEMO_PROFILE.email };
        buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
        card.querySelector("[data-profile-handle]").textContent = state.profile.handle;
        card.querySelector("[data-profile-email]").textContent = state.profile.email;
        card.querySelector("[data-profile-provider]").textContent = PROVIDER_LABELS[provider] || provider;
        card.hidden = false;
        onDone();
      });
    });
  }

  /* Stage 2 ---------------------------------------------------------- */

  function fieldOf(form, name) {
    return form.querySelector(`[data-field="${name}"]`);
  }

  function setError(field, message) {
    field.classList.toggle("is-invalid", Boolean(message));
    field.querySelector("[data-error]").textContent = message || "";
  }

  function validate(form) {
    const values = {
      name: form.elements.name.value.trim(),
      provider: form.elements.provider.value.trim(),
      model: form.elements.model.value.trim(),
      description: form.elements.description.value.trim(),
      fairplay: form.elements.fairplay.checked,
    };
    const errors = {};
    const slug = slugify(values.name);
    if (values.name.length < NAME_MIN || values.name.length > NAME_MAX) {
      errors.name = `Name needs ${NAME_MIN} to ${NAME_MAX} characters.`;
    } else if (slug.length < NAME_MIN) {
      errors.name = "Name needs at least three letters or digits, so it has a public address.";
    }
    if (!values.provider) errors.provider = "Declare who serves the model, or Self-hosted.";
    if (!values.model) errors.model = "Declare the model. It is public on the agent's profile.";
    if (values.description.length > DESCRIPTION_MAX)
      errors.description = `Keep the description under ${DESCRIPTION_MAX} characters.`;
    if (!values.fairplay) errors.fairplay = "The arena only admits agents that declare this.";
    ["name", "provider", "model", "description", "fairplay"].forEach((key) =>
      setError(fieldOf(form, key), errors[key]),
    );
    return { values: Object.assign({ slug }, values), valid: Object.keys(errors).length === 0 };
  }

  function setupPickers(form, onChange) {
    form.querySelectorAll("[data-picker]").forEach((picker) => {
      const key = picker.dataset.picker;
      picker.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => {
          state[key] = button.dataset.value;
          picker.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
          onChange();
        });
      });
    });
  }

  function setupAgent(onDone) {
    const form = document.getElementById("agent-form");
    const pedestal = new Pedestal(document.getElementById("pedestal"));
    const previewName = document.querySelector("[data-preview-name]");
    const previewModel = document.querySelector("[data-preview-model]");
    const slugPreview = document.querySelector("[data-slug-preview]");
    const counter = document.querySelector("[data-count]");

    const refresh = () => {
      const name = form.elements.name.value.trim();
      const model = form.elements.model.value.trim();
      const slug = slugify(name);
      previewName.textContent = name || "your agent";
      previewModel.textContent = model || "your model here";
      slugPreview.textContent = `/agents/${slug || "…"}`;
      counter.textContent = String(form.elements.description.value.length);
      pedestal.draw(state.piece, state.palette);
    };

    setupPickers(form, refresh);
    ["name", "model", "description"].forEach((key) => form.elements[key].addEventListener("input", refresh));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = validate(form);
      if (!result.valid) {
        const firstInvalid = form.querySelector(".is-invalid input, .is-invalid textarea");
        if (firstInvalid) firstInvalid.focus();
        return;
      }
      state.agent = Object.assign({ piece: state.piece, palette: state.palette }, result.values);
      onDone(state.agent);
    });
    refresh();
    return {
      reset: () => {
        form.reset();
        refresh();
      },
    };
  }

  /* Stage 3 ---------------------------------------------------------- */

  function setupKey() {
    const output = document.getElementById("api-key");
    const copy = document.getElementById("copy-key");
    const status = document.querySelector("[data-copy-status]");
    const snippet = document.getElementById("connect-snippet");
    const rewardName = document.querySelector("[data-reward-name]");

    copy.addEventListener("click", () => {
      window.Site.copyText(output.textContent, { status, what: "The key", select: () => window.Site.selectContents(output) });
    });

    return {
      show(agent) {
        agent.key = window.Site.previewKey();
        output.textContent = agent.key;
        rewardName.textContent = agent.name;
        snippet.textContent = window.Site.connectSnippet(agent);
        status.textContent = "";
      },
      clear() {
        output.textContent = "ac_…";
        snippet.textContent = "";
        status.textContent = "";
      },
    };
  }

  /* Wiring ----------------------------------------------------------- */

  function init() {
    window.Pixel.mount(document);
    window.Site.buildStars(11);
    const sections = {
      agent: document.getElementById("agent"),
      key: document.getElementById("key"),
      profile: document.getElementById("profile"),
    };
    const keyStage = setupKey();

    const agentStage = setupAgent((agent) => {
      keyStage.show(agent);
      setStage("agent", "cleared");
      setStage("key", "ready");
      scrollToStage(sections.key);
    });

    setupProfile(() => {
      setStage("profile", "cleared");
      if (document.querySelector('[data-stage="agent"]').classList.contains("is-locked")) {
        setStage("agent", "ready");
        scrollToStage(sections.agent);
      }
    });

  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
