import { HlcClock } from "@stint/shared";

const NODE_KEY = "stint.node";

/** A short, stable id for this device/browser, used to break HLC ties. */
export function deviceNodeId(): string {
  try {
    let id = localStorage.getItem(NODE_KEY);
    if (!id) {
      const b = new Uint8Array(6);
      crypto.getRandomValues(b);
      id = Array.from(b, (x) => x.toString(36).padStart(2, "0"))
        .join("")
        .slice(0, 10);
      localStorage.setItem(NODE_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

export function createClock(): HlcClock {
  return new HlcClock(deviceNodeId());
}
