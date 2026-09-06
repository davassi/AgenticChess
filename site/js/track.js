/*
 * One page view, sent to the arena's own endpoint. Same origin, so Caddy hands
 * it to the app: the static pages and the Next app are counted by the same
 * code on the server.
 *
 * The app has its own copy of these lines in apps/web/src/lib/beacon.ts,
 * because site/ has no build step and cannot import a module from there. A test
 * (apps/web/src/lib/site-beacon.test.ts) runs this file and holds it to that
 * one, so the two cannot quietly drift apart.
 */
(function () {
  "use strict";

  /* Honoured here as well as on the server: a refusal deserves to be respected
     before the request leaves the browser, not after it arrives. */
  if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true) return;

  var body = JSON.stringify({ path: location.pathname, surface: "site", referrer: document.referrer });
  try {
    /* sendBeacon survives the page being closed, which a fetch does not. */
    if (navigator.sendBeacon) navigator.sendBeacon("/api/track", body);
  } catch (error) {
    /* A blocked beacon is not the reader's problem: the view is not counted. */
  }
})();
