import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalTokenURL, fallbackLogoPath, fallbackTokenImageURL, tokenMetadata, tokenSocialImageURL } from "./token-sharing";

const token = { address: "0x1234567890123456789012345678901234567890", name: "Cookie Coin", symbol: "COOKIE", description: "Fresh from the oven.", image_url: "/uploads/cookie.png" };

describe("token sharing metadata", () => {
  it("uses the canonical token URL and the indexed token image first", () => {
    const metadata = tokenMetadata(token);
    const canonical = "https://cooket.fun/token/0x1234567890123456789012345678901234567890";
    expect(canonicalTokenURL(token.address)).toBe(canonical);
    expect(metadata.alternates?.canonical).toBe(canonical);
    expect(metadata.openGraph).toMatchObject({ url: canonical, type: "website" });
    expect(metadata.openGraph?.images).toEqual([{ url: "https://api.cooket.fun/uploads/cookie.png", alt: "Cookie Coin (COOKIE)" }]);
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", images: ["https://api.cooket.fun/uploads/cookie.png"] });
    expect(metadata.title).toBe("Cookie Coin (COOKIE) | Cooket");
  });

  it("uses the OG fallback route only for missing, invalid, or non-public images", () => {
    expect(tokenSocialImageURL("https://images.example/token.png")).toBe("https://images.example/token.png");
    expect(tokenSocialImageURL("javascript:alert(1)")).toBeUndefined();
    expect(tokenSocialImageURL("http://images.example/token.png")).toBeUndefined();
    const metadata = tokenMetadata({ ...token, description: "", image_url: "javascript:alert(1)" });
    expect(metadata.description).toBe("Cookie Coin (COOKIE) is a token on Cooket.");
    expect(metadata.openGraph?.images).toEqual([{ url: fallbackTokenImageURL(token.address), alt: "Cookie Coin (COOKIE)" }]);
    expect(fallbackTokenImageURL(token.address)).toBe("https://cooket.fun/api/tokens/0x1234567890123456789012345678901234567890/og-image");
  });

  it("redirects fallback metadata to an existing public Cooket asset", () => {
    expect(fallbackLogoPath).toBe("/brand/cooket.png");
    expect(existsSync(resolve(process.cwd(), "public", fallbackLogoPath.slice(1)))).toBe(true);
  });
});
