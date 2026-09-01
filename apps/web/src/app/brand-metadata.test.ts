import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const layout = readFileSync(resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
const navigation = readFileSync(resolve(process.cwd(), "src/components/navigation.tsx"), "utf8");

describe("Cooket production brand metadata", () => {
  it("ships local logo, icon, and social image assets", () => {
    for (const file of ["cooket.png", "cooket-icon.png", "cooket-og.png"]) expect(existsSync(resolve(root, "apps/web/public/brand", file))).toBe(true);
    expect(navigation).toContain('src="/brand/cooket.png"');
    expect(navigation).toContain('alt="Cooket logo"');
  });
  it("publishes Cooket metadata without an external branding asset", () => {
    expect(layout).toContain("https://testnet.cooket.fun");
    expect(layout).toContain("/brand/cooket-icon.png");
    expect(layout).toContain("/brand/cooket-og.png");
    expect(layout).toContain("Cooket | Arc Testnet development");
  });
});
