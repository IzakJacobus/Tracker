import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "vitest";
import { StintDB } from "../src/data/db.ts";
import { SyncEngine } from "../src/data/syncEngine.ts";
import { setTransport } from "../src/lib/api.ts";
import { NetworkError, type Transport } from "../src/lib/transport.ts";

type Handler = (path: string) => { status: number; body: unknown };

function fakeTransport(handler: Handler): Transport {
  return { kind: "browser", request: async (_m, path) => handler(path) };
}

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  deletedAt: null,
  name: id,
  ...extra,
});
let n = 0;
const freshDb = () => new StintDB(`test-${++n}`);

afterEach(() => setTransport(fakeTransport(() => ({ status: 500, body: null }))));

describe("SyncEngine pull", () => {
  test("pages until done and stores the cursor", async () => {
    const db = freshDb();
    const pages: Record<string, unknown> = {
      "0": {
        changes: { clients: [row("c1")] },
        organization: null,
        cursor: 5,
        hasMore: true,
        epoch: "0.0",
        serverTime: 0,
      },
      "5": {
        changes: { clients: [row("c2")] },
        organization: null,
        cursor: 9,
        hasMore: false,
        epoch: "0.0",
        serverTime: 0,
      },
    };
    setTransport(fakeTransport((p) => ({ status: 200, body: pages[/since=(\d+)/.exec(p)![1]!] })));
    const engine = new SyncEngine(db);
    await engine.syncNow();
    expect((await db.clients.toArray()).map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(await db.getMeta("cursor")).toBe(9);
    expect(engine.get().state).toBe("synced");
  });

  test("tombstones delete local rows", async () => {
    const db = freshDb();
    await db.clients.put(row("c1") as never);
    setTransport(
      fakeTransport(() => ({
        status: 200,
        body: {
          changes: { clients: [row("c1", { deletedAt: 1 })] },
          organization: null,
          cursor: 3,
          hasMore: false,
          epoch: "0.0",
          serverTime: 0,
        },
      })),
    );
    await new SyncEngine(db).syncNow();
    expect(await db.clients.count()).toBe(0);
  });

  test("a changed epoch wipes the local copy and pulls from scratch", async () => {
    const db = freshDb();
    await db.setMeta("cursor", 40);
    await db.setMeta("epoch", "0.0");
    await db.projects.put(row("p-no-longer-visible") as never);
    const seen: string[] = [];
    setTransport(
      fakeTransport((p) => {
        seen.push(p);
        const since = /since=(\d+)/.exec(p)![1];
        return {
          status: 200,
          body:
            since === "40"
              ? { changes: {}, organization: null, cursor: 41, hasMore: false, epoch: "0.1", serverTime: 0 }
              : {
                  changes: { projects: [row("p-visible")] },
                  organization: null,
                  cursor: 41,
                  hasMore: false,
                  epoch: "0.1",
                  serverTime: 0,
                },
        };
      }),
    );
    await new SyncEngine(db).syncNow();
    expect((await db.projects.toArray()).map((p) => p.id)).toEqual(["p-visible"]);
    expect(seen.some((p) => p.includes("since=0"))).toBe(true);
  });

  test("reports offline when the server can't be reached", async () => {
    const db = freshDb();
    setTransport({
      kind: "browser",
      request: async () => {
        throw new NetworkError();
      },
    });
    const engine = new SyncEngine(db);
    await engine.syncNow();
    expect(engine.get().state).toBe("offline");
  });
});
