import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPageView } from "./beacon";

interface Sent {
  url: string;
  body: string;
}

const withNavigator = (over: Record<string, unknown>, referrer = ""): Sent[] => {
  const sent: Sent[] = [];
  vi.stubGlobal("navigator", {
    sendBeacon: (url: string, body: string) => {
      sent.push({ url, body });
      return true;
    },
    ...over,
  });
  vi.stubGlobal("document", { referrer });
  return sent;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendPageView", () => {
  it("posts the page to the arena's own endpoint", () => {
    const sent = withNavigator({});

    sendPageView("/arena", "app");

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("/api/track");
    expect(JSON.parse(sent[0]?.body ?? "")).toEqual({ path: "/arena", surface: "app", referrer: "" });
  });

  it("passes the referrer the browser recorded", () => {
    const sent = withNavigator({}, "https://news.ycombinator.com/");

    sendPageView("/docs.html", "site");

    expect(JSON.parse(sent[0]?.body ?? "").referrer).toBe("https://news.ycombinator.com/");
  });

  it("says which surface it came from", () => {
    const sent = withNavigator({});

    sendPageView("/docs.html", "site");

    expect(JSON.parse(sent[0]?.body ?? "").surface).toBe("site");
  });

  it("stays silent when the browser asks not to be tracked", () => {
    const sent = withNavigator({ doNotTrack: "1" });

    sendPageView("/arena", "app");

    expect(sent).toHaveLength(0);
  });

  it("stays silent under Global Privacy Control", () => {
    const sent = withNavigator({ globalPrivacyControl: true });

    sendPageView("/arena", "app");

    expect(sent).toHaveLength(0);
  });

  it("does not throw when the browser has no sendBeacon", () => {
    withNavigator({ sendBeacon: undefined });

    expect(() => sendPageView("/arena", "app")).not.toThrow();
  });

  it("does not throw when sendBeacon itself fails", () => {
    vi.stubGlobal("navigator", {
      sendBeacon: () => {
        throw new Error("blocked");
      },
    });
    vi.stubGlobal("document", { referrer: "" });

    expect(() => sendPageView("/arena", "app")).not.toThrow();
  });
});
