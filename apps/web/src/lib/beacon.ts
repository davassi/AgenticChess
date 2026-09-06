import type { ViewSurface } from "@aichess/core";

/** Same origin, so Caddy hands it to the app and no preflight is involved. */
const ENDPOINT = "/api/track";

interface PrivacySignals {
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}

/**
 * Sends one page view and never gets in the way. The server honours the same
 * two signals, but a refusal is worth respecting before the request leaves the
 * browser rather than after it arrives.
 */
export function sendPageView(path: string, surface: ViewSurface): void {
  const signals = navigator as Navigator & PrivacySignals;
  if (signals.doNotTrack === "1" || signals.globalPrivacyControl === true) return;

  const body = JSON.stringify({ path, surface, referrer: document.referrer });
  try {
    // sendBeacon survives the page being closed, which a fetch from an unload
    // handler does not. A string body goes out as text/plain; the endpoint
    // parses the text itself for exactly that reason.
    navigator.sendBeacon?.(ENDPOINT, body);
  } catch {
    // A blocked or failed beacon is not the visitor's problem. There is nothing
    // to retry and nothing to report: the view is simply not counted.
  }
}
