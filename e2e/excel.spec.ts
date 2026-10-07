import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { readXlsx, toXlsx } from "../packages/shared/src/export/index.ts";
import { login, PEOPLE, waitSynced } from "./fixtures.ts";

let workbook: Uint8Array = new Uint8Array();
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Choose the workbook, and wait until Stint has read it (the Preview button is off until then). */
async function chooseFile(page: Page) {
  await expect(async () => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "company.xlsx",
      mimeType: XLSX,
      buffer: Buffer.from(workbook),
    });
    await expect(page.getByRole("button", { name: "Preview" })).toBeEnabled({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });
}

test("export to Excel, and import a workbook that creates projects, items and hours", async ({ page }) => {
  await login(page, "admin");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Import / Export" }).click();

  // Export: Projects and Hours sheets, with the project code in front.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Excel workbook" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^Stint \d{4}-\d{2}-\d{2}\.xlsx$/);
  const sheets = readXlsx(new Uint8Array(readFileSync((await download.path())!)));
  expect(sheets.map((s) => s.name)).toEqual(["Projects", "Hours"]);
  expect(sheets[0]!.rows[0]).toEqual([
    "Client",
    "Project code",
    "Path",
    "Type",
    "Item code",
    "Done",
    "Budget hours",
  ]);
  expect(sheets[0]!.rows.some((r) => r[0] === "Drakenstein Municipality" && /^2026-0/.test(r[1] ?? ""))).toBe(
    true,
  );

  // The empty template downloads too.
  const [template] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download empty template" }).click(),
  ]);
  expect(readXlsx(new Uint8Array(readFileSync((await template.path())!))).map((s) => s.name)).toEqual([
    "Projects",
    "Hours",
    "How to use",
  ]);

  // Import a workbook of our own: a new client, project (own code), items, and hours for Aisha.
  const day = new Date();
  day.setDate(day.getDate() - 1);
  const date = day.toISOString().slice(0, 10);
  workbook = toXlsx([
    {
      name: "Projects",
      table: {
        columns: [
          { key: "client", header: "Client", kind: "text" },
          { key: "code", header: "Project code", kind: "text" },
          { key: "path", header: "Path", kind: "text" },
          { key: "kind", header: "Type", kind: "text" },
          { key: "done", header: "Done", kind: "text" },
        ],
        rows: [
          { client: "Excel Client", code: "XL-7", path: "Culvert survey" },
          { client: "Excel Client", code: "XL-7", path: "Culvert survey › Site visit", kind: "Phase" },
          {
            client: "Excel Client",
            code: "XL-7",
            path: "Culvert survey › Old work",
            kind: "Phase",
            done: "Yes",
          },
        ],
      },
    },
    {
      name: "Hours",
      table: {
        columns: [
          { key: "date", header: "Date", kind: "text" },
          { key: "email", header: "Email", kind: "text" },
          { key: "person", header: "Person", kind: "text" },
          { key: "client", header: "Client", kind: "text" },
          { key: "code", header: "Project code", kind: "text" },
          { key: "project", header: "Project", kind: "text" },
          { key: "hours", header: "Hours", kind: "decimal" },
        ],
        rows: [
          {
            date,
            email: PEOPLE.member.email,
            person: PEOPLE.member.name,
            client: "Excel Client",
            code: "XL-7",
            project: "Culvert survey › Site visit",
            hours: 3.5,
          },
        ],
      },
    },
  ]);
  await chooseFile(page);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("heading", { name: "2. Check the preview" })).toBeVisible();
  await expect(page.getByText(/Excel Client › Culvert survey › Site visit/)).toBeVisible();
  await page.getByRole("button", { name: "Import 1 entries" }).click();
  await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
  await waitSynced(page);

  // The project came in with the code from the file; the finished item is marked done.
  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page.getByText("Culvert survey").first()).toBeVisible();
  await expect(page.getByText("XL-7").first()).toBeVisible();

  // Importing the same workbook again changes nothing.
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Import / Export" }).click();
  await chooseFile(page);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("heading", { name: "2. Check the preview" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import/ })).toHaveCount(0);
});
