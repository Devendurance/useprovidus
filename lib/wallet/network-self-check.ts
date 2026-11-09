import assert from "node:assert/strict";
import {
  getWalletNetwork,
  getWalletNetworkByKey,
  getWalletNetworkSetup,
  getWalletBalanceTarget,
  shouldReadNetworkBalance,
  switchWalletNetwork,
  describeWalletNetworkError,
} from "@/lib/wallet/network";
import {
  getWalletAuthStatus,
  isSameWalletAddress,
  isCurrentWalletAuthRequest,
  shouldDispatchWalletSessionExpired,
  shouldRequireReauthenticationAfterAccountChange,
  walletAuthStatusCopy,
} from "@/lib/auth/wallet-ui-state";
import { isSameWalletReviewContext, type WalletReviewContext } from "@/lib/transfers/review-context";
import { beginWalletNetworkSwitch, finishWalletNetworkSwitch, getWalletNetworkSwitchSnapshot } from "@/lib/wallet/network-switch-state";
import { bumpWalletReviewContextRevision, getWalletReviewContextRevision } from "@/lib/transfers/review-context-revision";

type MockError = Error & { code?: number; cause?: unknown };

class MockedInjectedWallet {
  chainId: number;
  readonly recognized = new Set([42220]);
  readonly requests: { method: string; params?: unknown }[] = [];
  switchFailure: MockError | null = null;
  addFailure: MockError | null = null;
  afterSwitchChainId: number | null = null;
  switchAfterAdd = false;

  constructor(chainId: number) { this.chainId = chainId; }

