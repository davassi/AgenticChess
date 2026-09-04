import type { GameSnapshot, WireEvent } from "@aichess/core/protocol";

export class LiveBuffer {
  private readonly pending: WireEvent[] = [];
  private live: ((event: WireEvent) => void) | null = null;

  readonly handler = (event: WireEvent): void => {
    if (this.live !== null) this.live(event);
    else this.pending.push(event);
  };

  takeOver(live: (event: WireEvent) => void, keep: (event: WireEvent) => boolean): void {
    const buffered = this.pending.splice(0);
    this.live = live;
    for (const event of buffered) {
      if (keep(event)) live(event);
    }
  }
}

export function keepAfterSnapshot(event: WireEvent, snapshotPly: number): boolean {
  switch (event.type) {
    case "ping":
    case "hello":
    case "game.snapshot":
      return false;
    case "game.end":
      return true;
    case "game.move":
    case "game.turn":
    case "game.your_turn":
      return event.ply > snapshotPly;
    case "game.illegal_attempt":
      return event.ply >= snapshotPly;
    default:
      return true;
  }
}

export function keepAfterHello(event: WireEvent, activeGame: GameSnapshot | null): boolean {
  if (event.type === "ping" || event.type === "hello") return false;
  if (activeGame === null) return true;
  if (event.type === "game.start" && event.gameId === activeGame.id) return false;
  if ("gameId" in event && event.gameId === activeGame.id) return keepAfterSnapshot(event, activeGame.ply);
  return true;
}
