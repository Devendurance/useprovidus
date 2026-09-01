/**
 * Wagmi config for Providus — Celo mainnet only.
 * Explicit MetaMask / Rabby / OKX connectors. No generic injected. No WalletConnect.
 */

import { http, createConfig, createStorage, cookieStorage } from "wagmi";
import { CELO_MAINNET } from "@/lib/wallet/celo";
import { createSupportedWalletConnectors } from "@/lib/wallet/connectors";

export const wagmiConfig = createConfig({
  chains: [CELO_MAINNET],
  connectors: createSupportedWalletConnectors(),
  transports: {
    [CELO_MAINNET.id]: http(),
  },
  /**
   * Critical: do not auto-register every EIP-6963 provider (would include Phantom).
   * Only the three explicit connectors above are available.
   */
  multiInjectedProviderDiscovery: false,
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
});

export type ProvidusWagmiConfig = typeof wagmiConfig;
