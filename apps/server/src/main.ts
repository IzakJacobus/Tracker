import { existsSync, readFileSync } from "node:fs";
import rootPkg from "../../../package.json" with { type: "json" };
import { loadConfig } from "./config.ts";
import { openInBrowser } from "./lib/open.ts";
import { type RuntimeFile, runtimeFilePath, startServer } from "./server.ts";
import type { StaticSource } from "./web/static.ts";

export const VERSION: string = rootPkg.version;

const HELP = `Stint Server ${VERSION}

Usage: stint-server [command]

  run        Start the server (default)
  open       Open the Stint admin page in your browser
  version    Print the version
  help       Show this help

Configuration: <data folder>/stint.config.json or STINT_* environment variables.
`;

export async function cli(argv: string[], web?: StaticSource): Promise<void> {
  const cmd = argv[0] ?? "run";
  const config = loadConfig();
  switch (cmd) {
    case "version":
    case "--version":
      console.log(VERSION);
      return;
    case "help":
    case "--help":
      console.log(HELP);
      return;
    case "open": {
      // Right after install the service may still be starting: wait for it (up to 30 s).
      const file = runtimeFilePath(config.dataDir);
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (existsSync(file)) {
          const rt = JSON.parse(readFileSync(file, "utf8")) as RuntimeFile;
          try {
            const res = await fetch(`${rt.adminUrl}api/setup/status`, { signal: AbortSignal.timeout(2000) });
            const status = (await res.json()) as { setupComplete: boolean };
            openInBrowser(status.setupComplete ? rt.adminUrl : `${rt.adminUrl}setup`);
            return;
          } catch {
            // not answering yet
          }
        }
        await Bun.sleep(500);
      }
      console.error('Stint Server isn\'t running. Start the "Stint Server" service, or restart the PC.');
      process.exitCode = 1;
      return;
    }
    case "run":
    case "--service": {
      const service = argv.includes("--service") || cmd === "--service";
      const server = await startServer(config, {
        version: VERSION,
        web,
        // The service wrapper restarts us when we exit with an error code.
        requestRestart: service
          ? () => {
              setTimeout(() => process.exit(75), 1500);
            }
          : undefined,
      });
      const setupDone = server.ctx.db.query("SELECT 1 FROM organization").get() !== null;
      if (!setupDone && config.openBrowser && !service) openInBrowser(`${server.adminUrl}setup`);
      const shutdown = async () => {
        server.ctx.log.info("Shutting down");
        await server.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      return;
    }
    default:
      console.error(`Unknown command: ${cmd}\n\n${HELP}`);
      process.exitCode = 1;
  }
}

if (import.meta.main) {
  await cli(process.argv.slice(2));
}
