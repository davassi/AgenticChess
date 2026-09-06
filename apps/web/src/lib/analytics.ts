import { VIEW_SURFACES, type ViewSurface } from "@aichess/core";
import { z } from "zod";

/**
 * The address the reverse proxy saw. Caddy *appends* to X-Forwarded-For rather
 * than replacing it, so a visitor who sends the header themselves prepends a
 * value of their choosing — reading the first entry would let anyone mint a new
 * visitor per request. The last hop is the one Caddy observed, and the only one
 * worth hashing.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter((hop) => hop !== "");
    const last = hops.at(-1);
    if (last !== undefined) return last;
  }
  return headers.get("x-real-ip")?.trim() ?? "";
}

/** Both signals mean the same thing, and both are free to honour. */
export function trackingRefused(headers: Headers): boolean {
  return headers.get("dnt") === "1" || headers.get("sec-gpc") === "1";
}

const TrackBodySchema = z.object({
  // The leading slash is what keeps a full URL — and with it another site's
  // pages — out of the table.
  path: z.string().min(1).max(512).startsWith("/"),
  surface: z.enum(VIEW_SURFACES),
  referrer: z.string().max(2_048).default(""),
});

export interface TrackBody {
  path: string;
  surface: ViewSurface;
  referrer: string;
}

/** The beacon may send text/plain, so the body is parsed here rather than by `request.json()`. */
export function parseTrackBody(raw: string): TrackBody | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = TrackBodySchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

const MAX_DAYS = 365;

/** Null means the caller asked for something this endpoint will not do. */
export function parseDays(raw: string | null): number | null {
  if (raw === null) return 30;
  if (!/^\d+$/.test(raw)) return null;
  const days = Number(raw);
  return days >= 1 && days <= MAX_DAYS ? days : null;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  /** A cap on how many callers are remembered at once: the map must not become
   * a way to exhaust the server's memory by rotating addresses. */
  maxKeys: number;
}

export interface RateLimiter {
  allow: (key: string, now: number) => boolean;
  size: () => number;
}

/**
 * A ceiling on a public, unauthenticated endpoint, and no more than that: it
 * lives in one process's memory and resets when the server restarts. It stops
 * a loop from filling the table, not a determined attacker.
 */
export function createRateLimiter({ limit, windowMs, maxKeys }: RateLimiterOptions): RateLimiter {
  const windows = new Map<string, { started: number; count: number }>();

  return {
    allow(key, now) {
      const current = windows.get(key);
      if (current === undefined || now - current.started >= windowMs) {
        // Insertion order is age order, so the oldest entries are the ones the
        // map gives up first when it is full.
        if (windows.size >= maxKeys) {
          for (const [oldest, window] of windows) {
            if (now - window.started < windowMs && windows.size < maxKeys) break;
            windows.delete(oldest);
            if (windows.size < maxKeys) break;
          }
        }
        windows.set(key, { started: now, count: 1 });
        return true;
      }
      if (current.count >= limit) return false;
      current.count += 1;
      return true;
    },
    size() {
      return windows.size;
    },
  };
}

/**
 * Refuses a view sent from another site's page.
 *
 * The header is set by the browser and cannot be forged from JavaScript, so
 * this closes the one attack that scales: a third-party page posting views from
 * its own visitors' browsers, with real and varied addresses behind them.
 *
 * A request with no Origin is allowed through. Browsers send it on every POST,
 * so its absence means a non-browser caller — and one that could just as easily
 * have written the header itself, which makes refusing here worth nothing while
 * risking a counter that silently stops if a browser ever omits it. What stands
 * in a script's way is the rate limit, not this.
 */
export function originAllowed(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (origin === null) return true;

  const host = headers.get("host");
  if (host === null) return false;

  try {
    // Compared on host and port, not scheme: Caddy terminates TLS, so the app
    // sees plain http and a scheme check would reject every real request.
    return new URL(origin).host === host;
  } catch {
    // "null" — what a sandboxed iframe or an opaque origin sends — lands here,
    // along with anything else unparseable.
    return false;
  }
}
