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
