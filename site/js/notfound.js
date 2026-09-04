/* 404: the continue counter loops; nothing redirects on its own. */
(function () {
  "use strict";

  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    window.Site.buildStars(97);
    setupCountdown();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
