import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TopBar } from "./TopBar";

const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

describe("TopBar", () => {
  it("marks the section the visitor is in", () => {
    pathname.value = "/games/abc";
    render(<TopBar />);
    expect(screen.getByRole("link", { name: "Games" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Arena" })).not.toHaveAttribute("aria-current");
  });

  it("links every section and the repository", () => {
    pathname.value = "/";
    render(<TopBar />);
    expect(screen.getByRole("link", { name: "Leaderboard" })).toHaveAttribute("href", "/leaderboard");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/davassi/AgenticChess",
    );
  });
});
