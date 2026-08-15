import { expect, test } from "@playwright/test";

/**
 * Cloud validation for the Development Control Center.
 *
 * These assert the properties the mandate actually cares about — that progress
 * is real, that the page reflects live database state, and that the realtime
 * channel works — rather than that particular pixels exist.
 */

test.describe("health", () => {
  test("reports a reachable database", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status(), "health endpoint should be ok").toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.config.present).toBe(true);
    expect(body.config.parses).toBe(true);
    expect(body.database.reachable).toBe(true);

    // The credential must never appear in a diagnostic response.
    const text = JSON.stringify(body);
    expect(text).not.toContain("postgresql://");
    expect(text).not.toMatch(/:[^:@/]+@/);
  });
});

test.describe("snapshot API", () => {
  test("serves a roadmap computed from real rows", async ({ request }) => {
    const response = await request.get("/api/snapshot");
    expect(response.status()).toBe(200);

    const snapshot = await response.json();

    expect(snapshot.project.name).toBe("SLATE");
    expect(snapshot.tree.length).toBeGreaterThan(0);
    expect(snapshot.totals.items).toBeGreaterThan(50);

    // Progress must be a real fraction, and must not be complete while work
    // remains — the specific dishonesty mandate §57 forbids.
    expect(snapshot.overall).toBeGreaterThan(0);
    expect(snapshot.overall).toBeLessThan(1);
    expect(snapshot.totals.completedLeaves).toBeLessThan(snapshot.totals.leaves);
  });

  test("parent progress never exceeds a fully complete subtree", async ({ request }) => {
    const snapshot = await (await request.get("/api/snapshot")).json();

    const check = (node: {
      progress: number;
      status: string;
      children: Array<{ progress: number; status: string; children: unknown[] }>;
    }) => {
      if (node.children.length > 0) {
        const allComplete = node.children.every(
          (child) => child.status === "COMPLETED",
        );
        if (!allComplete) {
          expect(node.progress, "incomplete subtree must not read as complete").toBeLessThan(1);
        }
      }
      for (const child of node.children) check(child as never);
    };

    for (const phase of snapshot.tree) check(phase);
  });
});

test.describe("dashboard", () => {
  test("renders the roadmap with a computed headline figure", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Development Control Center")).toBeVisible();

    const headline = page.locator(".headline__value");
    await expect(headline).toBeVisible();
    await expect(headline).toHaveText(/^\d+(\.\d+)?%$/);

    // Phases from the seeded roadmap must be present.
    await expect(page.getByText("Foundation & Project Intelligence")).toBeVisible();
    await expect(page.getByText("Core Platform")).toBeVisible();
  });

  test("drills down into a milestone", async ({ page }) => {
    await page.goto("/");

    const phase = page.getByRole("button", { name: /Foundation & Project Intelligence/ });
    await expect(phase).toBeVisible();

    // Phases start expanded, so a milestone beneath it should already show.
    await expect(
      page.getByRole("button", { name: /Development Control Center/ }).first(),
    ).toBeVisible();
  });

  test("shows operator actions with remediation detail", async ({ page }) => {
    await page.goto("/");

    const action = page.getByRole("button", { name: /ACTION-001/ });
    await expect(action).toBeVisible();

    await action.click();
    await expect(page.getByText(/gh auth refresh/)).toBeVisible();
  });

  test("reaches a live connection state", async ({ page }) => {
    await page.goto("/");

    // The stream should establish and the indicator settle on Live.
    await expect(page.locator(".link-state")).toHaveAttribute("data-state", "live", {
      timeout: 20_000,
    });
  });

  test("has no horizontal overflow on mobile", async ({ page }) => {
    await page.goto("/");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow, "page must not scroll horizontally").toBe(false);
  });
});

test.describe("realtime", () => {
  test("stream emits a snapshot event", async ({ page }) => {
    await page.goto("/");

    const received = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const source = new EventSource("/api/stream");
          const timer = setTimeout(() => {
            source.close();
            resolve(false);
          }, 20_000);

          source.addEventListener("snapshot", () => {
            clearTimeout(timer);
            source.close();
            resolve(true);
          });
        }),
    );

    expect(received, "SSE stream should deliver a snapshot").toBe(true);
  });
});
