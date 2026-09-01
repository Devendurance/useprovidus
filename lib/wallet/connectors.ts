/**
 * Explicit targeted connectors only — no generic injected().
 * multiInjectedProviderDiscovery is disabled in config.
 */

import { injected, type CreateConnectorFn } from "wagmi";
import {
  findEthereumProvider,
  isMetaMaskProvider,
  isOkxProvider,
  isRabbyProvider,
  type EthereumProviderLike,
} from "@/lib/wallet/provider-identity";
import type { SupportedWalletId } from "@/lib/wallet/supported-wallets";

type WindowWithWallets = {
  ethereum?: EthereumProviderLike;
  okxwallet?: EthereumProviderLike;
  rabby?: { ethereum?: EthereumProviderLike };
};

function asWindow(win: unknown): WindowWithWallets | undefined {
  if (!win || typeof win !== "object") return undefined;
  return win as WindowWithWallets;
}

export function findMetaMaskProvider(
  win?: unknown,
): EthereumProviderLike | undefined {
  const w = asWindow(win);
  return findEthereumProvider(w?.ethereum, (p) => isMetaMaskProvider(p));
}

export function findRabbyProvider(
  win?: unknown,
): EthereumProviderLike | undefined {
  const w = asWindow(win);
  const fromEthereum = findEthereumProvider(w?.ethereum, (p) =>
    isRabbyProvider(p),
  );
  if (fromEthereum) return fromEthereum;
  if (w?.rabby?.ethereum && isRabbyProvider(w.rabby.ethereum)) {
    return w.rabby.ethereum;
  }
  return undefined;
}

export function findOkxProvider(
  win?: unknown,
): EthereumProviderLike | undefined {
  const w = asWindow(win);
  if (w?.okxwallet && isOkxProvider(w.okxwallet)) {
    return w.okxwallet;
  }
  return findEthereumProvider(w?.ethereum, (p) => isOkxProvider(p));
}

/** Runtime install detection (client only). */
export function detectInstalledWallets(): Record<SupportedWalletId, boolean> {
  if (typeof window === "undefined") {
    return { metaMask: false, rabby: false, okx: false };
  }
  return {
    metaMask: Boolean(findMetaMaskProvider(window)),
    rabby: Boolean(findRabbyProvider(window)),
    okx: Boolean(findOkxProvider(window)),
  };
}

export function createSupportedWalletConnectors(): CreateConnectorFn[] {
  // Explicit targets only — never injected() without target.
  // MetaMask target uses positive identification and excludes Phantom/Rabby/OKX.
  const metaMask = injected({
    shimDisconnect: true,
    target: {
      id: "metaMask",
      name: "MetaMask",
      provider(window) {
        return findMetaMaskProvider(window) as never;
      },
    },
  });

  const rabby = injected({
    shimDisconnect: true,
    target: {
      id: "rabby",
      name: "Rabby Wallet",
      provider(window) {
        return findRabbyProvider(window) as never;
      },
    },
  });

  const okx = injected({
    shimDisconnect: true,
    target: {
      id: "okx",
      name: "OKX Wallet",
      provider(window) {
        return findOkxProvider(window) as never;
      },
    },
  });

  // Fixed preference order: MetaMask → Rabby → OKX
  return [metaMask, rabby, okx];
}
