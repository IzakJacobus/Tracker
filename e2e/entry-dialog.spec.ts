import { expect, test } from "@playwright/test";
import { login, waitSynced } from "./fixtures.ts";

// Regression: the project list opened *behind* the Add time window, so it couldn't be clicked,
// and Escape in the list closed the whole window.
test("choosing what you worked on with the mouse in the Log hours window", async ({ page }) => {
  await login(page, "member");
  await page.getByRole("button", { name: "Log hours" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Log hours" });
  await expect(dialog).toBeVisible();

  // With nothing chosen yet, the list opens by itself, and must be on top and usable.
  const list = page.getByRole("listbox", { name: "Projects and items" });
  await expect(list).toBeVisible();

  // Escape closes only the list, not the window.
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(dialog).toBeVisible();

  // Real mouse clicks: into the project, then on its item (fails if anything covers the list).
  await dialog.locator(".picker-trigger").click();
  await list.getByRole("option", { name: /^Paarl bridge upgrade, \d+ items inside$/ }).click();
  await list
    .getByRole("option", { name: /Detailed design/ })
    .first()
    .click();
  await expect(dialog.locator(".picker-trigger")).toContainText("Detailed design");

  await dialog.getByLabel("Note").fill("Picked with the mouse");
  await dialog.getByLabel("Hours", { exact: true }).fill("1:15");
  await dialog.getByRole("button", { name: "Log hours" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".entry-row", { hasText: "Picked with the mouse" })).toBeVisible();
  await waitSynced(page);
});
