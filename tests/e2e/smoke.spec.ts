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

test("the landing page links to the served OpenAPI contract", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.getByRole("link", { name: "openapi.yaml" }).getAttribute("href");
  expect(href).toBe("/openapi.yaml");

  const response = await request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/yaml");
  expect(await response.text()).toMatch(/^openapi: 3\./);
});

/**
 * Better Auth trusts only `baseURL` unless told otherwise, so a browser that
 * opened the dev server as `localhost` while BETTER_AUTH_URL says `127.0.0.1`
 * used to get 403 INVALID_ORIGIN on every sign-in — a correct password that
 * never leaves /login.
 */
test("the web sign-in accepts a loopback alias of the server's own origin", async ({
  request,
  baseURL,
}) => {
  const url = new URL(baseURL!);
  test.skip(
    !["localhost", "127.0.0.1", "[::1]"].includes(url.host.replace(/:\d+$/, "")),
    "only meaningful against a loopback server",
  );

  const handle = `origin${Math.random().toString(36).slice(2, 10)}`;
  const credentials = { email: `${handle}@example.test`, password: "correct-horse-battery" };
  // The same server, under the other name for this machine.
  const alias = `${url.protocol}//${url.hostname === "localhost" ? "127.0.0.1" : "localhost"}${
    url.port ? `:${url.port}` : ""
  }`;

  const signedUp = await request.post("/api/auth/sign-up/email", {
    headers: { origin: alias },
    data: { ...credentials, name: handle, handle },
  });
  expect(signedUp.status(), await signedUp.text()).toBe(200);

  const signedIn = await request.post("/api/auth/sign-in/email", {
    headers: { origin: alias },
    data: credentials,
  });
  expect(signedIn.status(), await signedIn.text()).toBe(200);
  expect(signedIn.headers()["set-cookie"]).toContain("better-auth.session_token=");
});
