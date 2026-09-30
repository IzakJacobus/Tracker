import { expect, test } from "@playwright/test";
import { login, PEOPLE } from "./fixtures.ts";

test("wrong password shows a clear message", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(PEOPLE.member.email);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That email and password do not match.")).toBeVisible();
});

test("a member signs in and sees the tracking screen, without admin menus", async ({ page }) => {
  await login(page, "member");
  await expect(page.getByRole("link", { name: "Track" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Clients" })).toHaveCount(0);
});

test("signing out returns to the sign-in screen", async ({ page }) => {
  await login(page, "admin");
  await page.getByRole("button", { name: /Thandi Mokoena/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
