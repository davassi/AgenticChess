import { describe, expect, it } from "vitest";
import * as core from "./index.js";
import * as protocol from "./protocol/index.js";

describe("core public surface", () => {
  it("exposes the game engine", () => {
    expect(typeof core.createGame).toBe("function");
    expect(typeof core.startGame).toBe("function");
    expect(typeof core.applyMove).toBe("function");
    expect(typeof core.applyTimeout).toBe("function");
    expect(typeof core.applyResign).toBe("function");
    expect(typeof core.toPgn).toBe("function");
  });

  it("exposes rules, rating and auth helpers", () => {
    expect(typeof core.legalMoves).toBe("function");
    expect(typeof core.tryMove).toBe("function");
    expect(typeof core.updateRating).toBe("function");
    expect(typeof core.applyGameRatings).toBe("function");
    expect(typeof core.generateApiKey).toBe("function");
    expect(typeof core.hashApiKey).toBe("function");
  });

  it("re-exports the protocol", () => {
    expect(core.MoveRequestSchema).toBe(protocol.MoveRequestSchema);
    expect(core.WireEventSchema).toBe(protocol.WireEventSchema);
    expect(core.TERMINATIONS).toBe(protocol.TERMINATIONS);
  });

  it("keeps the protocol entry point free of Node-only modules", () => {
    expect("generateApiKey" in protocol).toBe(false);
  });
});
