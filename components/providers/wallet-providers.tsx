"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, type State } from "wagmi";
import { watchAccount, watchChainId } from "wagmi/actions";
import { WalletSessionGuard } from "@/components/providers/wallet-session-guard";
import { WalletAuthProvider } from "@/hooks/use-wallet-auth";
import { wagmiConfig } from "@/lib/wallet/config";
import { bumpWalletReviewContextRevision } from "@/lib/transfers/review-context-revision";

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
        <WalletReviewContextWatcher />
        <WalletSessionGuard />
        <WalletAuthProvider>{children}</WalletAuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function WalletReviewContextWatcher() {
  useEffect(() => {
    const unwatchAccount = watchAccount(wagmiConfig, {
      onChange(account, previousAccount) {
        if (account.address?.toLowerCase() !== previousAccount.address?.toLowerCase()) {
          bumpWalletReviewContextRevision();
        }
      },
    });
    const unwatchChain = watchChainId(wagmiConfig, {
      onChange(chainId, previousChainId) {
        if (chainId !== previousChainId) bumpWalletReviewContextRevision();
      },
    });
    return () => {
      unwatchAccount();
      unwatchChain();
    };
  }, []);
  return null;
}
