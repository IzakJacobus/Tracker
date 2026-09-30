/** Opens a URL in the user's default browser. */
export function openInBrowser(url: string): void {
  try {
    if (process.platform === "win32")
      Bun.spawn(["cmd", "/c", "start", "", url], { stdio: ["ignore", "ignore", "ignore"] });
    else if (process.platform === "darwin")
      Bun.spawn(["open", url], { stdio: ["ignore", "ignore", "ignore"] });
    else Bun.spawn(["xdg-open", url], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    // no browser available (headless) — nothing to do
  }
}
