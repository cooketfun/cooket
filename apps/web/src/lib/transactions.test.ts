import { afterEach, describe, expect, it } from "vitest";
import { canCreateToken, clearPendingTrade, idleTransaction, MAX_IMAGE_BYTES, parseDevBuyNativeUsdcAmount, pendingTradeKey, persistPendingTrade, readPendingTrade, validateCreateToken, type TradeTransactionStatus, type TransactionStatus } from "./transactions";

afterEach(() => localStorage.clear());

describe("transaction foundation", () => {
  it("defines distinct lifecycle states", () => {
    const states: TransactionStatus[] = ["idle", "preparing", "awaiting_wallet", "submitted", "confirming", "confirmed", "failed", "rejected", "dev_buy_preparing", "dev_buy_awaiting_wallet", "dev_buy_submitted", "dev_buy_confirming", "dev_buy_confirmed", "dev_buy_failed", "dev_buy_rejected"];
    expect(new Set(states).size).toBe(15);
    expect(idleTransaction.status).toBe("idle");
    expect(states).toContain("failed");
    expect(states).toContain("rejected");
  });

  it("defines the required trade transaction state machine", () => {
    const states: TradeTransactionStatus[] = ["idle", "preparing", "awaiting_approval", "approval_confirming", "approval_confirmed", "preparing_sell", "awaiting_sell_signature", "awaiting_wallet", "submitted", "confirming", "confirmation_unknown", "confirmed", "reverted", "replaced", "rejected", "expired", "failed"];
    expect(new Set(states).size).toBe(17);
  });

  it("persists and isolates pending trades by wallet and token", () => {
    const wallet = "0x0000000000000000000000000000000000000001" as const;
    const token = "0x0000000000000000000000000000000000000002" as const;
    const hash = `0x${"ab".repeat(32)}` as const;
    const recovery = { sender: wallet, nonce: 3, to: token, value: "0", input: "0x1234", nextScanBlock: "99" } as const;
    persistPendingTrade({ version: 1, walletAddress: wallet, tokenAddress: token, side: "sell", hash, status: "confirmation_unknown", submittedAt: 1, recovery });
    expect(readPendingTrade(token, wallet)).toMatchObject({ side: "sell", hash, status: "confirmation_unknown", recovery });
    expect(readPendingTrade(token, "0x0000000000000000000000000000000000000003")).toBeNull();
    expect(localStorage.getItem(pendingTradeKey(token, wallet))).not.toBeNull();
    clearPendingTrade(token, wallet);
    expect(readPendingTrade(token, wallet)).toBeNull();
  });

  it("selects Arc Testnet while authentication and idle guards remain intact", () => {
    expect(canCreateToken(5042002, true, false)).toBe(true);
    expect(canCreateToken(1, true, false)).toBe(false);
    expect(canCreateToken(5042002, false, false)).toBe(false);
    expect(canCreateToken(5042002, true, true)).toBe(false);
  });

  it("validates metadata and image constraints", () => {
    const valid = { name: "Cooket", symbol: "ZK", description: "A token", websiteUrl: "https://cooket.fun", xUrl: "https://x.com/cooket", telegramUrl: "https://t.me/cooket", discordUrl: "https://discord.gg/cooket", imageFile: new File(["ok"], "token.png", { type: "image/png" }), imageUrl: "", imageSource: "file" as const, devBuyNativeUsdc: "" };
    expect(validateCreateToken(valid)).toEqual({});
    expect(validateCreateToken({ ...valid, description: "", websiteUrl: "", xUrl: "", telegramUrl: "", discordUrl: "" })).toEqual({});
    expect(validateCreateToken({ ...valid, xUrl: "https://example.com/cooket" }).xUrl).toMatch(/X\/Twitter/);
    expect(validateCreateToken({ ...valid, imageFile: new File(["bad"], "token.svg", { type: "image/svg+xml" }) }).image).toMatch(/PNG/);
    expect(validateCreateToken({ ...valid, imageFile: new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "large.png", { type: "image/png" }) }).image).toMatch(/5 MB/);
    expect(validateCreateToken({ ...valid, imageSource: "url", imageFile: null, imageUrl: "http://example.com/image.png" }).image).toMatch(/HTTPS/);
    expect(validateCreateToken({ ...valid, imageSource: "url", imageFile: null, imageUrl: "https://example.com/image.png" })).toEqual({});
    expect(validateCreateToken({ ...valid, devBuyNativeUsdc: "0.1" })).toEqual({});
  });

  it("parses arbitrary native USDC amounts at exactly 18 decimals without a product cap", () => {
    expect(parseDevBuyNativeUsdcAmount("")).toBe(BigInt(0));
    expect(parseDevBuyNativeUsdcAmount("0")).toBe(BigInt(0));
    expect(parseDevBuyNativeUsdcAmount("0.1")).toBe(BigInt("100000000000000000"));
    expect(parseDevBuyNativeUsdcAmount("1")).toBe(BigInt("1000000000000000000"));
    expect(parseDevBuyNativeUsdcAmount("100")).toBe(BigInt("100000000000000000000"));
    expect(parseDevBuyNativeUsdcAmount("1.123456789012345678")).toBe(BigInt("1123456789012345678"));
    expect(parseDevBuyNativeUsdcAmount("1000000000000000000000000000000")).toBe(BigInt("1000000000000000000000000000000000000000000000000"));
  });

  it.each(["-1", "1e3", "1.1234567890123456789", "1..2", ".1", "1.", "nope"])("rejects invalid native USDC Dev buy input %s", (value) => {
    expect(() => parseDevBuyNativeUsdcAmount(value)).toThrow();
  });
});
