import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { App } from "../src/App.tsx";

describe("App", () => {
  test("renders the product name", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Stint" })).toBeInTheDocument();
  });
});
