"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { cookieToInitialState, WagmiProvider, type Config } from "wagmi";
import "@/providers/appkit-initializer";
import { reownProject, wagmiConfig } from "@/lib/wallet";
import { ActiveWalletProvider } from "@/providers/active-wallet-provider";
import { OraclePriceProvider } from "@/providers/oracle-price-provider";

export function AppProviders({ children, cookies }: { children: ReactNode; cookies: string | null }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } }));
  if (!reownProject.configured) return <ReownConfigurationError reason={reownProject.reason} />;
  const initialState = cookieToInitialState(wagmiConfig as Config, cookies);
  return (
    <WagmiProvider config={wagmiConfig as Config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <ActiveWalletProvider>
          <OraclePriceProvider>{children}</OraclePriceProvider>
        </ActiveWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function ReownConfigurationError({ reason }: { reason: string }) {
  const detail = process.env.NODE_ENV === "production"
    ? "External wallet connection is temporarily unavailable. The public Reown project ID must be configured."
    : `${reason} Add the browser-public Reown project ID to NEXT_PUBLIC_REOWN_PROJECT_ID and restart the web app.`;
  return <main className="grid min-h-dvh place-items-center bg-[#02060c] p-6"><section className="status-box status-error max-w-lg" role="alert"><h1 className="font-semibold text-white">External wallet connection is not configured</h1><p className="mt-2 text-sm leading-6">{detail}</p></section></main>;
}
