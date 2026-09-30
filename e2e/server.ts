/** Starts a throwaway Stint Server for end-to-end tests. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

process.env.STINT_DATA_DIR = mkdtempSync(join(tmpdir(), "stint-e2e-"));
process.env.STINT_PORT = "47650";
process.env.STINT_HTTP_PORT = "47651";
process.env.STINT_DISCOVERY_PORT = "47659";
process.env.STINT_DISABLE_DISCOVERY = "1";
process.env.STINT_DISABLE_SLEEP_GUARD = "1";
process.env.STINT_DISABLE_UPDATE_CHECK = "1";
process.env.STINT_OPEN_BROWSER = "0";
process.env.STINT_WEB_DIR = resolve(import.meta.dir, "../apps/web/dist");
const { cli } = await import("../apps/server/src/main.ts");
await cli(["run"]);
