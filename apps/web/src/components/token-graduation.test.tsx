import { cleanup, render, screen } from "@testing-library/react";
import type { Token } from "@cooket/types";
import { afterEach, describe, expect, it } from "vitest";
import { TokenGraduation } from "./token-graduation";

const tokenAddress = "0x0000000000000000000000000000000000000011";
const pool = "0x0000000000000000000000000000000000000022";
const manager = "0x0000000000000000000000000000000000000033";
const custodian = "0x0000000000000000000000000000000000000044";
const graduationHash = `0x${"ab".repeat(32)}`;
const settlementHash = `0x${"cd".repeat(32)}`;

const baseToken: Token = {
  address: tokenAddress,
  creator: "0x0000000000000000000000000000000000000055",
  name: "Graduation Token",
  symbol: "GRAD",
  initial_supply: "1000000000000000000000000000",
  created_at: { block_number: 100, transaction_hash: `0x${"ef".repeat(32)}`, log_index: 1 },
  metrics: { trade_count: 1, buy_count: 1, sell_count: 0, volume: "3", fees: "0", unique_trader_count: 1, latest_trade_timestamp: null, current_price: null, fully_diluted_value: null, holder_count: 2 },
  curve: {
    address: "0x0000000000000000000000000000000000000066",
    canonical_pool_address: pool,
    sold_supply: "400000000000000000000000000",
    reserve_balance: "999000000000000000000",
    graduation_threshold: "800000000000000000000000000",
  },
};

afterEach(cleanup);

describe("TokenGraduation", () => {
  it("keeps active tokens in the bonding-curve progress state", () => {
    render(<TokenGraduation token={baseToken} />);
    expect(screen.getByText("Graduation progress")).toBeTruthy();
    expect(screen.getByText("50.00%")).toBeTruthy();
    expect(screen.queryByText("Permanent")).toBeNull();
    expect(screen.queryByText("External liquidity active")).toBeNull();
  });

  it("presents complete canonical external liquidity without treating the V3 scalar as money", () => {
    const token: Token = { ...baseToken, graduation: {
      phase: "graduated",
      canonical_pool_address: pool,
      graduation_manager_address: manager,
      lp_custodian_address: custodian,
      position_token_id: "77",
      liquidity: "12345678901234567890",
      token_amount: "200000000000000000000000000",
      native_usdc_amount: "3000000000000000000",
      sold_supply: "800000000000000000000000000",
      curve_terminal_at: { block_number: 200, transaction_hash: graduationHash, log_index: 8 },
      settled_at: { block_number: 200, transaction_hash: settlementHash, log_index: 4 },
    } };
    render(<TokenGraduation token={token} />);

    expect(screen.getByText("Graduated")).toBeTruthy();
    expect(screen.getByText("External liquidity active")).toBeTruthy();
    expect(screen.getByText("Permanent")).toBeTruthy();
    expect(screen.getByText("#77")).toBeTruthy();
    expect(screen.getByText("12,345,678,901,234,567,890")).toBeTruthy();
    expect(screen.getByText("200M GRAD")).toBeTruthy();
    expect(screen.getByText("Native USDC")).toBeTruthy();
    expect(screen.getByText("3 USDC")).toBeTruthy();
    expect(screen.getByTitle("3000000000000000000")).toBeTruthy();
    expect(screen.queryByText("Legacy ETH field (unsupported)")).toBeNull();
    expect(screen.queryByText("eth_amount")).toBeNull();
    expect(screen.queryByText("ETH")).toBeNull();
    expect(screen.getByRole("link", { name: `${pool} ↗` }).getAttribute("href")).toBe(`https://testnet.arcscan.app/address/${pool}`);
    expect(screen.getByRole("link", { name: `${custodian} ↗` }).getAttribute("href")).toBe(`https://testnet.arcscan.app/address/${custodian}`);
    expect(screen.getByRole("link", { name: "Graduation transaction ↗" }).getAttribute("href")).toBe(`https://testnet.arcscan.app/tx/${graduationHash}`);
    expect(screen.getByRole("link", { name: "Settlement transaction ↗" }).getAttribute("href")).toBe(`https://testnet.arcscan.app/tx/${settlementHash}`);
    expect(screen.queryByText(/12,345,678,901,234,567,890 ETH/)).toBeNull();
    expect(screen.queryByText(/999 ETH/)).toBeNull();
  });

  it("ignores leftover eth_amount fields and still renders native USDC", () => {
    const token = {
      ...baseToken,
      graduation: {
        phase: "graduated",
        canonical_pool_address: pool,
        token_amount: "200000000000000000000000000",
        native_usdc_amount: "3000000000000000000",
        eth_amount: "999000000000000000000",
      },
    } as Token;
    render(<TokenGraduation token={token} />);
    expect(screen.getByText("3 USDC")).toBeTruthy();
    expect(screen.queryByText("999000000000000000000")).toBeNull();
    expect(screen.queryByText("Legacy ETH field (unsupported)")).toBeNull();
    expect(screen.queryByText(/999 ETH/)).toBeNull();
  });

  it("keeps curve graduation visible without inventing missing settlement details", () => {
    const token: Token = { ...baseToken, graduation: {
      phase: "graduated",
      canonical_pool_address: pool,
      graduation_manager_address: manager,
      token_amount: "200000000000000000000000000",
      native_usdc_amount: "3000000000000000000",
      curve_terminal_at: { block_number: 200, transaction_hash: graduationHash, log_index: 8 },
    } };
    render(<TokenGraduation token={token} />);

    expect(screen.getByText("Graduated")).toBeTruthy();
    expect(screen.getByText("External settlement details are not indexed yet.")).toBeTruthy();
    expect(screen.queryByText("Position NFT")).toBeNull();
    expect(screen.queryByText("V3 liquidity")).toBeNull();
    expect(screen.queryByText("#0")).toBeNull();
    expect(screen.queryByText("0 ETH")).toBeNull();
  });
});
