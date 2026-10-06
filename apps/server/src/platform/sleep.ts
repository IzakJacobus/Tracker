import type { Subprocess } from "bun";
import type { Logger } from "../lib/log.ts";

/**
 * Keeps the server PC from going to sleep while Stint Server runs, so nobody's
 * timer stops syncing at 17:30 because the office PC dozed off. The display may
 * still turn off. Released when the guard is turned off or the server stops.
 */
export interface SleepGuard {
  readonly active: boolean;
  readonly method: string | null;
  set(on: boolean): void;
  stop(): void;
}

const ES_CONTINUOUS = 0x80000000;
const ES_SYSTEM_REQUIRED = 0x00000001;

type Setter = (flags: number) => number;

function windowsSetter(): Setter | null {
  if (process.platform !== "win32") return null;
  try {
    const { dlopen, FFIType } = require("bun:ffi") as typeof import("bun:ffi");
    const lib = dlopen("kernel32.dll", {
      SetThreadExecutionState: { args: [FFIType.u32], returns: FFIType.u32 },
    });
    return (flags) => lib.symbols.SetThreadExecutionState(flags >>> 0) as number;
  } catch {
    return null;
  }
}

export function createSleepGuard(log: Logger): SleepGuard {
  let active = false;
  let method: string | null = null;
  let child: Subprocess | null = null;
  const setter = windowsSetter();

  const enable = () => {
    if (setter) {
      // The execution state belongs to the calling thread: the main JS thread lives as long as the server.
      if (setter(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) !== 0) {
        method = "SetThreadExecutionState";
        return true;
      }
      return false;
    }
    // Both helpers exit by themselves if the server process dies.
    const cmd =
      process.platform === "darwin"
        ? ["caffeinate", "-i", "-w", String(process.pid)]
        : process.platform === "linux" && Bun.which("systemd-inhibit")
          ? [
              "systemd-inhibit",
              "--what=sleep",
              "--who=Stint Server",
              "--why=Keeping Stint available to the office",
              "--mode=block",
              "tail",
              `--pid=${process.pid}`,
              "-f",
              "/dev/null",
            ]
          : null;
    if (!cmd || !Bun.which(cmd[0]!)) return false;
    try {
      const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
      child = proc;
      method = cmd[0]!;
      // If the helper can't hold the lock (no systemd session, say), report it as off.
      void proc.exited.then(() => {
        if (child === proc) {
          child = null;
          active = false;
          method = null;
        }
      });
      return true;
    } catch {
      return false;
    }
  };

  const disable = () => {
    if (setter) setter(ES_CONTINUOUS);
    const c = child;
    child = null;
    c?.kill();
    method = null;
  };

  return {
    get active() {
      return active;
    },
    get method() {
      return method;
    },
    set(on) {
      if (on === active) return;
      if (on) {
        active = enable();
        log.info(active ? "Sleep prevention on" : "Sleep prevention isn't available on this system", {
          method,
        });
      } else {
        disable();
        active = false;
        log.info("Sleep prevention off");
      }
    },
    stop() {
      if (active) disable();
      active = false;
    },
  };
}
