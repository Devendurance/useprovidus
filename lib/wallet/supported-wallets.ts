/**
 * Authoritative allowlist and display order for Providus browser wallets.
 * Order is fixed: MetaMask → Rabby → OKX.
 */

export const SUPPORTED_WALLET_ORDER = ["metaMask", "rabby", "okx"] as const;

export type SupportedWalletId = (typeof SUPPORTED_WALLET_ORDER)[number];

export type SupportedWalletDefinition = {
  id: SupportedWalletId;
  /** Stable wagmi connector id (must match connector.id). */
  connectorId: SupportedWalletId;
  name: string;
  installUrl: string;
  /** Short hint when not installed. */
  notInstalledLabel: string;
};

export const SUPPORTED_WALLETS: readonly SupportedWalletDefinition[] = [
  {
    id: "metaMask",
    connectorId: "metaMask",
    name: "MetaMask",
    installUrl: "https://metamask.io/download/",
    notInstalledLabel: "Not installed",
  },
  {
    id: "rabby",
    connectorId: "rabby",
    name: "Rabby Wallet",
    installUrl: "https://rabby.io/",
    notInstalledLabel: "Not installed",
  },
  {
    id: "okx",
    connectorId: "okx",
    name: "OKX Wallet",
    installUrl: "https://www.okx.com/web3",
    notInstalledLabel: "Not installed",
  },
] as const;

const SUPPORTED_ID_SET = new Set<string>(SUPPORTED_WALLET_ORDER);

export function isSupportedConnectorId(
  id: string | null | undefined,
): id is SupportedWalletId {
  if (!id) return false;
  return SUPPORTED_ID_SET.has(id);
}

/** Connector ids that must never reconnect (legacy generic / phantom / WC). */
export function isUnsupportedPersistedConnectorId(
  id: string | null | undefined,
): boolean {
  if (!id) return false;
  if (isSupportedConnectorId(id)) return false;
  // Common legacy / unwanted ids
  const blocked = new Set([
    "injected",
    "phantom",
    "walletConnect",
    "walletConnectLegacy",
    "metaMaskSDK",
    "coinbaseWalletSDK",
    "coinbaseWallet",
    "safe",
    "baseAccount",
  ]);
  return blocked.has(id) || !isSupportedConnectorId(id);
}

export function getSupportedWalletById(
  id: string,
): SupportedWalletDefinition | undefined {
  return SUPPORTED_WALLETS.find((w) => w.id === id || w.connectorId === id);
}
