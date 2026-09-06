import type { PageViewConfig, PageViewRequest } from "@aichess/db";
import { clientIp, originAllowed, parseTrackBody, trackingRefused, type RateLimiter } from "./analytics";

export interface TrackDeps {
  record: (request: PageViewRequest, config: PageViewConfig) => Promise<void>;
  /** Runs the work once the response has gone out. In the route this is Next's `after`. */
  schedule: (work: () => void) => void;
  /** Null switches recording off; the endpoint still answers normally. */
  salt: string | null;
  limiter: RateLimiter;
  now: () => Date;
  onError?: (error: unknown) => void;
}

const noContent = (): Response => new Response(null, { status: 204 });

/**
 * The single door every page view comes through, from both halves of the
 * domain. It answers before it writes, and it answers the same way whether it
 * wrote or not: a visitor who refused tracking, and one whose view was stored,
 * cannot tell each other's response apart.
 */
export async function handleTrack(request: Request, deps: TrackDeps): Promise<Response> {
  if (trackingRefused(request.headers)) return noContent();
  // Checked before anything is spent on the request: a page on another site
  // must not be able to consume a real visitor's rate limit budget either.
  if (!originAllowed(request.headers)) return new Response(null, { status: 403 });
  if (deps.salt === null) return noContent();

  const ip = clientIp(request.headers);
  if (!deps.limiter.allow(ip, deps.now().getTime())) {
    return new Response(null, { status: 429 });
  }

  const body = parseTrackBody(await request.text());
  if (body === null) {
    return new Response(null, { status: 400 });
  }

  const view: PageViewRequest = {
    path: body.path,
    surface: body.surface,
    referrer: body.referrer,
    ip,
    userAgent: request.headers.get("user-agent") ?? "",
  };
  const config: PageViewConfig = {
    salt: deps.salt,
    // The host is on the request, so nothing has to be told which domain it is
    // serving in order to recognise its own pages in a referrer.
    ownHost: request.headers.get("host") ?? "",
    now: deps.now(),
  };

  deps.schedule(() => {
    // Deliberately swallowed. Propagating here would turn a hiccup in the visit
    // counter into a failure a reader can see, and the counter is not worth
    // that; the error is reported instead.
    void deps.record(view, config).catch((error: unknown) => deps.onError?.(error));
  });

  return noContent();
}
