/**
 * Pure-helper self-check for wallet utilities (P2 + P2.1).
 * Run: npm run test:wallet-helpers
 */

import assert from "node:assert/strict";
import {
  formatTokenAmount,
  isValidAddress,
  truncateAddress,
} from "@/lib/wallet/format";
import {
  getWalletReadiness,
  normalizeWalletStatus,
} from "@/lib/wallet/guards";
import {
  isGenericEthereumProviderOnly,
  isMetaMaskProvider,
  isOkxProvider,
  isPhantomProvider,
  isRabbyProvider,
  METAMASK_IMPOSTER_FLAGS,
  rejectPhantomProvider,
} from "@/lib/wallet/provider-identity";
import {
  shouldInvalidateConnectorSession,
} from "@/lib/wallet/session-migration";
import {
  isSupportedConnectorId,
  isUnsupportedPersistedConnectorId,
  SUPPORTED_WALLET_ORDER,
  SUPPORTED_WALLETS,
} from "@/lib/wallet/supported-wallets";

function run() {
  // --- Format helpers ---
  assert.equal(
    truncateAddress("0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa"),
    "0x21E5…bcDa",
  );
  assert.equal(formatTokenAmount(BigInt(1_000_000), 6), "1");
  assert.equal(formatTokenAmount(BigInt(1_500_000), 6), "1.5");
  assert.equal(
    formatTokenAmount(BigInt("1234567890123456789"), 18, { maxFractional: 4 }),
    "1.2345",
  );
  assert.equal(isValidAddress("0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa"), true);
  assert.equal(isValidAddress("not-an-address"), false);

  // --- Chain status ---
  assert.equal(
    normalizeWalletStatus({
      isConnected: false,
      isConnecting: false,
      isReconnecting: false,
      address: undefined,
      chainId: undefined,
    }),
    "disconnected",
  );
  assert.equal(
    normalizeWalletStatus({
      isConnected: true,
      isConnecting: false,
      isReconnecting: false,
      address: "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa",
      chainId: 42220,
    }),
    "connected",
  );
  assert.equal(
    normalizeWalletStatus({
      isConnected: true,
      isConnecting: false,
      isReconnecting: false,
      address: "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa",
      chainId: 1,
    }),
    "wrong-network",
  );

  const ready = getWalletReadiness({
    status: "connected",
    address: "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa",
    isCeloMainnet: true,
    chainId: 42220,
  });
  assert.equal(ready.ready, true);

  // --- Supported order & allowlist ---
  assert.deepEqual([...SUPPORTED_WALLET_ORDER], ["metaMask", "rabby", "okx"]);
  assert.equal(SUPPORTED_WALLETS[0].name, "MetaMask");
  assert.equal(SUPPORTED_WALLETS[1].name, "Rabby Wallet");
  assert.equal(SUPPORTED_WALLETS[2].name, "OKX Wallet");
  assert.equal(isSupportedConnectorId("metaMask"), true);
  assert.equal(isSupportedConnectorId("rabby"), true);
  assert.equal(isSupportedConnectorId("okx"), true);
  assert.equal(isSupportedConnectorId("injected"), false);
  assert.equal(isSupportedConnectorId("phantom"), false);
  assert.equal(isSupportedConnectorId("walletConnect"), false);

  // --- Provider identity (mocked objects only) ---
  const phantom = { isMetaMask: true, isPhantom: true };
  assert.equal(isPhantomProvider(phantom), true);
  assert.equal(isMetaMaskProvider(phantom), false);
  assert.equal(rejectPhantomProvider(phantom), false);

  const metamask = {
    isMetaMask: true,
    _events: {},
    _state: { isUnlocked: true },
  };
  assert.equal(isMetaMaskProvider(metamask), true);
  assert.equal(isPhantomProvider(metamask), false);

  const rabby = { isMetaMask: true, isRabby: true };
  assert.equal(isRabbyProvider(rabby), true);
  assert.equal(isMetaMaskProvider(rabby), false);

  const okx = { isOkxWallet: true };
  assert.equal(isOkxProvider(okx), true);
  assert.equal(isMetaMaskProvider(okx), false);

  const okxLegacy = { isOKExWallet: true };
  assert.equal(isOkxProvider(okxLegacy), true);

  // False MetaMask when another wallet sets isMetaMask
  for (const flag of ["isPhantom", "isRabby", "isOkxWallet"] as const) {
    const imposter = { isMetaMask: true, [flag]: true };
    assert.equal(
      isMetaMaskProvider(imposter),
      false,
      `should reject MetaMask imposter with ${flag}`,
    );
  }

  assert.ok(METAMASK_IMPOSTER_FLAGS.includes("isPhantom"));
  assert.ok(METAMASK_IMPOSTER_FLAGS.includes("isRabby"));

  const generic = { isBraveWallet: true };
  assert.equal(isGenericEthereumProviderOnly(generic), true);
  assert.equal(isMetaMaskProvider(generic), false);

  // --- Session invalidation ---
  assert.equal(shouldInvalidateConnectorSession("injected"), true);
  assert.equal(shouldInvalidateConnectorSession("phantom"), true);
  assert.equal(shouldInvalidateConnectorSession("walletConnect"), true);
  assert.equal(shouldInvalidateConnectorSession("metaMaskSDK"), true);
  assert.equal(shouldInvalidateConnectorSession("metaMask"), false);
  assert.equal(shouldInvalidateConnectorSession("rabby"), false);
  assert.equal(shouldInvalidateConnectorSession("okx"), false);
  assert.equal(shouldInvalidateConnectorSession(null), false);

  assert.equal(isUnsupportedPersistedConnectorId("injected"), true);
  assert.equal(isUnsupportedPersistedConnectorId("metaMask"), false);

  // Celo readiness unchanged for supported path
  const blocked = getWalletReadiness({
    status: "wrong-network",
    address: "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa",
    isCeloMainnet: false,
    chainId: 1,
  });
  assert.equal(blocked.ready, false);
  if (!blocked.ready) {
    assert.equal(blocked.reason, "WRONG_NETWORK");
  }

  console.log("wallet self-check (P2.1): all assertions passed");
}

run();
