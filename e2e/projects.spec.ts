import { expect, test } from "@playwright/test";
import { login, waitSynced } from "./fixtures.ts";

// Regression: "Create project" did nothing (the form started with no client while the list was
// still loading, and the server's "client required" error had nowhere to show).
test("an admin creates a new top-level project", async ({ page }) => {
  await login(page, "admin");
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Name", { exact: true }).fill("Stellenbosch water audit");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Stellenbosch water audit").first()).toBeVisible();
  await waitSynced(page);
});

test("a new client can be created together with a project", async ({ page }) => {
  await login(page, "admin");
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Client").selectOption({ label: "+ New client…" });
  // An empty client name is caught before anything is created.
  await dialog.getByLabel("Name", { exact: true }).fill("Harbour wall survey");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog.getByText("Give the new client a name.")).toBeVisible();
  await dialog.getByLabel("New client name").fill("Saldanha Port Authority");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Saldanha Port Authority").first()).toBeVisible();
  await expect(page.getByText("Harbour wall survey").first()).toBeVisible();
  await page.getByRole("link", { name: "Clients" }).click();
  await expect(page.getByText("Saldanha Port Authority").first()).toBeVisible();
  await waitSynced(page);
});

test("project codes: suggested from the client's own numbering, required, and unique per client", async ({
  page,
}) => {
  await login(page, "admin");
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Client").selectOption({ label: "Drakenstein Municipality" });
  // The client's existing codes run 2026-014 and up, so the next one in that pattern is suggested.
  const code = dialog.getByLabel("Project code");
  await expect(code).toHaveValue(/^2026-0(1[5-9]|[2-9][0-9])$/);

  // A code is required.
  await dialog.getByLabel("Name", { exact: true }).fill("Culvert survey");
  await code.fill("");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog.getByText("Give the project a code")).toBeVisible();

  // Codes are unique per client, ignoring case.
  await code.fill("2026-014");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog.getByText(/already used by .Paarl bridge upgrade./)).toBeVisible();

  // A code of the person's own choosing is fine, and shows in front of the name.
  await code.fill("DRK/CULV/01");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /DRK\/CULV\/01\s+Culvert survey/ })).toBeVisible();
  await waitSynced(page);
});
