import { BASE_URL, PEOPLE } from "./fixtures.ts";

/** Creates the organisation, three people, a client and a project through the API. */
export default async function globalSetup() {
  const h = { "content-type": "application/json", "x-stint-request": "1" };
  const setup = await fetch(`${BASE_URL}/api/setup`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ organizationName: "Karoo Consulting Engineers", admin: PEOPLE.admin }),
  });
  if (setup.status !== 201) throw new Error(`setup failed: ${setup.status} ${await setup.text()}`);
  const H = { ...h, cookie: setup.headers.get("set-cookie")!.split(";")[0]! };
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${BASE_URL}/api${path}`, {
      method,
      headers: H,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  };
  const mgr = await call<{ id: string }>("POST", "/users", { ...PEOPLE.manager, role: "manager" });
  const member = await call<{ id: string }>("POST", "/users", {
    ...PEOPLE.member,
    role: "member",
    managerId: mgr.id,
    rate: 65000,
  });
  // new users must normally change their password first; do it for them here
  for (const [who, id] of [
    ["manager", mgr.id],
    ["member", member.id],
  ] as const) {
    const login = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ email: PEOPLE[who].email, password: PEOPLE[who].password }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const r = await fetch(`${BASE_URL}/api/auth/password`, {
      method: "POST",
      headers: { ...h, cookie },
      body: JSON.stringify({ currentPassword: PEOPLE[who].password, newPassword: PEOPLE[who].password }),
    });
    if (!r.ok) throw new Error(`password change for ${id} failed`);
  }
  const client = await call<{ id: string }>("POST", "/clients", {
    name: "Drakenstein Municipality",
    rate: 95000,
  });
  const project = await call<{ id: string }>("POST", "/projects", {
    clientId: client.id,
    name: "Paarl bridge upgrade",
    budgetMinutes: 6000,
  });
  await call("POST", "/projects", { parentId: project.id, name: "Detailed design" });
  // Tasks are items in the project tree (0.2).
  await call("POST", "/projects", { parentId: project.id, name: "Site visit", kind: "Task" });
  for (const id of [mgr.id, member.id]) {
    await call("PUT", `/projects/${project.id}/members/${id}`, {
      role: id === mgr.id ? "manager" : "member",
    });
  }
}
