"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { api } from "@/lib/api";
import { parseEthUsdReference, type EthUsdReference } from "@/lib/format";

type OraclePriceContextValue = Readonly<{
  reference: EthUsdReference | null;
  isPending: boolean;
  isUnavailable: boolean;
}>;

const unavailableOraclePrice: OraclePriceContextValue = { reference: null, isPending: false, isUnavailable: true };
const OraclePriceContext = createContext<OraclePriceContextValue>(unavailableOraclePrice);

export function OraclePriceProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ["oracle-price", "eth-usd"],
    queryFn: api.ethUsdPrice,
    refetchInterval: 30_000,
    retry: 1,
  });
  const reference = useMemo(() => query.data ? parseEthUsdReference(query.data.price, query.data.updated_at) : null, [query.data]);
  return <OraclePriceContext.Provider value={{ reference, isPending: query.isPending, isUnavailable: query.isError || (!query.isPending && reference === null) }}>{children}</OraclePriceContext.Provider>;
}

export function useOraclePrice() {
  return useContext(OraclePriceContext);
}
