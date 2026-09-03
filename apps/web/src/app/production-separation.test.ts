import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("split production configuration", () => {
  it("keeps the VPS backend compose file free of a frontend service", () => {
    const production = readFileSync(resolve(process.cwd(), "../../compose.production.yaml"), "utf8");
    expect(production).not.toMatch(/^  web:/m);
    expect(production).toContain("127.0.0.1:4200:4000");
    expect(production).not.toContain("15436:5432");
  });
  it("makes Vercel production environment requirements explicit", () => {
    const config = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toContain('process.env.VERCEL_ENV === "production"');
    expect(config).toContain("NEXT_PUBLIC_REOWN_PROJECT_ID");
    expect(config).toContain("https://cooket.fun");
    expect(config).toContain("https://api.cooket.fun");
  });
});
