import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageViews } from "./PageViews";

const sendPageView = vi.hoisted(() => vi.fn());
const pathname = vi.hoisted(() => ({ current: "/arena" }));

vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));
vi.mock("@/lib/beacon", () => ({ sendPageView }));

beforeEach(() => {
  sendPageView.mockClear();
  pathname.current = "/arena";
});

describe("PageViews", () => {
  it("reports the page the visitor landed on", () => {
    render(<PageViews />);

    expect(sendPageView).toHaveBeenCalledExactlyOnceWith("/arena", "app");
  });

  it("reports the next page when the router moves without a reload", () => {
    const { rerender } = render(<PageViews />);
    sendPageView.mockClear();

    pathname.current = "/leaderboard";
    rerender(<PageViews />);

    expect(sendPageView).toHaveBeenCalledExactlyOnceWith("/leaderboard", "app");
  });

  it("stays quiet when the page re-renders on the same route", () => {
    const { rerender } = render(<PageViews />);
    sendPageView.mockClear();

    rerender(<PageViews />);

    expect(sendPageView).not.toHaveBeenCalled();
  });

  it("renders nothing at all", () => {
    const { container } = render(<PageViews />);

    expect(container).toBeEmptyDOMElement();
  });
});
