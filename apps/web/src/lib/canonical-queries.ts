"use client";

import { infiniteQueryOptions, type QueryClient, queryOptions } from "@tanstack/react-query";
import type { Token } from "@cooket/types";
import { api } from "@/lib/api";

export const TOKEN_DETAIL_REFETCH_INTERVAL_MS = 15_000;
export const CREATOR_PROFILE_REFETCH_INTERVAL_MS = 30_000;
export const WALLET_HOLDINGS_REFETCH_INTERVAL_MS = 30_000;

export function tokenDetailQueryKey(address: string) {
  return ["token", address] as const;
}

export function tokenDetailQueryOptions(address: string, enabled: boolean) {
  return queryOptions({
    queryKey: tokenDetailQueryKey(address),
    queryFn: () => api.token(address),
    enabled,
    refetchInterval: TOKEN_DETAIL_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function creatorProfileQueryKey(surface: "creator" | "public-creator", address?: string) {
  return [surface, address] as const;
}

export function creatorProfileQueryOptions(surface: "creator" | "public-creator", address: string | undefined, limit: number, enabled: boolean) {
  return queryOptions({
    queryKey: creatorProfileQueryKey(surface, address),
    queryFn: () => {
      if (!address) throw new Error("Creator address is required.");
      return api.creator(address, `?limit=${limit}`);
    },
    enabled,
    refetchInterval: CREATOR_PROFILE_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function walletHoldingsQueryKey(address?: string) {
  return ["wallet-holdings", address] as const;
}

export function walletHoldingsQueryOptions(address: string | undefined, limit: number, enabled: boolean) {
  return infiniteQueryOptions({
    queryKey: walletHoldingsQueryKey(address),
    queryFn: ({ pageParam }) => {
      if (!address) throw new Error("Wallet address is required.");
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : "";
      return api.walletHoldings(address, `?limit=${limit}${cursor}`);
    },
    initialPageParam: "",
    getNextPageParam: (page) => page.next_cursor,
    enabled,
    refetchInterval: WALLET_HOLDINGS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export async function synchronizeCreatedTokenQueries(queryClient: QueryClient, token: Token) {
  queryClient.setQueryData(tokenDetailQueryKey(token.address), token);
  await Promise.all([
    tokenDetailQueryKey(token.address),
    creatorProfileQueryKey("creator", token.creator),
    creatorProfileQueryKey("public-creator", token.creator),
    walletHoldingsQueryKey(token.creator),
    ["tokens"] as const,
    ["trending"] as const,
  ].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
