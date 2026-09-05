import { isSelectedCooketChain } from "@/lib/chain";

export type TransactionStatus = "idle" | "preparing" | "awaiting_wallet" | "submitted" | "confirming" | "confirmed" | "failed" | "rejected" | "dev_buy_preparing" | "dev_buy_awaiting_wallet" | "dev_buy_submitted" | "dev_buy_confirming" | "dev_buy_confirmed" | "dev_buy_failed" | "dev_buy_rejected";
export type TransactionState = { status: TransactionStatus; hash?: `0x${string}`; error?: string };
export const idleTransaction: TransactionState = { status: "idle" };

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type CreateTokenInput = { name: string; symbol: string; description: string; websiteUrl: string; xUrl: string; telegramUrl: string; discordUrl: string; imageFile: File | null; imageUrl: string; imageSource: "file" | "url"; devBuyNativeUsdc: string };

export const DEFAULT_BUY_SLIPPAGE_BPS = 100;

const SOCIAL_HOSTS = {
  xUrl: ["x.com", "twitter.com"],
  telegramUrl: ["t.me", "telegram.me"],
  discordUrl: ["discord.gg", "discord.com"],
} as const;

export function validateCreateToken(input: CreateTokenInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  const symbol = input.symbol.trim();
  const description = input.description.trim();
  if (!name || new TextEncoder().encode(name).length > 64) errors.name = "Name must be between 1 and 64 bytes.";
  if (!symbol || new TextEncoder().encode(symbol).length > 16) errors.symbol = "Symbol must be between 1 and 16 bytes.";
  if (new TextEncoder().encode(description).length > 1000) errors.description = "About must be at most 1000 bytes.";
  validateOptionalURL(input.websiteUrl, "websiteUrl", errors);
  validateOptionalURL(input.xUrl, "xUrl", errors, SOCIAL_HOSTS.xUrl);
  validateOptionalURL(input.telegramUrl, "telegramUrl", errors, SOCIAL_HOSTS.telegramUrl);
  validateOptionalURL(input.discordUrl, "discordUrl", errors, SOCIAL_HOSTS.discordUrl);
  if (input.imageSource === "file") {
    if (!input.imageFile) errors.image = "Select a token image.";
    else if (!ACCEPTED_IMAGE_TYPES.includes(input.imageFile.type as typeof ACCEPTED_IMAGE_TYPES[number])) errors.image = "Use PNG, JPEG, WebP, or GIF.";
    else if (input.imageFile.size > MAX_IMAGE_BYTES) errors.image = "Image must be at most 5 MB.";
  } else {
    const imageURL = input.imageUrl.trim();
    if (!imageURL) errors.image = "Enter an image URL.";
    else if (!isHTTPSImageURL(imageURL)) errors.image = "Image URL must use HTTPS.";
  }
  if (input.devBuyNativeUsdc.trim()) {
    try { parseDevBuyNativeUsdcAmount(input.devBuyNativeUsdc); }
    catch (error) { errors.devBuyNativeUsdc = error instanceof Error ? error.message : "Enter a valid Dev buy amount."; }
  }
  return errors;
}

export function parseDevBuyNativeUsdcAmount(value: string): bigint {
  const trimmed = value.trim();
  if (!trimmed) return BigInt(0);
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) throw new Error("Enter a valid non-negative native USDC amount without scientific notation.");
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > 18) throw new Error("Native USDC amounts support at most 18 decimal places.");
  return BigInt(whole) * BigInt("1000000000000000000") + BigInt((fraction + "0".repeat(18)).slice(0, 18));
}

export class DevBuyFailure extends Error {
  constructor(
    message: string,
    public readonly tokenAddress: `0x${string}`,
    public readonly creationHash: `0x${string}`,
    public readonly retryDevBuy: (report: (state: TransactionState) => void) => Promise<`0x${string}`>,
    public readonly retryable: boolean,
    public readonly buyHash?: `0x${string}`,
    public readonly rejected = false,
  ) {
    super(message);
    this.name = "DevBuyFailure";
  }
}

export function isHTTPSImageURL(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && Boolean(parsed.hostname) && value.length <= 2048;
  } catch {
    return false;
  }
}

