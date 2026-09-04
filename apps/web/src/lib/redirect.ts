/*
 * Where the visitor is sent after signing in.
 *
 * An open redirect would turn sign-in into a phishing tool, and checking the
 * first characters of the string is not enough: Next hands `searchParams` over
 * already decoded, so `?next=%2F%5Cevil.com` arrives as "/\evil.com", which a
 * browser resolves against the host as "//evil.com". Resolving the candidate
 * ourselves and comparing origins is the only check that sees every spelling.
 */

const BASE = "https://internal.invalid";

export const DEFAULT_NEXT = "/dashboard";

/** The candidate reduced to a path inside this site, or the dashboard. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/")) return DEFAULT_NEXT;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return DEFAULT_NEXT;
  }
  if (url.origin !== BASE) return DEFAULT_NEXT;
  return `${url.pathname}${url.search}${url.hash}`;
}
