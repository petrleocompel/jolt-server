import { expect, test } from "@playwright/test";

test("healthz reports the database is up", async ({ request }) => {
  const response = await request.get("/healthz");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok", db: "up" });
});

test("landing page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Jolt Server" })).toBeVisible();
});
