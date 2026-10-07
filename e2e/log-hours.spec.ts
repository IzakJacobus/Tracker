import { expect, test } from "@playwright/test";
import { login, waitSynced } from "./fixtures.ts";

test("log hours: choose the project, drill down to the item, enter the hours", async ({ page }) => {
  await login(page, "member");
  await page.getByRole("button", { name: "Log hours" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Log hours" });
  const list = page.getByRole("listbox", { name: "Projects and items" });
  await expect(list).toBeVisible();

  // The project has items under it, so choosing it drills down instead of picking it.
  await list.getByRole("option", { name: /^Paarl bridge upgrade, \d+ items inside$/ }).click();
  await expect(list.getByRole("option", { name: /Detailed design/ })).toBeVisible();
  await list.getByRole("option", { name: /Site visit/ }).click();
  await expect(dialog.locator(".picker-trigger")).toContainText("Paarl bridge upgrade › Site visit");

  await dialog.getByLabel("Hours", { exact: true }).fill("2.5");
  await dialog.getByLabel("Note").fill("Pier inspection");
  await dialog.getByRole("button", { name: "Log hours" }).click();
  await expect(dialog).toBeHidden();
  const row = page.locator(".entry-row", { hasText: "Pier inspection" });
  await expect(row).toContainText("2:30");
  await expect(row).toContainText("Site visit");
  await waitSynced(page);

  // It survives a reload (it came back from the server / local store).
  await page.reload();
  await expect(page.locator(".entry-row", { hasText: "Pier inspection" })).toBeVisible();
});

test("N opens Log hours from anywhere; there is no timer", async ({ page }) => {
  await login(page, "member");
  await expect(page.getByRole("button", { name: /timer/i })).toHaveCount(0);
  await page.getByRole("heading", { name: "Track", level: 1 }).click();
  await page.keyboard.press("n");
  await expect(page.getByRole("dialog", { name: "Log hours" })).toBeVisible();
});

test("an item marked done can't be chosen any more", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await login(admin, "admin");
  await admin.getByRole("link", { name: "Projects" }).click();
  await admin.getByRole("button", { name: "Actions for Paarl bridge upgrade" }).click();
  await admin.getByRole("menuitem", { name: "Items" }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.getByLabel("New item name").fill("Concept sketches");
  await dialog.getByRole("button", { name: "Add item" }).click();
  const itemRow = dialog.locator("tr", { has: admin.locator('input[value="Concept sketches"]') });
  await expect(itemRow).toBeVisible();
  await waitSynced(admin);

  const member = await (await browser.newContext()).newPage();
  await login(member, "member");
  await member.keyboard.press("n");
  await member.getByPlaceholder("Search projects, items and codes").fill("concept");
  await expect(member.getByRole("option", { name: /Concept sketches/ })).toBeVisible();
  await member.keyboard.press("Escape");
  await member.keyboard.press("Escape");

  await itemRow.getByRole("button", { name: "Mark done" }).click();
  await expect(itemRow.getByRole("button", { name: "Reopen" })).toBeVisible();

  await member.reload();
  await waitSynced(member);
  await member.keyboard.press("n");
  await member.getByPlaceholder("Search projects, items and codes").fill("concept");
  await expect(member.getByRole("option", { name: /Concept sketches/ })).toHaveCount(0);
  await expect(member.getByText("Nothing matches.")).toBeVisible();
});

test("adding hours in the weekly grid", async ({ page }) => {
  await login(page, "member");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.getByRole("button", { name: "Add row" }).click();
  await page.getByPlaceholder("Search projects, items and codes").fill("site visit");
  await page.keyboard.press("Enter");
  const row = page.locator("tr", { hasText: "Site visit" });
  const sunday = row.locator("input").nth(6);
  await sunday.fill("2:15");
  await sunday.press("Enter");
  await expect(sunday).toHaveValue("2:15");
  await waitSynced(page);
  await page.reload();
  await expect(page.locator("tr", { hasText: "Site visit" }).locator("input").nth(6)).toHaveValue("2:15");
});
