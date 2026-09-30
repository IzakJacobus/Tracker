import { describe, expect, test } from "bun:test";
import { listenWithFallback } from "../src/net/listen.ts";

describe("port fallback", () => {
  test("picks another port when the preferred one is busy", () => {
    const blocker = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
    try {
      const s = listenWithFallback(blocker.port!, (port) =>
        Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("y") }),
      );
      expect(s.port).not.toBe(blocker.port);
      s.stop(true);
    } finally {
      blocker.stop(true);
    }
  });
});
