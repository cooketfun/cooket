import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { Token } from "@cooket/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  token: vi.fn(),
  creator: vi.fn(),
  walletHoldings: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: { ...original.api, token: apiMocks.token, creator: apiMocks.creator, walletHoldings: apiMocks.walletHoldings } };
});

import {
  CREATOR_PROFILE_REFETCH_INTERVAL_MS,
  TOKEN_DETAIL_REFETCH_INTERVAL_MS,
  WALLET_HOLDINGS_REFETCH_INTERVAL_MS,
  creatorProfileQueryKey,
  creatorProfileQueryOptions,
  synchronizeCreatedTokenQueries,
  tokenDetailQueryKey,
  tokenDetailQueryOptions,
  walletHoldingsQueryOptions,
} from "./canonical-queries";

const tokenAddress = "0x0000000000000000000000000000000000000011";
const creatorAddress = "0x0000000000000000000000000000000000000022";
const poolAddress = "0x0000000000000000000000000000000000000033";

function token(overrides: Partial<Token> = {}): Token {
  return {
    address: tokenAddress,
    creator: creatorAddress,
    name: "Cooket",
    symbol: "CKT",
    initial_supply: "1000000000000000000",
    created_at: { block_number: 100, transaction_hash: "0xabc", log_index: 1 },
    metrics: { trade_count: 0, buy_count: 0, sell_count: 0, volume: "0", fees: "0", unique_trader_count: 0, latest_trade_timestamp: null, current_price: null, fully_diluted_value: null, holder_count: 0 },
    curve: { address: "0x0000000000000000000000000000000000000044", sold_supply: "0", reserve_balance: "0", lifecycle: "active" },
    indexed_through_block: 100,
    ...overrides,
  };
}

function testClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

function wrapper(client: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

async function flushQuery() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("canonical API query reconciliation", () => {
  it("reconciles an active token to graduated on the mounted query interval", async () => {
    vi.useFakeTimers();
    const active = token();
    const graduated = token({
      indexed_through_block: 120,
      curve: { ...active.curve!, lifecycle: "graduated", canonical_pool_address: poolAddress },
      graduation: { phase: "graduated", canonical_pool_address: poolAddress },
    });
    let resolveGraduated: ((value: Token) => void) | undefined;
    apiMocks.token.mockResolvedValueOnce(active).mockImplementationOnce(() => new Promise((resolve) => { resolveGraduated = resolve; }));
    const client = testClient();
    const hook = renderHook(() => useQuery(tokenDetailQueryOptions(tokenAddress, true)), { wrapper: wrapper(client) });

    await flushQuery();
    expect(hook.result.current.data?.graduation).toBeUndefined();
    expect(apiMocks.token).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(TOKEN_DETAIL_REFETCH_INTERVAL_MS - 1); });
    expect(apiMocks.token).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await act(async () => { resolveGraduated?.(graduated); });
    await flushQuery();

    expect(apiMocks.token).toHaveBeenCalledTimes(2);
    expect(hook.result.current.data?.graduation?.phase).toBe("graduated");
    expect(hook.result.current.data?.graduation?.canonical_pool_address).toBe(poolAddress);
  });

  it("discovers a newly indexed creator token without remounting or tight polling", async () => {
    vi.useFakeTimers();
    const prior = token({ address: "0x0000000000000000000000000000000000000055" });
    const created = token();
    const updatedProfile = { address: creatorAddress, token_count: 2, volume: "0", tokens: [created, prior] };
    let resolveUpdatedProfile: ((value: typeof updatedProfile) => void) | undefined;
    apiMocks.creator
      .mockResolvedValueOnce({ address: creatorAddress, token_count: 1, volume: "0", tokens: [prior] })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveUpdatedProfile = resolve; }));
    const client = testClient();
    const hook = renderHook(() => useQuery(creatorProfileQueryOptions("creator", creatorAddress, 12, true)), { wrapper: wrapper(client) });

    await flushQuery();
    expect(hook.result.current.data?.tokens).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(CREATOR_PROFILE_REFETCH_INTERVAL_MS - 1); });
    expect(apiMocks.creator).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await act(async () => { resolveUpdatedProfile?.(updatedProfile); });
    await flushQuery();

    expect(apiMocks.creator).toHaveBeenCalledTimes(2);
    expect(hook.result.current.data?.tokens.map((item) => item.address)).toEqual([tokenAddress, prior.address]);
    expect(TOKEN_DETAIL_REFETCH_INTERVAL_MS).toBeGreaterThanOrEqual(15_000);
    expect(CREATOR_PROFILE_REFETCH_INTERVAL_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("reconciles wallet holdings on the bounded visible-page interval", async () => {
    vi.useFakeTimers();
    apiMocks.walletHoldings.mockResolvedValue({ indexed_through_block: 120, items: [] });
    const client = testClient();
    const hook = renderHook(() => useInfiniteQuery(walletHoldingsQueryOptions(creatorAddress, 24, true)), { wrapper: wrapper(client) });
    await flushQuery();
    expect(hook.result.current.data?.pages[0]?.indexed_through_block).toBe(120);
    expect(apiMocks.walletHoldings).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(WALLET_HOLDINGS_REFETCH_INTERVAL_MS - 1); });
    expect(apiMocks.walletHoldings).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await flushQuery();
    expect(apiMocks.walletHoldings).toHaveBeenCalledTimes(2);
    expect(WALLET_HOLDINGS_REFETCH_INTERVAL_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("hydrates the created token and invalidates every relevant canonical collection", async () => {
    const client = testClient();
    const created = token();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await synchronizeCreatedTokenQueries(client, created);

    expect(client.getQueryData(tokenDetailQueryKey(tokenAddress))).toEqual(created);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      tokenDetailQueryKey(tokenAddress),
      creatorProfileQueryKey("creator", creatorAddress),
      creatorProfileQueryKey("public-creator", creatorAddress),
      ["wallet-holdings", creatorAddress],
      ["tokens"],
      ["trending"],
    ]);
  });
});
