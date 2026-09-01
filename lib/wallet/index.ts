export { CELO_CHAIN_ID, CELO_MAINNET, CELO_EXPLORER_URL, addressExplorerUrl, isCeloMainnetChainId } from "@/lib/wallet/celo";
export {
  getCeloUsdcConfig,
  isCeloUsdcConfigured,
  CANONICAL_CELO_USDC,
} from "@/lib/wallet/tokens";
export {
  getCanonicalCeloUsdc,
  matchesCanonicalCeloUsdc,
  CANONICAL_CELO_USDC_ADDRESS,
} from "@/lib/celo/usdc";
export {
  truncateAddress,
  formatTokenAmount,
  isValidAddress,
} from "@/lib/wallet/format";
export {
  getWalletReadiness,
  isWalletReadyForCeloActions,
  normalizeWalletStatus,
} from "@/lib/wallet/guards";
export {
  isMetaMaskProvider,
  isRabbyProvider,
  isOkxProvider,
  isPhantomProvider,
} from "@/lib/wallet/provider-identity";
export {
  SUPPORTED_WALLET_ORDER,
  SUPPORTED_WALLETS,
  isSupportedConnectorId,
} from "@/lib/wallet/supported-wallets";
export type {
  ProvidusWalletState,
  WalletConnectionStatus,
  WalletReadiness,
} from "@/lib/wallet/types";
