/**
 * Pure provider identification for supported wallets.
 * Used by connectors and tests — no network I/O.
 */

export type EthereumProviderLike = {
  isMetaMask?: boolean;
  isRabby?: boolean;
  isOkxWallet?: boolean;
  isOKExWallet?: boolean;
  isPhantom?: boolean;
  isBraveWallet?: boolean;
  isApexWallet?: boolean;
  isAvalanche?: boolean;
  isBitKeep?: boolean;
  isBlockWallet?: boolean;
  isKuCoinWallet?: boolean;
  isMathWallet?: boolean;
  isOneInchIOSWallet?: boolean;
  isOneInchAndroidWallet?: boolean;
  isOpera?: boolean;
  isPortal?: boolean;
  isTokenPocket?: boolean;
  isTokenary?: boolean;
  isUniswapWallet?: boolean;
  isZerion?: boolean;
  providers?: EthereumProviderLike[];
  /** MetaMask-specific internal fields (used to reject Brave imposters). */
  _events?: unknown;
  _state?: unknown;
};

/** Flags that mark a provider as "not real MetaMask". */
export const METAMASK_IMPOSTER_FLAGS = [
  "isApexWallet",
  "isAvalanche",
  "isBitKeep",
  "isBlockWallet",
  "isKuCoinWallet",
  "isMathWallet",
  "isOkxWallet",
  "isOKExWallet",
  "isOneInchIOSWallet",
  "isOneInchAndroidWallet",
  "isOpera",
  "isPhantom",
  "isPortal",
  "isRabby",
  "isTokenPocket",
  "isTokenary",
  "isUniswapWallet",
  "isZerion",
] as const;

export function isPhantomProvider(
  provider: EthereumProviderLike | null | undefined,
): boolean {
  if (!provider) return false;
  return provider.isPhantom === true;
}

export function isRabbyProvider(
  provider: EthereumProviderLike | null | undefined,
): boolean {
  if (!provider) return false;
  return provider.isRabby === true;
}

export function isOkxProvider(
  provider: EthereumProviderLike | null | undefined,
): boolean {
  if (!provider) return false;
  return provider.isOkxWallet === true || provider.isOKExWallet === true;
}

/**
 * Positive MetaMask identification.
 * Requires isMetaMask and excludes known imposters (Phantom, Rabby, OKX, etc.).
 */
export function isMetaMaskProvider(
  provider: EthereumProviderLike | null | undefined,
): boolean {
  if (!provider) return false;
  if (provider.isMetaMask !== true) return false;

  // Brave tries to look like MetaMask
  if (provider.isBraveWallet && !provider._events && !provider._state) {
    return false;
  }

  for (const flag of METAMASK_IMPOSTER_FLAGS) {
    if (provider[flag as keyof EthereumProviderLike]) {
      return false;
    }
  }

  return true;
}

export function isGenericEthereumProviderOnly(
  provider: EthereumProviderLike | null | undefined,
): boolean {
  if (!provider) return false;
  return (
    !isMetaMaskProvider(provider) &&
    !isRabbyProvider(provider) &&
    !isOkxProvider(provider) &&
    !isPhantomProvider(provider)
  );
}

/**
 * Find a provider among window.ethereum and its providers[] multiprovider array.
 */
export function findEthereumProvider(
  ethereum: EthereumProviderLike | undefined,
  select: (provider: EthereumProviderLike) => boolean,
): EthereumProviderLike | undefined {
  if (!ethereum) return undefined;
  if (Array.isArray(ethereum.providers)) {
    const match = ethereum.providers.find((p) => select(p));
    if (match) return match;
  }
  if (select(ethereum)) return ethereum;
  return undefined;
}

/** Reject Phantom as a selectable Providus target. */
export function rejectPhantomProvider(
  provider: EthereumProviderLike | null | undefined,
): boolean {
  return !isPhantomProvider(provider);
}
