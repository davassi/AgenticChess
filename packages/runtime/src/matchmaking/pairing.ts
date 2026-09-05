import { opponentOf } from "@aichess/core";
import type { Color } from "@aichess/core/protocol";

export interface PairingWindow {
  initial: number;
  growth: number;
  stepMs: number;
  max: number;
}

export const DEFAULT_PAIRING_WINDOW: PairingWindow = { initial: 150, growth: 100, stepMs: 10_000, max: 1_000 };

export interface Candidate {
  agentId: string;
  ownerId: string;
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
      if (other.agentId === seeker.agentId || taken.has(other.agentId)) continue;
      if (!allowSameOwner && other.ownerId === seeker.ownerId) continue;
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
