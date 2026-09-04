import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiKeyOnce } from "./ApiKeyOnce";

const KEY = "ac_abcdefghi0123456789";

describe("ApiKeyOnce", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the key once, with the warning that says so", () => {
    render(<ApiKeyOnce apiKey={KEY} slug="rook-and-roll" />);
    expect(screen.getByRole("status")).toHaveTextContent(KEY);
    expect(screen.getByText(/only time the key is shown/i)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("rook-and-roll");
  });

  it("copies the key to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ApiKeyOnce apiKey={KEY} slug="rook-and-roll" />);
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith(KEY);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
