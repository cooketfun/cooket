import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { apiAssetURL } from "@/lib/api";
import { TradeAssetIdentity, USDC_TOKEN_LOGO_SRC } from "./trade-asset-identity";

afterEach(cleanup);

function identity(kind: "usdc" | "token") {
  return screen.getByTestId(`trade-asset-${kind}`);
}

describe("TradeAssetIdentity", () => {
  it("renders the official local USDC token logo, not an external URL", () => {
    const asset = resolve(process.cwd(), "public/brand/usdc-token.svg");
    expect(existsSync(asset)).toBe(true);
    expect(readFileSync(asset, "utf8")).toContain('fill="#0B53BF"');
    expect(USDC_TOKEN_LOGO_SRC).toBe("/brand/usdc-token.svg");
    expect(USDC_TOKEN_LOGO_SRC).not.toMatch(/^https?:/i);

    render(<TradeAssetIdentity kind="usdc" />);
    const root = identity("usdc");
    const image = root.querySelector("img");
    expect(root.textContent).toContain("USDC");
    expect(image).not.toBeNull();
    expect(image!.getAttribute("src")).toBe("/brand/usdc-token.svg");
    expect(image!.getAttribute("src")).not.toMatch(/^https?:/i);
    expect(image!.className).toMatch(/h-6/);
    expect(image!.className).toMatch(/w-6/);
    expect(image!.className).toMatch(/rounded-full/);
  });

  it("renders a creator-uploaded token image with dollar-prefixed identity", () => {
    render(<TradeAssetIdentity kind="token" symbol="MEOW" imageURL="/uploads/meow.png" />);
    const root = identity("token");
    const image = root.querySelector("img");
    expect(root.textContent).toContain("$MEOW");
    expect(image).not.toBeNull();
    expect(image!.getAttribute("src")).toBe(apiAssetURL("/uploads/meow.png"));
  });

  it("renders text-only $TOKEN when the creator did not provide an image", () => {
    render(<TradeAssetIdentity kind="token" symbol="MEOW" />);
    const root = identity("token");
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("[aria-hidden]")).toBeNull();
    expect(root.textContent).toBe("$MEOW");
  });

  it("removes a broken creator image and keeps only $TOKEN text", () => {
    render(<TradeAssetIdentity kind="token" symbol="MEOW" imageURL="/uploads/meow.png" />);
    fireEvent.error(identity("token").querySelector("img")!);
    const root = identity("token");
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("[aria-hidden]")).toBeNull();
    expect(root.textContent).toBe("$MEOW");
  });

  it("allows a replacement token image after the previous URL fails", () => {
    const { rerender } = render(<TradeAssetIdentity kind="token" symbol="MEOW" imageURL="/uploads/broken.png" />);
    fireEvent.error(identity("token").querySelector("img")!);
    expect(identity("token").querySelector("img")).toBeNull();

    rerender(<TradeAssetIdentity kind="token" symbol="MEOW" imageURL="/uploads/replacement.png" />);
    expect(identity("token").querySelector("img")?.getAttribute("src")).toBe(apiAssetURL("/uploads/replacement.png"));
  });
});