  async switchChainAsync({ chainId }: { chainId: number }) {
    this.requests.push({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}` }] });
    if (!this.recognized.has(chainId)) {
      const network = [42220, 677, 968].map((candidateChainId) => getWalletNetwork(candidateChainId)).find((item) => item.kind === "supported" && item.chainId === chainId);
      assert.ok(network && network.kind === "supported");
      const setup = getWalletNetworkSetup(network.key);
      const { chainIdHex, ...addParameters } = setup;
      this.requests.push({ method: "wallet_addEthereumChain", params: [{ ...addParameters, chainId: chainIdHex }] });
      if (this.addFailure) throw this.addFailure;
      this.recognized.add(chainId);
      if (this.switchAfterAdd) throw new Error("User rejected switch after adding network.");
    }
    if (this.switchFailure) throw this.switchFailure;
    this.chainId = this.afterSwitchChainId ?? chainId;
    return { id: chainId };
  }

  async getChainId() { return this.chainId; }
}

function codedError(message: string, code: number): MockError {
  return Object.assign(new Error(message), { code });
}

async function main() {
  const expected = [
    [42220, "celo", "Celo Mainnet", "CELO", "https://celoscan.io/address/0x1111111111111111111111111111111111111111"],
    [677, "botMainnet", "BOT Chain Mainnet", "BOT", "https://scan.botchain.ai/address/0x1111111111111111111111111111111111111111"],
    [968, "botTestnet", "BOT Chain Testnet", "BOT", "https://scan.bohr.life/address/0x1111111111111111111111111111111111111111"],
  ] as const;
  for (const [chainId, key, name, symbol, explorer] of expected) {
    const network = getWalletNetwork(chainId, "0x1111111111111111111111111111111111111111");
    assert.equal(network.kind, "supported");
    if (network.kind !== "supported") continue;
    assert.equal(network.key, key);
    assert.equal(network.displayName, name);
    assert.equal(network.nativeSymbol, symbol);
    assert.equal(network.explorerAddressUrl, explorer);
    assert.deepEqual(getWalletBalanceTarget("0x1111111111111111111111111111111111111111", chainId), { address: "0x1111111111111111111111111111111111111111", chainId });
    assert.equal(shouldReadNetworkBalance("0x1111111111111111111111111111111111111111", chainId, true), true, `${name} exposes its own native balance`);
  }
  assert.equal(getWalletNetwork(1).kind, "unsupported");
  assert.equal(getWalletNetwork(undefined).kind, "disconnected");
  assert.equal(getWalletNetworkByKey("botMainnet").chainId, 677);
  assert.equal(getWalletNetworkByKey("botTestnet").chainId, 968);
  assert.equal(getWalletBalanceTarget("0x1111111111111111111111111111111111111111", 1), null);
  assert.equal(shouldReadNetworkBalance("0x1111111111111111111111111111111111111111", 1, true), false);
  assert.equal(shouldReadNetworkBalance(null, 968, true), false);
  assert.equal(shouldReadNetworkBalance("0x1111111111111111111111111111111111111111", 968, false), false);
  const botNetwork = getWalletNetwork(677, "0x1111111111111111111111111111111111111111");
  assert.ok(botNetwork.kind === "supported");
  if (botNetwork.kind === "supported") assert.notEqual(botNetwork.nativeSymbol, "CELO");

  const wallet = new MockedInjectedWallet(42220);
  wallet.switchAfterAdd = true;
  await switchWalletNetwork("botTestnet", wallet);
  wallet.switchAfterAdd = false;
  assert.equal(wallet.chainId, 968);
  await switchWalletNetwork("botMainnet", wallet);
  assert.equal(wallet.chainId, 677);
  await switchWalletNetwork("celo", wallet);
  assert.equal(wallet.chainId, 42220);
  assert.deepEqual(wallet.requests.map((request) => request.method), [
    "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain",
    "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain",
  ]);
  assert.equal(wallet.requests.some((request) => request.method === "eth_sendTransaction"), false);
  const added = wallet.requests.find((request) => request.method === "wallet_addEthereumChain")?.params as [{ chainId: string; chainName: string; rpcUrls: string[]; blockExplorerUrls: string[]; nativeCurrency: { symbol: string } }];
  assert.equal(added[0].chainId, "0x3c8");
  assert.equal(added[0].chainName, "BOT Chain Testnet");
  assert.deepEqual(added[0].rpcUrls, ["https://rpc.bohr.life"]);
  assert.deepEqual(added[0].blockExplorerUrls, ["https://scan.bohr.life"]);
  assert.equal(added[0].nativeCurrency.symbol, "BOT");

  const rejected = new MockedInjectedWallet(42220);
  rejected.switchFailure = codedError("User rejected the request", 4001);
  await assert.rejects(switchWalletNetwork("botTestnet", rejected));
  assert.equal(describeWalletNetworkError(rejected.switchFailure).kind, "rejected");
  assert.equal(rejected.requests.filter((request) => request.method === "wallet_switchEthereumChain").length, 1, "a rejection never triggers an automatic second prompt");

  const rejectedAfterAdd = new MockedInjectedWallet(42220);
  rejectedAfterAdd.switchAfterAdd = true;
  rejectedAfterAdd.switchFailure = codedError("User rejected the request", 4001);
  await assert.rejects(switchWalletNetwork("botTestnet", rejectedAfterAdd));
  assert.equal(rejectedAfterAdd.requests.filter((request) => request.method === "wallet_switchEthereumChain").length, 2, "only the accepted add-chain response permits one switch retry");

  const rejectedAdd = new MockedInjectedWallet(42220);
  rejectedAdd.addFailure = codedError("User rejected the request", 4001);
  await assert.rejects(switchWalletNetwork("botTestnet", rejectedAdd));
  assert.equal(rejectedAdd.requests.filter((request) => request.method === "wallet_switchEthereumChain").length, 1, "rejecting add-chain never triggers another prompt");
  assert.equal(describeWalletNetworkError(rejectedAdd.addFailure).kind, "rejected");

  const unsupportedSwitch = codedError("wallet_switchEthereumChain is not supported", 4200);
  assert.equal(describeWalletNetworkError(unsupportedSwitch).kind, "manual");
  const unsupportedAddWallet = new MockedInjectedWallet(42220);
  unsupportedAddWallet.addFailure = unsupportedSwitch;
  await assert.rejects(switchWalletNetwork("botTestnet", unsupportedAddWallet));
  assert.equal(describeWalletNetworkError(unsupportedAddWallet.addFailure).kind, "manual");
  assert.equal(unsupportedAddWallet.requests.filter((request) => request.method === "wallet_addEthereumChain").length, 1);
  assert.equal(describeWalletNetworkError(codedError("Provider disconnected", 4900)).kind, "disconnected");
  assert.equal(describeWalletNetworkError(codedError("RPC unavailable", -32000)).kind, "unavailable");

  const mismatch = new MockedInjectedWallet(42220);
  mismatch.afterSwitchChainId = 1;
  await assert.rejects(switchWalletNetwork("botTestnet", mismatch), /confirm.*968/i);
  assert.equal(mismatch.chainId, 1, "an unconfirmed selection never changes the active network view");

  assert.equal(isSameWalletAddress("0xAbc0000000000000000000000000000000000000", "0xabc0000000000000000000000000000000000000"), true);
  assert.equal(getWalletAuthStatus({ connected: false, address: null, sessionAddress: null }), "disconnected");
  assert.equal(getWalletAuthStatus({ connected: true, address: "0x1111111111111111111111111111111111111111", sessionAddress: null }), "unauthenticated");
  assert.equal(getWalletAuthStatus({ connected: true, address: "0x1111111111111111111111111111111111111111", sessionAddress: null, signing: true }), "awaiting-signature");
  assert.equal(getWalletAuthStatus({ connected: true, address: "0xAbc0000000000000000000000000000000000000", sessionAddress: "0xabc0000000000000000000000000000000000000" }), "authenticated");
  assert.equal(getWalletAuthStatus({ connected: true, address: "0x1111111111111111111111111111111111111111", sessionAddress: "0x2222222222222222222222222222222222222222" }), "reauthentication-required");
  assert.deepEqual(walletAuthStatusCopy, {
    disconnected: "Connect wallet",
    unauthenticated: "Sign in to use saved recipients and payments",
    "awaiting-signature": "Confirm sign-in in your wallet",
    authenticated: "Wallet verified",
    "reauthentication-required": "Sign in again to continue",
  });
  assert.equal(shouldDispatchWalletSessionExpired(401, "session-probe"), false);
  assert.equal(shouldDispatchWalletSessionExpired(401, "protected"), true);
  assert.equal(shouldRequireReauthenticationAfterAccountChange("0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"), true);
  assert.equal(shouldRequireReauthenticationAfterAccountChange(null, "0x2222222222222222222222222222222222222222"), false);
  assert.equal(isCurrentWalletAuthRequest({ address: "0x1111111111111111111111111111111111111111", accountRevision: 2, requestRevision: 4 }, { address: "0x1111111111111111111111111111111111111111", accountRevision: 2, requestRevision: 4 }), true);
  assert.equal(isCurrentWalletAuthRequest({ address: "0x1111111111111111111111111111111111111111", accountRevision: 2, requestRevision: 4 }, { address: "0x2222222222222222222222222222222222222222", accountRevision: 3, requestRevision: 4 }), false);

  const review: WalletReviewContext = { owner: "0x1111111111111111111111111111111111111111", address: "0x1111111111111111111111111111111111111111", chainId: 968, intentId: "intent_1", termsFingerprint: "terms_1" };
  assert.equal(isSameWalletReviewContext(review, { ...review }), true);
  assert.equal(isSameWalletReviewContext(review, { ...review, chainId: 677 }), false, "a stale review cannot survive a network change");
  assert.equal(isSameWalletReviewContext(review, { ...review, owner: "0x2222222222222222222222222222222222222222" }), false, "a review cannot survive an owner change");
  assert.equal(isSameWalletReviewContext({ ...review, contextRevision: 1 }, { ...review, contextRevision: 2 }), false, "a review cannot survive a wallet context event");
  const previousRevision = getWalletReviewContextRevision();
  bumpWalletReviewContextRevision();
  assert.equal(getWalletReviewContextRevision(), previousRevision + 1);

  const pendingSwitch = beginWalletNetworkSwitch("botMainnet");
  assert.notEqual(pendingSwitch, null);
  assert.equal(getWalletNetworkSwitchSnapshot().pending, true);
  assert.equal(beginWalletNetworkSwitch("botTestnet"), null, "only one wallet switch prompt may run at a time");
  finishWalletNetworkSwitch(pendingSwitch!, { status: "failed", target: "botMainnet", kind: "unavailable", message: "RPC unavailable" });
  assert.equal(getWalletNetworkSwitchSnapshot().pending, false);
  assert.equal(getWalletNetworkSwitchSnapshot().state.status, "failed");

  console.log("B9 wallet network, auth-state, and stale-review self-checks passed.");
}

void main();
