import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPageView } from "./beacon";

/*
 * site/ is plain HTML with no build step, so the static pages cannot import the
 * beacon this app uses: the same few lines exist twice, once as a module and
 * once as a script tag. This test runs the vanilla copy and holds it to the
 * behaviour of the module, so the two cannot drift apart unnoticed.
 */
// Resolved from the package root: under jsdom, import.meta.url is an http URL.
const SOURCE = readFileSync(resolve(process.cwd(), "../../site/js/track.js"), "utf8");

interface Sent {
  url: string;
  body: string;
}

const run = (over: Record<string, unknown> = {}, pathname = "/docs.html", referrer = ""): Sent[] => {
  const sent: Sent[] = [];
  vi.stubGlobal("navigator", {
    sendBeacon: (url: string, body: string) => {
      sent.push({ url, body });
      return true;
    },
    ...over,
  });
  vi.stubGlobal("document", { referrer });
  vi.stubGlobal("location", { pathname });
  new Function(SOURCE)();
  return sent;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the static pages' beacon", () => {
  it("sends exactly what the app's beacon sends for the same page", () => {
    const fromSite = run({}, "/docs.html", "https://news.ycombinator.com/");

    const fromApp: Sent[] = [];
    vi.stubGlobal("navigator", {
      sendBeacon: (url: string, body: string) => {
        fromApp.push({ url, body });
        return true;
      },
    });
    vi.stubGlobal("document", { referrer: "https://news.ycombinator.com/" });
    sendPageView("/docs.html", "site");

    expect(fromSite).toEqual(fromApp);
  });

  it("reports the page the reader is on, as the static surface", () => {
    const sent = run({}, "/agent.html");

    expect(sent[0]?.url).toBe("/api/track");
    expect(JSON.parse(sent[0]?.body ?? "")).toEqual({ path: "/agent.html", surface: "site", referrer: "" });
  });

  it("stays silent when the browser asks not to be tracked", () => {
    expect(run({ doNotTrack: "1" })).toHaveLength(0);
  });

  it("stays silent under Global Privacy Control", () => {
    expect(run({ globalPrivacyControl: true })).toHaveLength(0);
  });

  it("does not throw when the browser has no sendBeacon", () => {
    expect(() => run({ sendBeacon: undefined })).not.toThrow();
  });
});
