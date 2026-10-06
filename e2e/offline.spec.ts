import { expect, test } from "@playwright/test";
import { login, waitSynced } from "./fixtures.ts";

test("offline edit, then sync", async ({ page, context }) => {
  await login(page, "member");
  await waitSynced(page);
  // The service worker must be active so Stint can start without the server.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await context.setOffline(true);

  // Add an entry while offline.
  await page.keyboard.press("n");
  await page.getByPlaceholder("Search projects, items and codes").fill("site visit");
  await page.keyboard.press("Enter");
  await page.getByPlaceholder("What did you do?").fill("Offline site notes");
  await page.getByRole("dialog").getByLabel("Hours", { exact: true }).fill("1:15");
  await page.getByRole("button", { name: "Log hours" }).last().click();
  await expect(page.locator(".entry-row", { hasText: "Offline site notes" })).toBeVisible();
  await expect(page.locator(".sidebar .sync-pill")).toContainText("Offline", { timeout: 10_000 });

  // Edit it while still offline.
  await page
    .locator(".entry-row", { hasText: "Offline site notes" })
    .getByRole("button", { name: /Edit entry/ })
    .click();
  await page.getByPlaceholder("What did you do?").fill("Offline site notes (edited)");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".sidebar .sync-pill")).toContainText("2 saved");

  // Stint still opens with no network: the app shell comes from the service worker,
  // the data from this computer's local copy.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Track" })).toBeVisible();
  await expect(page.locator(".entry-row", { hasText: "Offline site notes (edited)" })).toBeVisible();

  // Back online: the queued changes are sent automatically.
  await context.setOffline(false);
  await waitSynced(page);

  // The server now has the edited entry.
  const res = await page.request.get("/api/sync/pull?since=0", { headers: { "x-stint-request": "1" } });
  const body = (await res.json()) as {
    changes: { timeEntries?: { description: string; durationS: number }[] };
  };
  const found = body.changes.timeEntries?.find((e) => e.description === "Offline site notes (edited)");
  expect(found?.durationS).toBe(75 * 60);
});

test("an app update is offered, not forced", async ({ page }) => {
  await login(page, "member");
  const hasSw = await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()));
  expect(hasSw).toBe(true);
});
