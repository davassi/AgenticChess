import { createDb, pageViews } from "@aichess/db";
import { expect, test } from "@playwright/test";
import { like } from "drizzle-orm";
import { E2E_ANALYTICS_TOKEN } from "../playwright.config";

const WEB = `http://127.0.0.1:${process.env["E2E_WEB_PORT"] ?? 3100}`;
const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://aichess:aichess@localhost:5432/aichess";

/*
 * The unit tests cover the handlers with their dependencies handed to them.
 * What only a running server can show is the wiring: that Next's `after` really
 * runs the write, that the route reaches the database, and that the salt and
 * the token arrive from the environment.
 */
test("a beacon reaches the database and the statistics read it back", async ({ request }) => {
  const handle = createDb(DATABASE_URL);
  const path = `/e2e-probe-${Date.now().toString(36)}`;
  try {
    const posted = await request.post(`${WEB}/api/track`, {
      headers: { "content-type": "text/plain", "x-forwarded-for": "203.0.113.77" },
      data: JSON.stringify({ path, surface: "app", referrer: "https://news.ycombinator.com/" }),
    });
    expect(posted.status()).toBe(204);

    await expect
      .poll(
        async () =>
          (
            await handle.db
              .select()
              .from(pageViews)
              .where(like(pageViews.path, `${path}%`))
          ).length,
        {
          timeout: 10_000,
        },
      )
      .toBe(1);

    const read = await request.get(`${WEB}/api/insights?days=1`, {
      headers: { "x-analytics-token": E2E_ANALYTICS_TOKEN },
    });
    expect(read.status()).toBe(200);
    const stats = (await read.json()) as { topPaths: { path: string; views: number }[] };
    expect(stats.topPaths).toContainEqual({ path, views: 1 });
  } finally {
    await handle.db.delete(pageViews).where(like(pageViews.path, `${path}%`));
    await handle.close();
  }
});

test("a visitor who refuses tracking leaves nothing behind", async ({ request }) => {
  const handle = createDb(DATABASE_URL);
  const path = `/e2e-dnt-${Date.now().toString(36)}`;
  try {
    const posted = await request.post(`${WEB}/api/track`, {
      headers: { "content-type": "text/plain", dnt: "1" },
      data: JSON.stringify({ path, surface: "app" }),
    });
    expect(posted.status()).toBe(204);

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(
      await handle.db
        .select()
        .from(pageViews)
        .where(like(pageViews.path, `${path}%`)),
    ).toHaveLength(0);
  } finally {
    await handle.close();
  }
});

test("the statistics stay shut without the token", async ({ request }) => {
  expect((await request.get(`${WEB}/api/insights`)).status()).toBe(401);
});

test("a real page load in a real browser is counted", async ({ page }) => {
  const handle = createDb(DATABASE_URL);
  // An address nothing serves: the not-found page renders inside the root
  // layout, so the beacon fires, and the path is unique enough to clean up.
  const path = `/e2e-live-${Date.now().toString(36)}`;
  try {
    await page.goto(`${WEB}${path}`);

    await expect
      .poll(
        async () =>
          (
            await handle.db
              .select()
              .from(pageViews)
              .where(like(pageViews.path, `${path}%`))
          ).length,
        {
          timeout: 10_000,
        },
      )
      .toBe(1);

    const [row] = await handle.db
      .select()
      .from(pageViews)
      .where(like(pageViews.path, `${path}%`));
    expect(row?.surface).toBe("app");
    // Playwright drives a headless Chromium, whose user agent says so, and the
    // view is marked as a crawler. That is the filter working on the real path
    // rather than only in a unit test — a browser a person is holding is not
    // marked, which is what the looksLikeBot cases cover.
    expect(row?.isBot).toBe(true);
  } finally {
    await handle.db.delete(pageViews).where(like(pageViews.path, `${path}%`));
    await handle.close();
  }
});

test("a view posted from another site's page is refused", async ({ request }) => {
  const posted = await request.post(`${WEB}/api/track`, {
    headers: { "content-type": "text/plain", origin: "https://evil.test" },
    data: JSON.stringify({ path: "/arena", surface: "app" }),
  });

  expect(posted.status()).toBe(403);
});
