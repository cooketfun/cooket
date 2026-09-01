import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("product logo identity", () => {
  it("uses the supplied Cooket mark and derived app icon", () => {
    const navigation = readFileSync(resolve(process.cwd(), "src/components/navigation.tsx"), "utf8");
    const logo = readFileSync(resolve(process.cwd(), "public/brand/cooket.png"));
    const icon = readFileSync(resolve(process.cwd(), "public/brand/cooket-icon.png"));
    expect(navigation).toContain('src="/brand/cooket.png"');
    expect(navigation).toContain('data-logo-source="/brand/cooket.png"');
    expect(logo.byteLength).toBeGreaterThan(0);
    expect(icon.byteLength).toBeGreaterThan(0);
  });
});
