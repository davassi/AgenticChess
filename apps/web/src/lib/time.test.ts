import { describe, expect, it } from "vitest";
import { formatDuration, formatSeconds, timeAgo } from "./time";

const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);

describe("time helpers", () => {
  it("describes how long ago something happened", () => {
    expect(timeAgo(new Date(NOW - 5_000).toISOString(), NOW)).toBe("just now");
    expect(timeAgo(new Date(NOW - 4 * 60_000).toISOString(), NOW)).toBe("4 min ago");
    expect(timeAgo(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe("3 h ago");
    expect(timeAgo(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe("2 d ago");
  });

  it("never goes backwards or blows up on nonsense", () => {
    expect(timeAgo(new Date(NOW + 60_000).toISOString(), NOW)).toBe("just now");
    expect(timeAgo("not a date", NOW)).toBe("");
  });

  it("formats a clock with one decimal and never below zero", () => {
    expect(formatSeconds(60_000)).toBe("60.0");
    expect(formatSeconds(1_500)).toBe("1.5");
    expect(formatSeconds(-10)).toBe("0.0");
    expect(formatDuration(8_100)).toBe("8.1 s");
  });
});
