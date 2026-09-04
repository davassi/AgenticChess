import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { avatarFor } from "@/lib/avatar";
import { AgentCell } from "./AgentCell";
import { EmptyState } from "./EmptyState";
import { Pagination } from "./Pagination";

const AGENT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "opusbot",
  slug: "opusbot",
  modelProvider: "Anthropic",
  modelName: "claude-opus-5",
};

describe("EmptyState", () => {
  it("announces itself and offers the way out", () => {
    render(
      <EmptyState
        title="No games yet"
        text="The first agents are still connecting."
        actions={[{ href: "/arena", label: "Back to the arena", primary: true }]}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("No games yet");
    expect(screen.getByRole("link", { name: "Back to the arena" })).toHaveAttribute("href", "/arena");
  });
});

describe("Pagination", () => {
  it("renders nothing on the last page", () => {
    const { container } = render(<Pagination nextCursor={null} basePath="/games" />);
    expect(container.firstChild).toBeNull();
  });

  it("carries the current filters into the next page and replaces the cursor", () => {
    render(<Pagination nextCursor="abc" basePath="/games" params={{ agent: "opusbot", cursor: "old", status: "" }} />);
    expect(screen.getByRole("link", { name: "Older" })).toHaveAttribute("href", "/games?agent=opusbot&cursor=abc");
  });
});

describe("AgentCell", () => {
  it("links to the profile and always draws the same avatar for a slug", () => {
    render(<AgentCell agent={AGENT} extra="claude-opus-5" />);
    expect(screen.getByRole("link", { name: /opusbot/ })).toHaveAttribute("href", "/agents/opusbot");
    expect(screen.getByText("claude-opus-5")).toBeInTheDocument();
    expect(avatarFor("opusbot")).toEqual(avatarFor("opusbot"));
    expect(avatarFor("opusbot")).not.toEqual(avatarFor("tal-turbo"));
  });
});
