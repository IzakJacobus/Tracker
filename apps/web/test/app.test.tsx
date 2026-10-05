import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { App } from "../src/App.tsx";

function mockFetch(routes: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = url.replace(/^\/api/, "");
      const r = routes[path] ?? { status: 404, body: { error: { code: "not_found", message: "nope" } } };
      return new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("App", () => {
  test("shows the sign-in form when not signed in", async () => {
    mockFetch({
      "/auth/me": { status: 401, body: { error: { code: "unauthorized", message: "Please sign in." } } },
      "/setup/status": { status: 200, body: { setupComplete: true, fromServerPc: false } },
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  test("starts the setup wizard on a fresh server", async () => {
    mockFetch({
      "/auth/me": { status: 401, body: { error: { code: "unauthorized", message: "Please sign in." } } },
      "/setup/status": { status: 200, body: { setupComplete: false, fromServerPc: true } },
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Welcome to Stint" })).toBeInTheDocument();
  });

  test("goes to sign-in if setup was finished elsewhere while the wizard was open", async () => {
    let setupDone = false;
    const unauthorized = { error: { code: "unauthorized", message: "Please sign in." } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = url.replace(/^\/api/, "");
        const json = (status: number, body: unknown) =>
          new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
        if (path === "/auth/me") return json(401, unauthorized);
        if (path === "/setup/status") return json(200, { setupComplete: setupDone, fromServerPc: true });
        if (path === "/setup" && init?.method === "POST") {
          setupDone = true; // another tab got there first
          return json(409, { error: { code: "conflict", message: "Stint is already set up." } });
        }
        return json(404, { error: { code: "not_found", message: "nope" } });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Get started" }));
    await user.type(screen.getByLabelText("Company name"), "Karoo Consulting");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(await screen.findByLabelText("Your name"), "Jaco");
    await user.type(screen.getByLabelText("Email"), "jaco@example.test");
    await user.type(screen.getByLabelText("Password"), "a long password");
    await user.type(screen.getByLabelText("Confirm password"), "a long password");
    await user.click(screen.getByRole("button", { name: "Create company" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  test("tells people on other computers to finish setup on the server", async () => {
    mockFetch({
      "/auth/me": { status: 401, body: { error: { code: "unauthorized", message: "Please sign in." } } },
      "/setup/status": { status: 200, body: { setupComplete: false, fromServerPc: false } },
    });
    render(<App />);
    expect(await screen.findByText("Finish setup on the server computer")).toBeInTheDocument();
  });
});
