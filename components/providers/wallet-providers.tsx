"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, type State } from "wagmi";
import { WalletSessionGuard } from "@/components/providers/wallet-session-guard";
import { wagmiConfig } from "@/lib/wallet/config";

type WalletProvidersProps = {
  children: ReactNode;
  /** Optional SSR cookie hydration from wagmi cookieStorage. */
  initialState?: State;
};

/**
 * Client-only wallet providers. QueryClient is created once per mount.
 * Do not import server-only Paycrest modules here.
 */
export function WalletProviders({
  children,
  initialState,
}: WalletProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <WalletSessionGuard />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
