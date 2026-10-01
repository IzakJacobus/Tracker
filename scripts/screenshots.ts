/**
 * Regenerates the README screenshots from the demo company.
 *   bun run --filter @stint/web build && bun scripts/screenshots.ts
 * Starts a throwaway server with the seed data (ports 47760/47761) and writes docs/screenshots/*.png.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const root = join(import.meta.dir, "..");
const out = join(root, "docs/screenshots");
const data = mkdtempSync(join(tmpdir(), "stint-shots-"));
const env = { ...process.env, STINT_DATA_DIR: data };

const seed = Bun.spawnSync(["bun", "apps/server/scripts/seed.ts", "--reset"], { cwd: root, env });
if (seed.exitCode !== 0) throw new Error(seed.stderr.toString());
const server = Bun.spawn(["bun", "apps/server/src/main.ts"], {
  cwd: root,
  env: {
    ...env,
    STINT_WEB_DIR: join(root, "apps/web/dist"),
    STINT_OPEN_BROWSER: "0",
    STINT_DISABLE_UPDATE_CHECK: "1",
    STINT_DISABLE_DISCOVERY: "1",
    STINT_PORT: "47760",
    STINT_HTTP_PORT: "47761",
  },
  stdout: "ignore",
  stderr: "inherit",
});
const base = "http://localhost:47761";
for (let i = 0; i < 40; i++) {
  if (
    await fetch(`${base}/api/info`).then(
      (r) => r.ok,
      () => false,
    )
  )
    break;
  await Bun.sleep(250);
}

const browser = await chromium.launch();
async function session(email: string, opts: { dark?: boolean; mobile?: boolean } = {}) {
  const ctx = await browser.newContext({
    viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: opts.mobile ? 2 : 1,
    colorScheme: opts.dark ? "dark" : "light",
    locale: "en-ZA",
    timezoneId: "Africa/Johannesburg",
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("stint demo 2026");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.locator(".sync-pill:visible", { hasText: "Synced" }).first().waitFor({ timeout: 20_000 });
  return { ctx, page };
}
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`docs/screenshots/${name}.png`);
};

try {
  const { ctx, page } = await session("pieter@karoo.co.za");
  await shot(page, "track-list");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await shot(page, "track-week");
  await page.goto(`${base}/reports`);
  await page.getByLabel("Period").selectOption("last-month");
  await shot(page, "reports-overview");
  await page.goto(`${base}/reports/monthly`);
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  await page
    .getByLabel("Month")
    .fill(`${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}`);
  await page.locator("h1").click();
  await shot(page, "reports-monthly");
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.keyboard.type("paarl");
  await shot(page, "command-palette");
  await ctx.close();

  const admin = await session("thandi@karoo.co.za");
  await admin.page.goto(`${base}/projects`);
  await shot(admin.page, "projects");
  await admin.page.goto(`${base}/approvals`);
  await shot(admin.page, "approvals");
  await admin.page.goto(`${base}/settings/health`);
  await shot(admin.page, "health");
  await admin.ctx.close();

  const dark = await session("aisha@karoo.co.za", { dark: true });
  await shot(dark.page, "track-dark");
  await dark.ctx.close();

  const phone = await session("aisha@karoo.co.za", { mobile: true });
  await shot(phone.page, "phone");
  await phone.ctx.close();
} finally {
  await browser.close();
  server.kill();
  await server.exited;
  rmSync(data, { recursive: true, force: true });
}
