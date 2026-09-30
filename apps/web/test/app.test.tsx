import { render, screen } from "@testing-library/react";
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

  test("tells people on other computers to finish setup on the server", async () => {
    mockFetch({
      "/auth/me": { status: 401, body: { error: { code: "unauthorized", message: "Please sign in." } } },
      "/setup/status": { status: 200, body: { setupComplete: false, fromServerPc: false } },
    });
    render(<App />);
    expect(await screen.findByText("Finish setup on the server computer")).toBeInTheDocument();
  });
});
