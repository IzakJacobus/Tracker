import { expect, test } from "@playwright/test";
import { login, waitSynced } from "./fixtures.ts";

test("start and stop a timer; the entry is saved and synced", async ({ page }) => {
  await login(page, "member");
  await page.getByLabel("Description").fill("Deck reinforcement check");
  await page.locator("#dock-project").click();
  await page.getByPlaceholder("Search projects and tasks").fill("detailed");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Start timer" }).click();
  await expect(page.getByRole("button", { name: "Stop timer" })).toBeVisible();
  await expect(page.locator(".entry-row[data-running]")).toContainText("Deck reinforcement check");
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Stop timer" }).click();
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();
  await expect(page.locator(".entry-row[data-running]")).toHaveCount(0);
  await expect(page.locator(".entry-row").first()).toContainText("Deck reinforcement check");
  await waitSynced(page);

  // the entry survives a reload (it came back from the server / local store)
  await page.reload();
  await expect(page.locator(".entry-row").first()).toContainText("Deck reinforcement check");
});

test("the S key toggles the timer", async ({ page }) => {
  await login(page, "member");
  await page.locator("#dock-project").click();
  await page.getByPlaceholder("Search projects and tasks").fill("paarl");
  await page.keyboard.press("Enter");
  await page.locator("body").click({ position: { x: 700, y: 500 } });
  await page.keyboard.press("s");
  await expect(page.getByRole("button", { name: "Stop timer" })).toBeVisible();
  await page.keyboard.press("s");
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();
});

test("adding time in the weekly grid", async ({ page }) => {
  await login(page, "member");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.getByRole("button", { name: "Add row" }).click();
  await page.getByPlaceholder("Search projects and tasks").fill("site visit");
  await page.keyboard.press("Enter");
  const row = page.locator("tr", { hasText: "Site visit" });
  const cell = row.locator("input").first();
  await cell.fill("2:15");
  await cell.press("Enter");
  await expect(row.locator(".week-grid__total")).toHaveText("2:15");
  await waitSynced(page);
});
