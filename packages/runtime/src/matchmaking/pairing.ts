import { opponentOf } from "@aichess/core";
import type { Color } from "@aichess/core/protocol";

export interface PairingWindow {
  initial: number;
  growth: number;
  stepMs: number;
  max: number;
}

export const DEFAULT_PAIRING_WINDOW: PairingWindow = { initial: 150, growth: 100, stepMs: 10_000, max: 1_000 };

/**
 * The half of a candidate that decides whether two agents may meet at all.
 * Named apart from `Candidate` so a caller holding nothing but a queue row and
 * an owner can ask the question without inventing a rating or a last colour.
 */
export interface Pairable {
  agentId: string;
  ownerId: string;
  isHouse?: boolean;
}

export interface Candidate extends Pairable {
  rating: number;
  queuedAt: number;
  lastColor: Color | null;
}

export interface Pair {
  white: Candidate;
  black: Candidate;
}

export function windowFor(waitMs: number, window: PairingWindow = DEFAULT_PAIRING_WINDOW): number {
  const steps = Math.floor(Math.max(0, waitMs) / window.stepMs);
  return Math.min(window.max, window.initial + window.growth * steps);
}

function preferredColor(candidate: Candidate): Color | null {
  return candidate.lastColor === null ? null : opponentOf(candidate.lastColor);
}

export function chooseColors(seeker: Candidate, other: Candidate): Pair {
  const seekerWants = preferredColor(seeker);
  const otherWants = preferredColor(other);
  let seekerColor: Color;
  if (seekerWants !== null) seekerColor = seekerWants;
  else if (otherWants !== null) seekerColor = opponentOf(otherWants);
  else seekerColor = "white";
  return seekerColor === "white" ? { white: seeker, black: other } : { white: other, black: seeker };
}

function byWait(a: Candidate, b: Candidate): number {
  return a.queuedAt - b.queuedAt || a.agentId.localeCompare(b.agentId);
}

export interface PairingOptions {
  window?: PairingWindow;
  /**
   * Off by default. A rating built out of an owner playing themselves is not a
   * rating - but in the unrated queue there is no rating to protect, and
   * putting two of your own agents against each other is the point.
   */
  allowSameOwner?: boolean;
}

/**
 * Whether these two are allowed in a game together, leaving the rating window
 * out of it. Everything here is permanent for as long as both sit in the queue,
 * while a window only widens with waiting - which is why this is the half worth
 * reporting to an agent that wants to know whether waiting can work at all.
 */
function mayFace(seeker: Pairable, other: Pairable, allowSameOwner: boolean): boolean {
  if (other.agentId === seeker.agentId) return false;
  if (!allowSameOwner && other.ownerId === seeker.ownerId) return false;
  // Two house agents share an owner, so relaxing the owner rule for practice
  // games would let them pair with each other and play the arena's only model
  // slot between themselves while a newcomer waits behind them.
  if (seeker.isHouse === true && other.isHouse === true) return false;
  return true;
}

/**
 * How many agents waiting in the same queue this one is allowed to face.
 *
 * Zero is not "nobody yet": it is "nobody here can ever be your opponent", and
 * it is the difference an agent cannot otherwise see. A queue it can never be
 * paired out of looks exactly like a quiet one - `queue.joined` arrives, and
 * then nothing, for ever, with both sides behaving correctly.
 */
export function countPairableOpponents(
  candidates: readonly Pairable[],
  seekerId: string,
  allowSameOwner = false,
): number {
  const seeker = candidates.find((candidate) => candidate.agentId === seekerId);
  if (seeker === undefined) return 0;
  return candidates.filter((other) => mayFace(seeker, other, allowSameOwner)).length;
}

export function pairCandidates(candidates: Candidate[], now: number, options: PairingOptions = {}): Pair[] {
  const window = options.window ?? DEFAULT_PAIRING_WINDOW;
  const allowSameOwner = options.allowSameOwner ?? false;
  const sorted = [...candidates].sort(byWait);
  const taken = new Set<string>();
  const pairs: Pair[] = [];
  for (const seeker of sorted) {
    if (taken.has(seeker.agentId)) continue;
    const width = windowFor(now - seeker.queuedAt, window);
    let best: { candidate: Candidate; distance: number } | null = null;
    for (const other of sorted) {
      if (taken.has(other.agentId)) continue;
      if (!mayFace(seeker, other, allowSameOwner)) continue;
      const distance = Math.abs(seeker.rating - other.rating);
      if (distance > width) continue;
      if (best === null || distance < best.distance) {
        best = { candidate: other, distance };
      }
    }
    if (best === null) continue;
    taken.add(seeker.agentId);
    taken.add(best.candidate.agentId);
    pairs.push(chooseColors(seeker, best.candidate));
  }
  return pairs;
}
