import { expect, test } from "@playwright/test";

/**
 * Between the server's HTML arriving and React hydrating it, `onSubmit` is not
 * attached yet and the form is a plain HTML form. Submitting in that window
 * ran the browser's native submission — a GET to the current URL — so the page
 * reloaded, the sign-in never happened, and the password ended up in the query
 * string, the address bar, history and the access log. What the user saw was a
 * login page that kept throwing them back to the login page.
 */
test("submitting the login form before hydration cannot reload it with the password in the URL", async ({
  page,
}) => {
  // No wait: race hydration deliberately, the way a password manager that
  // fills and submits on load does.
  await page.goto("/login", { waitUntil: "commit" });

  await page.getByLabel("Email").fill("someone@example.test", { timeout: 15_000 });
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByLabel("Password").press("Enter");

  // Whatever happened, the credentials must never reach the URL.
  await page.waitForTimeout(1500);
  expect(page.url()).not.toContain("password=");
  expect(page.url()).not.toContain("email=");
});

test("the login button is inert until the page can actually handle a submit", async ({ page }) => {
  await page.goto("/login", { waitUntil: "commit" });
  const button = page.getByRole("button", { name: "Log in" });

  // It becomes usable on its own once hydration lands...
  await expect(button).toBeEnabled({ timeout: 15_000 });

  // ...and it works: a wrong password is reported as a wrong password, which
  // proves the React handler — not a native submission — ran.
  await page.getByLabel("Email").fill("nobody@example.test");
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await button.click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible({ timeout: 15_000 });
  expect(page.url()).toContain("/login");
  expect(page.url()).not.toContain("password=");
});

test("the signup form does not leak the password into the URL either", async ({ page }) => {
  await page.goto("/signup", { waitUntil: "commit" });

  await page.getByLabel("Display name").fill("Racer", { timeout: 15_000 });
  await page.getByLabel("Handle").fill("racer");
  await page.getByLabel("Email").fill("racer@example.test");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByLabel("Password").press("Enter");

  await page.waitForTimeout(1500);
  expect(page.url()).not.toContain("password=");
});
