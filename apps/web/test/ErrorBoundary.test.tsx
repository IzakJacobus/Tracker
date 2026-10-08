import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ErrorBoundary } from "../src/app/ErrorBoundary.tsx";

function Boom(): never {
  throw new Error("Notification is not defined");
}

describe("ErrorBoundary", () => {
  test("shows what went wrong instead of a blank screen", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong showing this screen");
    expect(screen.getByRole("alert")).toHaveTextContent("Notification is not defined");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start fresh on this computer" })).toBeInTheDocument();
    spy.mockRestore();
  });

  test("shows the app when nothing is wrong", () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeInTheDocument();
  });
});
