import { afterEach, describe, expect, it, vi } from "vitest";
import { api, resolvePublicApiURL } from "./api";

const emptyPage = { items: [] };
const address = "0x0000000000000000000000000000000000000011";
const pool = "0x0000000000000000000000000000000000000022";
const manager = "0x0000000000000000000000000000000000000033";
const custodian = "0x0000000000000000000000000000000000000044";
const transactionHash = `0x${"ab".repeat(32)}`;
const tokenPayload = (graduation?: Record<string, unknown>) => ({
  address,
  creator: "0x0000000000000000000000000000000000000055",
  name: "Graduation Token",
  symbol: "GRAD",
  initial_supply: "1000",
  created_at: { block_number: 1, transaction_hash: transactionHash, log_index: 0 },
  metrics: { trade_count: 0, buy_count: 0, sell_count: 0, volume: "0", fees: "0", unique_trader_count: 0, latest_trade_timestamp: null, current_price: null, fully_diluted_value: null, holder_count: null },
  curve: { address: "0x0000000000000000000000000000000000000066", canonical_pool_address: pool, sold_supply: "800", reserve_balance: "3" },
  ...(graduation ? { graduation } : {}),
});
afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("requires the intended API origin for production while preserving local development", () => {
    expect(resolvePublicApiURL(undefined, false)).toBe("http://localhost:4200");
    expect(resolvePublicApiURL("https://api.cooket.fun/", true)).toBe("https://api.cooket.fun");
    expect(() => resolvePublicApiURL(undefined, true)).toThrow(/required/i);
    expect(() => resolvePublicApiURL("https://preview.example", true)).toThrow(/api\.cooket\.fun/i);
    expect(() => resolvePublicApiURL("not-a-url", false)).toThrow(/absolute/i);
  });
  it("parses successful and empty collections", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(emptyPage), { status: 200 })));
    await expect(api.listTokens()).resolves.toEqual(emptyPage);
  });
  it("preserves normalized backend errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "not_found", message: "token not found" } }), { status: 404 })));
    await expect(api.token("0x0000000000000000000000000000000000000001")).rejects.toMatchObject({ status: 404, code: "not_found", message: "token not found" });
  });
  it("preserves normalized validation errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "invalid_request", message: "limit must be between 1 and 100" } }), { status: 400 })));
    await expect(api.listTokens("?limit=101")).rejects.toMatchObject({ status: 400, code: "invalid_request" });
  });
  it("does not expose or request the obsolete ETH/USD endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(emptyPage), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect("ethUsdPrice" in api).toBe(false);
    await api.listTokens();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/prices/eth-usd"), expect.anything());
  });
  it("normalizes malformed HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    await expect(api.listTokens()).rejects.toMatchObject({ status: 500, code: "http_error" });
  });
  it("parses V3 pricing and canonical chart payloads", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token_address: "0x1", current_price: "7", fully_diluted_value: "7000", source: "indexed_v3_curve" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ interval: "1h", supported_intervals: ["1m", "5m", "15m", "1h", "4h", "1d", "1w"], candles: [{ bucket_start: 3600, trade_count: 1, buy_count: 1, sell_count: 0, volume: "10", unique_trader_count: 1, open_price: "6", high_price: "8", low_price: "5", close_price: "7" }] }), { status: 200 })));
    await expect(api.pricing("0x1")).resolves.toMatchObject({ fully_diluted_value: "7000", source: "indexed_v3_curve" });
    await expect(api.chart("0x1")).resolves.toMatchObject({ interval: "1h", supported_intervals: ["1m", "5m", "15m", "1h", "4h", "1d", "1w"], candles: [expect.objectContaining({ open_price: "6", high_price: "8", low_price: "5", close_price: "7" })] });
  });

  it("validates the complete Phase 10A graduation payload", async () => {
    const graduation = {
      phase: "graduated",
      canonical_pool_address: pool,
      graduation_manager_address: manager,
      lp_custodian_address: custodian,
      position_token_id: "77",
      liquidity: "123456789",
      token_amount: "200000000000000000000000000",
      native_usdc_amount: "3000000000000000000",
      sold_supply: "800000000000000000000000000",
      curve_terminal_at: { block_number: 100, transaction_hash: transactionHash, log_index: 8 },
      settled_at: { block_number: 100, transaction_hash: transactionHash, log_index: 4 },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(tokenPayload(graduation)), { status: 200 })));
    await expect(api.token(address)).resolves.toMatchObject({ curve: { canonical_pool_address: pool }, graduation });
  });

  it("accepts graduated curve evidence when optional settlement fields are absent", async () => {
    const graduation = { phase: "graduated", canonical_pool_address: pool, graduation_manager_address: manager, token_amount: "200", native_usdc_amount: "3", curve_terminal_at: { block_number: 100, transaction_hash: transactionHash, log_index: 8 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(tokenPayload(graduation)), { status: 200 })));
    await expect(api.token(address)).resolves.toMatchObject({ graduation });
  });

  it("rejects malformed graduation addresses and provenance", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(tokenPayload({ phase: "graduated", lp_custodian_address: "0x1234" })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(tokenPayload({ phase: "graduated", settled_at: { block_number: 1, transaction_hash: "0xdeadbeef", log_index: 2 } })), { status: 200 })));
    await expect(api.token(address)).rejects.toMatchObject({ code: "invalid_response" });
    await expect(api.token(address)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("parses read-only CTO status, proposal, treasury, and checkpoint payloads", async () => {
    const proposalId = `0x${"ab".repeat(32)}`;
    const blockHash = `0x${"11".repeat(32)}`;
    const txHash = `0x${"22".repeat(32)}`;
    const provenance = { block_number: 9, block_hash: blockHash, transaction_hash: txHash, log_index: 3 };
    const status = { chain_id: 5042002, token: address, active: true, registry: manager, treasury: custodian, controller: pool, previous_recipient: address, active_proposal_id: proposalId, activation: provenance };
    const proposal = { proposal_id: proposalId, token: address, registry: manager, treasury: custodian, creator: address, controller: pool, previous_recipient: address, nonce: "18446744073709551615", metadata_hash: `0x${"33".repeat(32)}`, metadata_uri: "ipfs://untrusted", state: "active", created_timestamp: 1, created: provenance, acceptance_deadline: 2 };
    const treasury = { treasury: custodian, registry: manager, token: address, controller: pool, canonical_usdc: pool, nonce: "1", deployment: provenance, supported_assets: [], recent_transfers: [], recent_fee_pulls: [] };
    const checkpoints = { token: address, aggregates: [{ token: address, recipient: pool, checkpointed: "10", claimed: "1", outstanding: "9" }], items: [{ recipient: pool, action: "checkpoint", amount: "10", provenance }] };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(status), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [proposal] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposal), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(treasury), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(checkpoints), { status: 200 })));
    await expect(api.ctoStatus(address)).resolves.toEqual(status);
    await expect(api.ctoProposals(address, "?limit=20")).resolves.toEqual({ items: [proposal] });
    await expect(api.ctoProposal(proposalId)).resolves.toMatchObject({ nonce: "18446744073709551615", metadata_uri: "ipfs://untrusted" });
    await expect(api.ctoTreasury(custodian)).resolves.toEqual(treasury);
    await expect(api.ctoTreasuryTransfers(custodian, "?limit=20")).resolves.toEqual({ items: [] });
    await expect(api.ctoTreasuryFeePulls(custodian, "?limit=20")).resolves.toEqual({ items: [] });
    await expect(api.ctoCheckpoints(address, "?limit=20")).resolves.toEqual(checkpoints);
  });
});
