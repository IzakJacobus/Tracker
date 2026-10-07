import { describe, expect, test } from "bun:test";
import type { Client, Project } from "@stint/shared";
import { createTestServer } from "./helpers.ts";

type Err = { error: { message: string; details?: { fields?: Record<string, string> } } };

async function world() {
  const s = createTestServer();
  const admin = await s.setup();
  const mk = async (name: string) =>
    (await s.json<Client>("POST", "/api/clients", { as: admin, body: { name } })).body;
  const acme = await mk("Acme");
  const beta = await mk("Beta");
  const project = (
    clientId: string,
    name: string,
    code?: string | null,
    extra: Record<string, unknown> = {},
  ) =>
    s.json<Project & Err>("POST", "/api/projects", { as: admin, body: { clientId, name, code, ...extra } });
  return { s, admin, acme, beta, project };
}

describe("project codes", () => {
  test("every top-level project needs a code; items under it may have one", async () => {
    const { project, acme } = await world();
    const none = await project(acme.id, "No code");
    expect(none.status).toBe(422);
    expect(none.body.error.details?.fields?.code).toContain("code");
    expect((await project(acme.id, "Blank", "   ")).status).toBe(422);
    const ok = await project(acme.id, "Bridge", "2026-014");
    expect(ok.status).toBe(201);
    expect(ok.body.code).toBe("2026-014");
    const item = await project(acme.id, "Design", null, { parentId: ok.body.id });
    expect(item.status).toBe(201);
    expect(item.body.code).toBeNull();
    const coded = await project(acme.id, "Detail", "2026-014.1", { parentId: ok.body.id });
    expect(coded.status).toBe(201);
  });

  test("codes are unique within a client, ignoring case, and items count too", async () => {
    const { project, acme, beta } = await world();
    const bridge = (await project(acme.id, "Bridge", "BRG-07")).body;
    const dup = await project(acme.id, "Other", "brg-07 ");
    expect(dup.status).toBe(422);
    expect(dup.body.error.details?.fields?.code).toContain("Bridge");
    // another client may use the same code
    expect((await project(beta.id, "Bridge too", "BRG-07")).status).toBe(201);
    // an item's code is taken as well
    await project(acme.id, "Phase", "BRG-07.A", { parentId: bridge.id });
    expect((await project(acme.id, "Another", "BRG-07.A")).status).toBe(422);
    // deleted/renamed codes free up: re-saving a project's own code is fine
    const same = await project(acme.id, "Same", "SAME-1");
    expect(same.status).toBe(201);
  });

  test("editing: a code can't be blanked or taken, but a project may keep its own", async () => {
    const { s, admin, project, acme } = await world();
    const a = (await project(acme.id, "A", "A-1")).body;
    const b = (await project(acme.id, "B", "B-1")).body;
    const patch = (id: string, body: Record<string, unknown>) =>
      s.json<Project & Err>("PATCH", `/api/projects/${id}`, { as: admin, body });
    expect((await patch(a.id, { code: "" })).status).toBe(422);
    expect((await patch(a.id, { code: null })).status).toBe(422);
    expect((await patch(a.id, { code: "b-1" })).status).toBe(422);
    expect((await patch(a.id, { code: "A-1", name: "A renamed" })).status).toBe(200);
    const changed = await patch(a.id, { code: "A-2" });
    expect(changed.status).toBe(200);
    expect(changed.body.code).toBe("A-2");
    // the freed code can be used again
    expect((await patch(b.id, { code: "A-1" })).status).toBe(200);
  });

  test("a project from 0.1 without a code must be given one the next time it's edited", async () => {
    const { s, admin, project, acme } = await world();
    const old = (await project(acme.id, "Old", "TMP")).body;
    s.ctx.db.query("UPDATE projects SET code = NULL WHERE id = ?").run(old.id);
    const r = await s.json<Project & Err>("PATCH", `/api/projects/${old.id}`, {
      as: admin,
      body: { notes: "just a note" },
    });
    expect(r.status).toBe(422);
    expect(
      (await s.json("PATCH", `/api/projects/${old.id}`, { as: admin, body: { code: "OLD-1" } })).status,
    ).toBe(200);
  });

  test("moving: to another client keeps codes unique; an item becoming top-level needs a code", async () => {
    const { s, admin, project, acme, beta } = await world();
    const a = (await project(acme.id, "Moves", "X-1")).body;
    const item = (await project(acme.id, "Item", "X-1.1", { parentId: a.id })).body;
    await project(beta.id, "Clash", "x-1.1");
    const clash = await s.json<Project & Err>("POST", `/api/projects/${a.id}/move`, {
      as: admin,
      body: { parentId: null, clientId: beta.id },
    });
    expect(clash.status).toBe(422);
    expect(clash.body.error.details?.fields?.code).toContain("Clash");
    // an item without a code can't be promoted to a top-level project
    const plain = (await project(acme.id, "Plain", null, { parentId: a.id })).body;
    const promote = await s.json<Project & Err>("POST", `/api/projects/${plain.id}/move`, {
      as: admin,
      body: { parentId: null },
    });
    expect(promote.status).toBe(422);
    // with a code it can
    await s.json("PATCH", `/api/projects/${plain.id}`, { as: admin, body: { code: "PLAIN-1" } });
    const ok = await s.json<Project>("POST", `/api/projects/${plain.id}/move`, {
      as: admin,
      body: { parentId: null },
    });
    expect(ok.status).toBe(200);
    expect(item.code).toBe("X-1.1");
  });
});
