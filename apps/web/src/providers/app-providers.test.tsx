import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppProviders } from "./app-providers";

describe("AppProviders configuration boundary", () => {
  it("renders an actionable safe error when NEXT_PUBLIC_REOWN_PROJECT_ID is missing", () => {
    render(<AppProviders cookies={null}><p>application</p></AppProviders>);
    expect(screen.getByRole("alert").textContent).toMatch(/NEXT_PUBLIC_REOWN_PROJECT_ID is missing.*browser-public Reown project ID.*restart/i);
    expect(screen.queryByText("application")).toBeNull();
  });
});