function validateOptionalURL(value: string, field: string, errors: Record<string, string>, allowedHosts?: readonly string[]) {
  const trimmed = value.trim();
  if (!trimmed) return;
  try {
    const parsed = new URL(trimmed);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password || !parsed.hostname || trimmed.length > 2048) throw new Error();
    if (allowedHosts && !allowedHosts.some((host) => parsed.hostname.toLowerCase() === host || parsed.hostname.toLowerCase().endsWith(`.${host}`))) throw new Error();
  } catch {
    const label = field === "xUrl" ? "X/Twitter" : field === "telegramUrl" ? "Telegram" : field === "discordUrl" ? "Discord" : "Website";
    errors[field] = `${label} must be a valid ${allowedHosts ? "matching " : ""}http or https URL.`;
  }
}

export const canCreateToken = (chainId: number | undefined, walletConnected: boolean, pending: boolean) => isSelectedCooketChain(chainId) && walletConnected && !pending;

export type TradeTransactionStatus =
  | "idle"
  | "preparing"
  | "awaiting_approval"
  | "approval_confirming"
  | "approval_confirmed"
  | "preparing_sell"
  | "awaiting_sell_signature"
  | "awaiting_wallet"
  | "submitted"
  | "confirming"
  | "confirmation_unknown"
  | "confirmed"
  | "reverted"
  | "replaced"
  | "rejected"
  | "expired"
  | "failed";

export type TradeSide = "buy" | "sell";

export type TradeRecovery = {
  sender: `0x${string}`;
  nonce: number;
  to?: `0x${string}`;
  value: string;
  input: `0x${string}`;
  nextScanBlock: string;
};

export type PendingTrade = {
  version: 1;
  walletAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  side: TradeSide;
  hash?: `0x${string}`;
  status: "submitted" | "confirming" | "confirmation_unknown";
  submittedAt: number;
  recovery?: TradeRecovery;
};

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function pendingTradeKey(token: `0x${string}`, wallet: `0x${string}`) {
  return `cooket:pending-trade:v1:${wallet.toLowerCase()}:${token.toLowerCase()}`;
}

export function persistPendingTrade(trade: PendingTrade) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(pendingTradeKey(trade.tokenAddress, trade.walletAddress), JSON.stringify(trade));
}

export function readPendingTrade(token: `0x${string}`, wallet: `0x${string}`): PendingTrade | null {
  if (typeof window === "undefined") return null;
  const key = pendingTradeKey(token, wallet);
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isPendingTrade(value)) throw new Error("invalid pending trade");
    if (value.tokenAddress.toLowerCase() !== token.toLowerCase() || value.walletAddress.toLowerCase() !== wallet.toLowerCase()) {
      throw new Error("pending trade identity mismatch");
    }
    return value;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

export function clearPendingTrade(token: `0x${string}`, wallet: `0x${string}`) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(pendingTradeKey(token, wallet));
}

function isPendingTrade(value: unknown): value is PendingTrade {
  if (typeof value !== "object" || value === null) return false;
  const trade = value as Partial<PendingTrade>;
  return trade.version === 1
    && (trade.side === "buy" || trade.side === "sell")
    && (trade.status === "submitted" || trade.status === "confirming" || trade.status === "confirmation_unknown")
    && typeof trade.walletAddress === "string" && ADDRESS_PATTERN.test(trade.walletAddress)
    && typeof trade.tokenAddress === "string" && ADDRESS_PATTERN.test(trade.tokenAddress)
    && (trade.hash === undefined || (typeof trade.hash === "string" && HASH_PATTERN.test(trade.hash)))
    && typeof trade.submittedAt === "number" && Number.isFinite(trade.submittedAt) && trade.submittedAt > 0
    && (trade.recovery === undefined || isTradeRecovery(trade.recovery));
}

function isTradeRecovery(value: unknown): value is TradeRecovery {
  if (typeof value !== "object" || value === null) return false;
  const recovery = value as Partial<TradeRecovery>;
  return typeof recovery.sender === "string" && ADDRESS_PATTERN.test(recovery.sender)
    && typeof recovery.nonce === "number" && Number.isSafeInteger(recovery.nonce) && recovery.nonce >= 0
    && (recovery.to === undefined || (typeof recovery.to === "string" && ADDRESS_PATTERN.test(recovery.to)))
    && typeof recovery.value === "string" && /^\d+$/.test(recovery.value)
    && typeof recovery.input === "string" && /^0x[0-9a-fA-F]*$/.test(recovery.input)
    && typeof recovery.nextScanBlock === "string" && /^\d+$/.test(recovery.nextScanBlock);
}
