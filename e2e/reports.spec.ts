import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { login, waitSynced } from "./fixtures.ts";

test("generate a monthly timesheet PDF", async ({ page }) => {
  await login(page, "member");
  // make sure there is some time this month
  await page.keyboard.press("n");
  await page.getByPlaceholder("Search projects, items and codes").fill("paarl");
  await page.keyboard.press("Enter");
  await page.getByPlaceholder("What did you do?").fill("Monthly report check");
  await page.getByRole("dialog").getByLabel("Hours", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Log hours" }).last().click();
  await waitSynced(page);

  await page.getByRole("link", { name: "Reports" }).click();
  await page.getByRole("link", { name: "Monthly timesheet" }).click();
  await expect(page.getByRole("heading", { name: /Aisha Patel/ })).toBeVisible();
  await expect(page.getByText("Summary by project")).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "PDF" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^Timesheet Aisha Patel \d{4}-\d{2}\.pdf$/);
  const path = await download.path();
  const bytes = readFileSync(path!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(2000);
});

test("members cannot see money in reports", async ({ page }) => {
  await login(page, "member");
  await page.getByRole("link", { name: "Reports" }).click();
  await expect(page.locator(".stat__label", { hasText: "Hours tracked" })).toBeVisible();
  await expect(page.getByText("Billable amount")).toHaveCount(0);
});

test("admins see the company overview with amounts", async ({ page }) => {
  await login(page, "admin");
  await page.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByText("Billable amount")).toBeVisible();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
});
