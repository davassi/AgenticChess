/*
 * How fast the viewer's cursor walks the move list.
 *
 * Every rule here is a pure function of how far behind the cursor is, so the
 * tests are tables of values and need no timers. The one piece that touches
 * React — a setTimeout — lives in usePlayback and does nothing but obey these
 * numbers.
 */

/** The delay at the live edge: slow enough to read a move and its comment. */
export const LIVE_BASE_MS = 2500;
/** However far behind, never faster than this; a blur is not a broadcast. */
export const LIVE_MIN_MS = 400;
/** One ply per second in a replay the viewer started. */
export const REVIEW_BASE_MS = 1000;
/** How sharply the delay shortens per ply of arrears. */
export const CATCH_UP = 0.5;
/** Past this many plies behind the cursor jumps rather than fast-forwards. */
export const MAX_LAG = 40;
/** Arrears worth telling the viewer about. */
export const LAG_VISIBLE = 2;

export const SPEEDS = [0.5, 1, 2, "instant"] as const;
export type Speed = (typeof SPEEDS)[number];

function isSpeed(value: unknown): value is Speed {
  return (SPEEDS as readonly unknown[]).includes(value);
}

/**
 * The delay before the cursor advances one ply while chasing the live edge.
 *
 * The further behind it falls the shorter the delay, which gives the lag a
 * fixed point rather than a threshold: at the agents' measured ~1500 ms per
 * move and speed 1 the cursor settles between two and three plies back and
 * stays there.
 */
export function liveInterval(lag: number, speed: Speed): number {
  if (speed === "instant") return 0;
  if (lag <= 0) return LIVE_BASE_MS;
  const factor = 1 + CATCH_UP * (lag - 1);
  return Math.max(LIVE_MIN_MS, Math.round(LIVE_BASE_MS / factor / speed));
}

/** The delay between two plies of a replay the viewer started. */
export function reviewInterval(speed: Speed): number {
  if (speed === "instant") return LIVE_MIN_MS;
  return Math.round(REVIEW_BASE_MS / speed);
}

/**
 * Where the cursor goes next. It walks, except for the two cases where
 * walking would waste the viewer's time: instant, and coming back to a tab
 * the browser throttled while it was hidden.
 */
export function nextPly(ply: number, total: number, following: boolean, speed: Speed): number {
  if (ply >= total) return total;
  if (following && (speed === "instant" || total - ply > MAX_LAG)) return total;
  return ply + 1;
}

/** Reads a speed back out of the select's option value. */
export function parseSpeed(value: string): Speed {
  if (value === "instant") return "instant";
  const numeric = Number(value);
  return isSpeed(numeric) ? numeric : 1;
}
