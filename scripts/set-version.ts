/**
 * Sets the version everywhere it lives (package.json files, Tauri config, Cargo.toml).
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
  "apps/desktop/package.json",
  "packages/shared/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
];
for (const f of jsonFiles) {
  const p = join(root, f);
  const text = readFileSync(p, "utf8");
  writeFileSync(p, text.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`));
}
const cargo = join(root, "apps/desktop/src-tauri/Cargo.toml");
writeFileSync(cargo, readFileSync(cargo, "utf8").replace(/^version = ".*"$/m, `version = "${version}"`));
console.log(`Version set to ${version} in ${jsonFiles.length + 1} files.`);
