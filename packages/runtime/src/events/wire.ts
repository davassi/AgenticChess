import { agentColor, legalMoves, sideToMove, type DomainEvent, type GameState } from "@aichess/core";
import type { AgentSummary, Color, GameSnapshot, WireEvent } from "@aichess/core/protocol";

export interface GameAgents {
  white: AgentSummary;
  black: AgentSummary;
}

export interface RatingChange {
  before: number;
  after: number;
}

export interface RatingChanges {
  white: RatingChange | null;
  black: RatingChange | null;
}

export const NO_RATING_CHANGES: RatingChanges = { white: null, black: null };

export interface Outgoing {
  toWhite: WireEvent[];
  toBlack: WireEvent[];
  toPublic: WireEvent[];
}

export interface WireExtras {
  pgn: string | null;
  ratings: RatingChanges;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : iso(ms);
}

function attemptsLeft(state: GameState): number {
  return Math.max(0, state.config.illegalAttemptsPerTurn - state.illegalAttemptsThisTurn);
}

export function toSnapshot(state: GameState, agents: GameAgents, viewerAgentId?: string): GameSnapshot {
  const base: GameSnapshot = {
    id: state.id,
    status: state.status,
    white: agents.white,
    black: agents.black,
    config: state.config,
    fen: state.fen,
    ply: state.ply,
    history: state.moves.map((m) => m.san),
    turn: sideToMove(state),
    moveDeadlineAt: isoOrNull(state.moveDeadlineAt),
    result: state.result,
    termination: state.termination,
    startedAt: isoOrNull(state.startedAt),
    finishedAt: isoOrNull(state.finishedAt),
  };
  if (viewerAgentId === undefined || state.status !== "active") return base;
  if (agentColor(state, viewerAgentId) !== sideToMove(state)) return base;
  return { ...base, legalMoves: legalMoves(state.fen), attemptsLeft: attemptsLeft(state) };
}

function opponentSummary(agents: GameAgents, color: Color): AgentSummary {
  return color === "white" ? agents.black : agents.white;
}

function buildYourTurn(state: GameState, ply: number, deadlineAt: number, attempts: number): WireEvent {
  const last = state.moves[state.moves.length - 1];
  return {
    type: "game.your_turn",
    gameId: state.id,
    ply,
    fen: state.fen,
    history: state.moves.map((m) => m.san),
    lastMove: last === undefined ? null : { san: last.san, uci: last.uci },
    legalMoves: legalMoves(state.fen),
    deadlineAt: iso(deadlineAt),
    attemptsLeft: attempts,
  };
}

function yourTurnEvent(state: GameState, event: Extract<DomainEvent, { type: "turn" }>): WireEvent {
  return buildYourTurn(state, event.ply, event.deadlineAt, event.attemptsLeft);
}

export function toYourTurn(state: GameState, color: Color): WireEvent | null {
  if (state.status !== "active" || state.moveDeadlineAt === null) return null;
  if (sideToMove(state) !== color) return null;
  return buildYourTurn(state, state.ply, state.moveDeadlineAt, attemptsLeft(state));
}

export function toWireEvents(
  state: GameState,
  agents: GameAgents,
  events: DomainEvent[],
  extras: WireExtras,
): Outgoing {
  const out: Outgoing = { toWhite: [], toBlack: [], toPublic: [] };
  const toAgent = (color: Color, event: WireEvent): void => {
    (color === "white" ? out.toWhite : out.toBlack).push(event);
  };

  for (const event of events) {
    switch (event.type) {
      case "started": {
        for (const color of ["white", "black"] as const) {
          toAgent(color, {
            type: "game.start",
            gameId: state.id,
            color,
            opponent: opponentSummary(agents, color),
            timePerMoveMs: state.config.timePerMoveMs,
            startedAt: iso(event.startedAt),
          });
        }
        break;
      }
      case "turn": {
        toAgent(event.color, yourTurnEvent(state, event));
        out.toPublic.push({
          type: "game.turn",
          gameId: state.id,
          color: event.color,
          ply: event.ply,
          deadlineAt: iso(event.deadlineAt),
        });
        break;
      }
      case "move": {
        const wire: WireEvent = {
          type: "game.move",
          gameId: state.id,
          ply: event.record.ply,
          color: event.record.color,
          san: event.record.san,
          uci: event.record.uci,
          fen: event.record.fenAfter,
          comment: event.record.comment,
          thinkTimeMs: event.record.thinkTimeMs,
        };
        out.toWhite.push(wire);
        out.toBlack.push(wire);
        out.toPublic.push(wire);
        break;
      }
      case "illegal_attempt": {
        out.toPublic.push({
          type: "game.illegal_attempt",
          gameId: state.id,
          color: event.color,
          ply: event.ply,
          submitted: event.submitted.slice(0, 64),
          reason: event.reason,
          attemptsLeft: event.attemptsLeft,
        });
        break;
      }
      case "ended": {
        const base = {
          type: "game.end" as const,
          gameId: state.id,
          result: event.result,
          termination: event.termination,
          pgn: extras.pgn ?? "",
        };
        out.toWhite.push({ ...base, rating: extras.ratings.white });
        out.toBlack.push({ ...base, rating: extras.ratings.black });
        out.toPublic.push({ ...base, rating: null });
        break;
      }
      default:
        break;
    }
  }
  return out;
}
