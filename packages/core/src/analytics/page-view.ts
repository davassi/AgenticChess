import { createHash } from "node:crypto";

/*
 * The pure half of the visit counter: everything that turns a raw request into
 * the handful of fields worth keeping, with no database and no clock of its
 * own. Nothing here ever sees an address or a user agent twice — they go into
 * a hash and are gone.
 */

/** Long enough for every real route, short enough that a bot cannot bloat a row. */
const MAX_PATH_LENGTH = 128;

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Collapses a request path to the page it stands for. Without this the list of
 * most-read pages is a list of identifiers seen once each, which answers
 * nothing.
 */
export function normalizePath(raw: string): string {
  const withoutFragment = raw.split("#")[0] ?? "";
  const withoutQuery = withoutFragment.split("?")[0] ?? "";
  const segments = withoutQuery.split("/").filter((segment) => segment !== "");
  const named = segments.map((segment, index) => {
    if (UUID_SEGMENT.test(segment)) return ":id";
    // An agent is addressed by slug, so the segment is arbitrary text that the
    // uuid rule above cannot catch.
    if (index === 1 && segments[0] === "agents") return ":slug";
    return segment;
  });
  const path = `/${named.join("/")}`;
  return path.length > MAX_PATH_LENGTH ? path.slice(0, MAX_PATH_LENGTH) : path;
}

export interface VisitorHashInput {
  /** A server secret. Without it the hash of a known address is guessable. */
  salt: string;
  /** UTC calendar day, from `utcDay`. Its presence is what makes the id expire. */
  day: string;
  ip: string;
  userAgent: string;
}

/**
 * The only identifier the arena keeps for a visitor, and it dies at midnight.
 * The address and the user agent go in and never come out: they are not stored
 * anywhere else, so an exported database holds no personal data. Rotating on
 * the day is the line that keeps this a counter rather than a tracker — and the
 * reason no cookie banner is owed.
 */
export function visitorHash({ salt, day, ip, userAgent }: VisitorHashInput): string {
  // JSON encodes the boundaries between the fields, so no crafted user agent can
  // shift a character across a separator and land on someone else's identifier.
  const material = JSON.stringify([salt, day, ip, userAgent]);
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/** UTC everywhere: the rotation is one event worldwide, not one per timezone. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/*
 * Substrings that appear in the user agent of something that is not a person
 * reading a page. The list is deliberately short: it catches what actually
 * reaches a site like this one, and views are marked rather than dropped, so a
 * pattern added later can be applied to the rows already stored.
 */
const BOT_PATTERNS = [
  "bot",
  "crawler",
  "spider",
  "crawling",
  "headless",
  "curl/",
  "wget",
  "python-requests",
  "httpie",
  "go-http-client",
  "java/",
  "okhttp",
  "libwww",
  "facebookexternalhit",
  "preview",
  "monitor",
  "uptime",
  "pingdom",
  "lighthouse",
];

export function looksLikeBot(userAgent: string): boolean {
  // Every browser sends a user agent, so its absence is itself the signal.
  if (userAgent.trim() === "") return true;
  const lowered = userAgent.toLowerCase();
  return BOT_PATTERNS.some((pattern) => lowered.includes(pattern));
}

/**
 * The host a visitor arrived from, and nothing else. A full referrer can carry
 * a query string with a search someone typed; the host alone answers the only
 * question being asked, which is where the traffic comes from.
 */
export function referrerHost(referrer: string, ownHost: string): string | null {
  if (referrer.trim() === "") return null;
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    // A referrer is whatever the browser chose to send. Unparseable is not an
    // error worth raising, it is simply no referrer.
    return null;
  }
  const bare = (name: string): string => name.replace(/^www\./, "");
  const source = bare(host);
  return source === bare(ownHost.toLowerCase()) ? null : source;
}

/**
 * Which half of the domain a view came from. It is declared by the code that
 * sends it — the beacon script ships only with the static pages and the React
 * component only with the app — rather than deduced from the path: the routing
 * that decides this lives in the Caddyfile, and copying that table here would
 * mean keeping two of them in step (and would get `/docs`, a static page with
 * no .html suffix, wrong from the first day).
 */
export const VIEW_SURFACES = ["app", "site"] as const;

export type ViewSurface = (typeof VIEW_SURFACES)[number];
