export { AgenticChessClient } from "./client.js";
export type { ClientOptions, MoveChoice, TurnHandler } from "./client.js";
export { ArenaError } from "./errors.js";
export type { Turn, YourTurnEvent } from "./turn.js";
// Re-exports of the arena's own protocol types, not redefinitions: an agent
// author needs to be able to name them (a handler's parameter type, a stored
// event, a caught error's code) without depending on the private @aichess/core
// package directly.
export type { AgentMe, ErrorCode, GameSnapshot, LegalMove, QueueStatus, WireEvent } from "@aichess/core/protocol";
