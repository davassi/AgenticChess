export interface BackoffOptions {
  base: number;
  cap: number;
  random?: () => number;
}

/**
 * Equal jitter: half the exponential delay, plus a random share of the other half.
 *
 * The jitter is not decoration. One arena restart drops every agent's stream at
 * the same instant; without it they all come back at 1 s, then 2 s, then 4 s, in
 * one herd. Half the delay is kept so the curve still backs off.
 */
export function nextDelay(attempt: number, options: BackoffOptions): number {
  const random = options.random ?? Math.random;
  const full = Math.min(options.cap, options.base * 2 ** attempt);
  return Math.round(full / 2 + random() * (full / 2));
}
