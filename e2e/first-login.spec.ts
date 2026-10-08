import { expect, test } from "@playwright/test";
import { BASE_URL, PEOPLE } from "./fixtures.ts";

/** A new person signs in with the temporary password the administrator gave them. */
test("first sign-in with a temporary password: choose your own, then land on Track", async ({ page }) => {
  const h = { "content-type": "application/json", "x-stint-request": "1" };
  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ email: PEOPLE.admin.email, password: PEOPLE.admin.password }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const made = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: { ...h, cookie },
    body: JSON.stringify({
      name: "Naledi Newcomer",
      email: "naledi@karoo.test",
      role: "member",
      password: "temporary pass 123",
    }),
  });
  expect(made.status).toBe(201);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email").fill("naledi@karoo.test");
  await page.getByLabel("Password").fill("temporary pass 123");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Not a blank screen: the "choose your own password" page.
  await expect(page.getByRole("heading", { name: "Welcome, Naledi" })).toBeVisible();
  await page.getByLabel("Temporary password").fill("temporary pass 123");
  await page.getByLabel("New password", { exact: true }).fill("my own password 456");
  await page.getByLabel("Confirm new password").fill("my own password 456");
  await page.getByRole("button", { name: "Change password" }).click();

  await expect(page.getByRole("heading", { name: "Track" })).toBeVisible();
  expect(errors).toEqual([]);
});
