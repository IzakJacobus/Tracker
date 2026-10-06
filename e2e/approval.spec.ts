import { expect, test } from "@playwright/test";
import { login, waitSynced } from "./fixtures.ts";

test("submit a timesheet, manager sends it back, member resubmits, manager approves", async ({ browser }) => {
  test.setTimeout(90_000);
  // Member: track some time and submit.
  const memberCtx = await browser.newContext();
  const member = await memberCtx.newPage();
  await login(member, "member");
  await member.keyboard.press("n");
  await member.getByPlaceholder("Search projects, items and codes").fill("paarl");
  await member.keyboard.press("Enter");
  await member.getByPlaceholder("What did you do?").fill("Approval flow check");
  await member.getByRole("dialog").getByLabel("Hours", { exact: true }).fill("3");
  await member.getByRole("button", { name: "Log hours" }).last().click();
  await waitSynced(member);
  const card = member.getByRole("region", { name: "Timesheet submission" });
  await card.getByRole("button", { name: /^Submit/ }).click();
  await member.getByRole("button", { name: "Submit for approval" }).click();
  await expect(card).toContainText("waiting for approval");

  // Manager: sees it waiting, sends it back with a comment.
  const mgrCtx = await browser.newContext();
  const mgr = await mgrCtx.newPage();
  await login(mgr, "manager");
  await expect(mgr.getByRole("link", { name: /Approvals/ })).toContainText("1");
  await mgr.getByRole("link", { name: /Approvals/ }).click();
  const row = mgr.locator("tr", { hasText: "Aisha Patel" });
  await row.getByRole("button", { name: "Send back" }).click();
  await mgr.getByLabel("What needs to change?").fill("Please add the task for the site visit.");
  await mgr.getByRole("dialog").getByRole("button", { name: "Send back" }).click();
  await expect(mgr.getByText("Nothing to approve")).toBeVisible();

  // Member: sees the comment after the next sync and submits again.
  await member.reload();
  await expect(card).toContainText("Please add the task for the site visit.", { timeout: 15_000 });
  await card.getByRole("button", { name: "Submit again" }).click();
  await member.getByRole("button", { name: "Submit for approval" }).click();
  await expect(card).toContainText("waiting for approval");

  // Manager approves; the period is locked for the member.
  await mgr.reload();
  await mgr.locator("tr", { hasText: "Aisha Patel" }).getByRole("button", { name: "Approve" }).click();
  await expect(mgr.getByText("Nothing to approve")).toBeVisible();
  await member.reload();
  await expect(
    member
      .locator(".entry-row", { hasText: "Approval flow check" })
      .locator(".badge", { hasText: "Approved" }),
  ).toBeVisible({
    timeout: 15_000,
  });

  // Admin unlocks it again, with a reason (recorded in the audit log).
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, "admin");
  await admin.getByRole("link", { name: /Approvals/ }).click();
  await admin
    .locator("tr", { hasText: "Aisha Patel" })
    .getByRole("button", { name: "Unlock" })
    .first()
    .click();
  await admin.getByLabel("Reason (kept in the audit log)").fill("End-to-end test clean-up");
  await admin.getByRole("dialog").getByRole("button", { name: "Unlock" }).click();
  await expect(admin.getByText("Unlocked.")).toBeVisible();
  await admin.goto("/settings/audit");
  await expect(admin.getByText("“End-to-end test clean-up”")).toBeVisible();
  await adminCtx.close();
  await memberCtx.close();
  await mgrCtx.close();
});
