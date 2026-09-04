import { describe, expect, it } from "vitest";
import { ArenaError } from "./errors.js";

describe("ArenaError", () => {
  it("carries the code, the status, the message and the details of an arena error body", () => {
    const error = ArenaError.fromBody(422, {
      error: "illegal_move",
      message: "Not a legal move",
      details: { reason: "not_legal", attemptsLeft: 2, legalMoves: [{ san: "e4", uci: "e2e4" }] },
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ArenaError");
    expect(error.code).toBe("illegal_move");
    expect(error.status).toBe(422);
    expect(error.message).toBe("Not a legal move");
    expect(error.details?.["attemptsLeft"]).toBe(2);
  });

  it("survives a body that is not an arena error at all, because a proxy can answer instead", () => {
    const error = ArenaError.fromBody(502, "<html>Bad Gateway</html>");

    expect(error.code).toBe("internal_error");
    expect(error.status).toBe(502);
    expect(error.message).toContain("502");
    expect(error.details).toBeUndefined();
  });

  it("keeps the status when the body is an object without the arena's fields", () => {
    const error = ArenaError.fromBody(500, { oops: true });

    expect(error.code).toBe("internal_error");
    expect(error.message).toContain("500");
  });
});
