import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountNav } from "./AccountNav";

vi.mock("@/lib/auth", () => ({ signOut: vi.fn() }));

const STYLES = join(process.cwd(), "src", "styles");

/** Every class rule the app's stylesheets define, whichever file they live in. */
function definedClasses(): Set<string> {
  const css = readdirSync(STYLES)
    .filter((name) => name.endsWith(".css"))
    .map((name) => readFileSync(join(STYLES, name), "utf8"))
    .join("\n");
  return new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1] ?? ""));
}

function classesOn(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>("[class]")].flatMap((node) => [...node.classList]);
}

describe("AccountNav", () => {
  it("names the signed-in visitor and offers the way out", () => {
    const { getByText, getByRole } = render(
      <AccountNav account={{ name: "Ada Lovelace", email: "ada@example.com" }} />,
    );
    expect(getByText("Ada Lovelace")).toBeInTheDocument();
    expect(getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("falls back to the address when the account has no name", () => {
    const { getByText } = render(<AccountNav account={{ name: null, email: "ada@example.com" }} />);
    expect(getByText("ada@example.com")).toBeInTheDocument();
  });

  // A class written in the JSX and never written in the CSS is invisible to
  // every other test: the markup is right, the component renders, and the name
  // silently falls back to the body font beside a browser-default button. This
  // is the only test that can see it.
  it("styles every element it puts in the top bar", () => {
    const { container } = render(<AccountNav account={{ name: "Ada Lovelace", email: "ada@example.com" }} />);
    const defined = definedClasses();
    const unstyled = classesOn(container).filter((name) => !defined.has(name));
    expect(unstyled).toEqual([]);
  });
});
