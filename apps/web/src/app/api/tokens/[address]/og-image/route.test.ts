import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: { token: vi.fn() } }));

import { api } from "@/lib/api";
import { fallbackLogoPath } from "@/lib/token-sharing";
import { GET } from "./route";

describe("token OG fallback route", () => {
  it("serves a token without an image from an existing public Cooket asset", async () => {
    vi.mocked(api.token).mockResolvedValue({ image_url: undefined } as never);
    const response = await GET(new Request("https://cooket.fun/api/tokens/0x123/og-image"), { params: Promise.resolve({ address: "0x123" }) });

    expect(existsSync(resolve(process.cwd(), "public", fallbackLogoPath.slice(1)))).toBe(true);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("still returns the existing fallback when token metadata is unavailable", async () => {
    vi.mocked(api.token).mockRejectedValue(new Error("unavailable"));
    const response = await GET(new Request("https://cooket.fun/api/tokens/0x123/og-image"), { params: Promise.resolve({ address: "0x123" }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });
});
