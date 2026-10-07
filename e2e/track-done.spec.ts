import { expect, test } from "@playwright/test";
import { login, waitSynced } from "./fixtures.ts";

test("mark an item done from the Track page, and undo it", async ({ page }) => {
  await login(page, "member");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.getByRole("button", { name: "Add row" }).click();
  await page.getByPlaceholder("Search projects, items and codes").fill("paarl site visit");
  await page.keyboard.press("Enter");
  const row = page.locator("tr", { hasText: /Paarl bridge upgrade.*Site visit/ });
  await row.getByRole("button", { name: /Mark .*Site visit.* done/ }).click();
  await expect(page.getByText(/Marked .*Site visit.* done/)).toBeVisible();
  await waitSynced(page);
  // Done: its hours boxes are switched off and the done button is gone.
  await expect(row.getByRole("button", { name: /Mark .*Site visit.* done/ })).toHaveCount(0);
  await expect(row.locator("input").first()).toBeDisabled();

  // Undo puts it back, so the other tests are unaffected.
  await page.getByRole("button", { name: "Undo" }).click();
  await waitSynced(page);
  await expect(row.getByRole("button", { name: /Mark .*Site visit.* done/ })).toBeVisible();
  await expect(row.locator("input").first()).toBeEnabled();
});

test("adding an item asks only for a name; reports show hours per item; approvals are weekly", async ({
  page,
}) => {
  await login(page, "admin");

  // New item: no type, no budget, and the code starts empty.
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("button", { name: "Actions for Paarl bridge upgrade" }).click();
  await page.getByRole("menuitem", { name: /Add item/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("New item")).toBeVisible();
  await expect(dialog.getByLabel("Name")).toBeVisible();
  await expect(dialog.getByLabel("Code")).toHaveValue("");
  await expect(dialog.getByLabel("Type")).toHaveCount(0);
  await expect(dialog.getByLabel("Budget (hours)")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Team: no expected hours.
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page.getByText("Hours / week")).toHaveCount(0);

  // Reports: hours per item; no utilisation or budget burn.
  await page.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Hours per item" })).toBeVisible();
  await expect(page.getByText(/Utilisation|Budget burn|Capacity/)).toHaveCount(0);

  // Settings: handed in every week, on Friday.
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByLabel("Timesheets are handed in")).toHaveValue("week");
  await expect(page.getByLabel("…on")).toHaveValue("5");
});
