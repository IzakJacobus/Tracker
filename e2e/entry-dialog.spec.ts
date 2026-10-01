import { expect, test } from "@playwright/test";
import { login, waitSynced } from "./fixtures.ts";

// Regression: the project list opened *behind* the Add time window, so it couldn't be clicked,
// and Escape in the list closed the whole window.
test("choosing a project with the mouse in the Add time window", async ({ page }) => {
  await login(page, "member");
  await page.getByRole("button", { name: "Add time" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add time" });
  await expect(dialog).toBeVisible();

  // With no project chosen yet, the list opens by itself, and must be on top and usable.
  const list = page.getByRole("listbox", { name: "Projects" });
  await expect(list).toBeVisible();

  // Escape closes only the project list, not the window.
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(dialog).toBeVisible();

  // A real mouse click on an option (fails if anything covers the list).
  await dialog.locator(".picker-trigger").click();
  await list
    .getByRole("option", { name: /Detailed design/ })
    .first()
    .click();
  await expect(dialog.locator(".picker-trigger")).toContainText("Detailed design");

  await dialog.getByLabel("Description").fill("Picked with the mouse");
  await dialog.getByLabel("Duration").fill("1:15");
  await dialog.getByRole("button", { name: "Add time" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".entry-row", { hasText: "Picked with the mouse" })).toBeVisible();
  await waitSynced(page);
});
