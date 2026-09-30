/**
 * Renders Stint's PNG icons from the SVG logo using the Playwright Chromium.
 * Run: bun scripts/make-icons.ts   (outputs into apps/web/public/icons and assets/)
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const root = join(import.meta.dir, "..");
const svg = readFileSync(join(root, "apps/web/public/icons/icon.svg"), "utf8");
const outWeb = join(root, "apps/web/public/icons");
const outAssets = join(root, "assets");
mkdirSync(outAssets, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(size: number, file: string, maskable = false) {
  const inner = maskable ? Math.round(size * 0.72) : size;
  const bg = maskable ? "#1f5c4a" : "transparent";
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${bg}">
      <div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div>
    </body></html>`,
  );
  await page.screenshot({ path: file, omitBackground: !maskable });
}

await render(192, join(outWeb, "icon-192.png"));
await render(512, join(outWeb, "icon-512.png"));
await render(512, join(outWeb, "icon-maskable-512.png"), true);
await render(1024, join(outAssets, "icon-1024.png"));
await render(256, join(outAssets, "icon-256.png"));
await browser.close();
console.log("icons written");
