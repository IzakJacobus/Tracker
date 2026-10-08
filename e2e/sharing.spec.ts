import { expect, test } from "@playwright/test";
import { BASE_URL, login, PEOPLE, waitSynced } from "./fixtures.ts";

test.setTimeout(40_000);

const h = { "content-type": "application/json", "x-stint-request": "1" };

async function adminApi() {
  const r = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ email: PEOPLE.admin.email, password: PEOPLE.admin.password }),
  });
  const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      method,
      headers: { ...h, cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  return call;
}

test("a project created while a worker is signed in shows up for them once they are added", async ({
  page,
}) => {
  await login(page, "member"); // the worker's browser stays open the whole time
  const call = await adminApi();
  const users = await call<{ id: string; email: string }[]>("GET", "/users");
  const worker = users.find((u) => u.email === PEOPLE.member.email)!;
  const clients = await call<{ id: string; name: string }[]>("GET", "/clients");
  const client = clients.find((c) => c.name === "Drakenstein Municipality")!;

  const project = await call<{ id: string }>("POST", "/projects", {
    clientId: client.id,
    name: "Weir inspection Zq",
    code: "2026-777Z",
  });
  await call("POST", "/projects", { parentId: project.id, name: "Gauge reading Zq" });

  // Not added yet: she can't see it.
  await page.keyboard.press("n");
  await page.getByPlaceholder("Search projects, items and codes").fill("weir inspection zq");
  await expect(page.getByText("Nothing matches.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Added to the project.
  await call("PUT", `/projects/${project.id}/members/${worker.id}`, {});

  // Doing something (pressing N) asks the server, so within seconds, with no reload, it is there.
  await page.waitForTimeout(500);
  await page.keyboard.press("n");
  await page.getByPlaceholder("Search projects, items and codes").fill("weir inspection zq");
  await expect(page.getByRole("option", { name: /Weir inspection Zq/ })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await waitSynced(page);

  // ...and on her Projects page.
  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page.getByText("Weir inspection Zq").first()).toBeVisible();
});

test("a project that everyone can use shows up for a signed-in worker", async ({ page }) => {
  await login(page, "member");
  const call = await adminApi();
  const clients = await call<{ id: string; name: string; isInternal: boolean }[]>("GET", "/clients");
  const internal = clients.find((c) => c.isInternal)!;
  await call("POST", "/projects", { clientId: internal.id, name: "Everyone project Y", code: "INT-Y" });
  await page.keyboard.press("n");
  await page.getByPlaceholder("Search projects, items and codes").fill("everyone project y");
  await expect(page.getByRole("option", { name: /Everyone project Y/ })).toBeVisible({ timeout: 10_000 });
});

test("a brand-new client and project: the worker can log hours on it after being added", async ({ page }) => {
  await login(page, "member");
  const call = await adminApi();
  const users = await call<{ id: string; email: string }[]>("GET", "/users");
  const worker = users.find((u) => u.email === PEOPLE.member.email)!;
  const client = await call<{ id: string }>("POST", "/clients", { name: "Brand New Client Qx" });
  const project = await call<{ id: string }>("POST", "/projects", {
    clientId: client.id,
    name: "Bridge Qx",
    code: "QX-1",
  });
  await call("PUT", `/projects/${project.id}/members/${worker.id}`, {});

  // Her Projects page shows it...
  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page.getByText("Bridge Qx").first()).toBeVisible({ timeout: 15_000 });
  // ...and so does the Log hours list, where she can pick it and log hours.
  await page.getByRole("link", { name: "Track" }).click();
  await page.keyboard.press("n");
  await page.getByPlaceholder("Search projects, items and codes").fill("bridge qx");
  await expect(page.getByRole("option", { name: /Bridge Qx/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("option", { name: /Bridge Qx/ }).click();
  await page.getByRole("dialog").getByLabel("Hours", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Log hours" }).last().click();
  await waitSynced(page);
  await expect(page.getByText("Bridge Qx").first()).toBeVisible();
});

test("added to an item only (not to the project above it): she can still log hours on that item", async ({
  page,
}) => {
  await login(page, "member");
  const call = await adminApi();
  const users = await call<{ id: string; email: string }[]>("GET", "/users");
  const worker = users.find((u) => u.email === PEOPLE.member.email)!;
  const client = await call<{ id: string }>("POST", "/clients", { name: "Item Only Client Wv" });
  const root = await call<{ id: string }>("POST", "/projects", {
    clientId: client.id,
    name: "Reactor Wv",
    code: "WV-1",
  });
  const mid = await call<{ id: string }>("POST", "/projects", { parentId: root.id, name: "Research Wv" });
  const leaf = await call<{ id: string }>("POST", "/projects", { parentId: mid.id, name: "Bla Wv" });
  await call("PUT", `/projects/${leaf.id}/members/${worker.id}`, {});

  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page.getByText("Bla Wv").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Track" }).click();
  await page.keyboard.press("n");
  await page.getByPlaceholder("Search projects, items and codes").fill("bla wv");
  await expect(page.getByRole("option", { name: /Bla Wv/ })).toBeVisible({ timeout: 15_000 });
});
