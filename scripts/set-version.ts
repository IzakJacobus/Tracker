/**
 * Sets the version in every package.json.
 *
 *   bun scripts/set-version.ts 1.2.0
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: bun scripts/set-version.ts <major.minor.patch>");
  process.exit(1);
}
const root = join(import.meta.dir, "..");
const jsonFiles = [
  "package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "packages/shared/package.json",
];
for (const f of jsonFiles) {
  const p = join(root, f);
  const text = readFileSync(p, "utf8");
  writeFileSync(p, text.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`));
}
console.log(`Version set to ${version} in ${jsonFiles.length} files.`);
