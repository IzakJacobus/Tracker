import { expect, type Page } from "@playwright/test";

export const BASE_URL = "http://localhost:47651";
export const PEOPLE = {
  admin: { name: "Thandi Mokoena", email: "thandi@karoo.test", password: "correct horse battery" },
  manager: { name: "Pieter van Wyk", email: "pieter@karoo.test", password: "manager password 1" },
  member: { name: "Aisha Patel", email: "aisha@karoo.test", password: "member password 1" },
};

export async function login(page: Page, who: keyof typeof PEOPLE) {
  const p = PEOPLE[who];
  await page.goto("/");
  await page.getByLabel("Email").fill(p.email);
  await page.getByLabel("Password").fill(p.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Track" })).toBeVisible();
  await waitSynced(page);
}

export async function waitSynced(page: Page) {
  await expect(page.locator(".sidebar .sync-pill")).toHaveText(/Synced/, { timeout: 15_000 });
}
