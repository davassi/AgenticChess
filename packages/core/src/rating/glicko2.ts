import type { Color, GameResult } from "../protocol/enums.js";

export interface Glicko2Rating {
  rating: number;
  rd: number;
  volatility: number;
}

export type Score = 0 | 0.5 | 1;

export interface GameOutcome {
  opponent: Glicko2Rating;
  score: Score;
}

export const GLICKO2_DEFAULTS = {
  rating: 1500,
  rd: 350,
  volatility: 0.06,
  tau: 0.5,
} as const;

export const PROVISIONAL_RD_THRESHOLD = 110;

const SCALE = 173.7178;
const BASE_RATING = 1500;
const CONVERGENCE = 0.000001;

export function initialRating(): Glicko2Rating {
  return { rating: GLICKO2_DEFAULTS.rating, rd: GLICKO2_DEFAULTS.rd, volatility: GLICKO2_DEFAULTS.volatility };
}

export function isProvisional(r: Pick<Glicko2Rating, "rd">): boolean {
  return r.rd > PROVISIONAL_RD_THRESHOLD;
}

export function scoreFor(result: GameResult, color: Color): Score | null {
  if (result === "*") return null;
  if (result === "1/2-1/2") return 0.5;
  const whiteWon = result === "1-0";
  return whiteWon === (color === "white") ? 1 : 0;
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expectedScore(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

export function updateRating(
  player: Glicko2Rating,
  outcomes: GameOutcome[],
  tau: number = GLICKO2_DEFAULTS.tau,
): Glicko2Rating {
  const mu = (player.rating - BASE_RATING) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.volatility;

  if (outcomes.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: phiStar * SCALE, volatility: sigma };
  }

  let vInverse = 0;
  let deltaSum = 0;
  for (const outcome of outcomes) {
    const muJ = (outcome.opponent.rating - BASE_RATING) / SCALE;
    const phiJ = outcome.opponent.rd / SCALE;
    const gJ = g(phiJ);
    const e = expectedScore(mu, muJ, phiJ);
    vInverse += gJ * gJ * e * (1 - e);
    deltaSum += gJ * (outcome.score - e);
  }
  const v = 1 / vInverse;
  const delta = v * deltaSum;

  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * (phi * phi + v + ex) * (phi * phi + v + ex);
    return num / den - (x - a) / (tau * tau);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > CONVERGENCE) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }

  const sigmaPrime = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaSum;

  return { rating: muPrime * SCALE + BASE_RATING, rd: phiPrime * SCALE, volatility: sigmaPrime };
}

export function applyGameRatings(
  white: Glicko2Rating,
  black: Glicko2Rating,
  result: GameResult,
): { white: Glicko2Rating; black: Glicko2Rating } | null {
  const whiteScore = scoreFor(result, "white");
  const blackScore = scoreFor(result, "black");
  if (whiteScore === null || blackScore === null) return null;
  return {
    white: updateRating(white, [{ opponent: black, score: whiteScore }]),
    black: updateRating(black, [{ opponent: white, score: blackScore }]),
  };
}
