/** Runs a command without blocking the event loop. Never throws: a missing program is `code: -1`. */
export async function run(
  cmd: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore", windowsHide: true });
    const timer = setTimeout(() => proc.kill(), opts.timeoutMs ?? 15_000);
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { code, stdout, stderr };
  } catch (e) {
    return { code: -1, stdout: "", stderr: (e as Error).message };
  }
}

/** Runs a PowerShell snippet (Windows only) and parses its JSON output. */
export async function powershellJson<T>(script: string): Promise<T | null> {
  const r = await run(
    ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { timeoutMs: 20_000 },
  );
  if (r.code !== 0 || !r.stdout.trim()) return null;
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    return null;
  }
}
