/**
 * B1 deterministic self-check for the multichain backend foundation.
 * Run: npm run test:chains
 *
 * Fully offline-safe: all assertions use the pure registry plus injected
 * unreachable-RPC clients. Live RPC verification runs only when
 * BOT_LIVE_VERIFY=1 and never fails the suite when skipped.
 */

import assert from "node:assert/strict";
import { createPublicClient, http } from "viem";
import {
  BOT_MAINNET_CHAIN_ID,
  BOT_MAINNET_USDT,
  BOT_MAINNET_USDT_ADDRESS,
  BOT_MAINNET_USDT_VERIFICATION,
  BOT_TESTNET_CHAIN_ID,
  assertSupportedChainId,
  explorerAddressUrl,
  explorerTxUrl,
  getBotErc20Address,
  getChainById,
  getChainRecord,
  getNativeAsset,
  isAssetSupportedOnChain,
  isBotChainId,
  isBotChainKey,
  isBotPaymentExecutable,
  isSameNetworkTier,
  isSupportedChainId,
} from "@/lib/chains/registry";
import {
  fetchErc20Metadata,
  getBotMainnetClient,
  getBotTestnetClient,
  verifyRpcChainId,
} from "@/lib/chains/clients";
import { CELO_CHAIN_ID } from "@/lib/wallet/celo";
import { CANONICAL_CELO_USDC_ADDRESS } from "@/lib/celo/usdc";
import { getPaymentAsset } from "@/lib/celo/assets";

const UNREACHABLE_RPC = "http://127.0.0.1:1";

async function run() {
  // --- 1. Correct chain selection ---
  assert.equal(getChainRecord("celo").chainId, 42220);
  assert.equal(getChainRecord("botTestnet").chainId, BOT_TESTNET_CHAIN_ID);
  assert.equal(getChainRecord("botMainnet").chainId, BOT_MAINNET_CHAIN_ID);
  assert.equal(getChainById(42220)?.key, "celo");
  assert.equal(getChainById(968)?.key, "botTestnet");
  assert.equal(getChainById(677)?.key, "botMainnet");
  assert.equal(assertSupportedChainId(677).key, "botMainnet");

  // --- 2. Wrong chain rejection ---
  assert.equal(getChainById(1), null);
  assert.equal(getChainById(137), null);
  assert.equal(getChainById(null), null);
  assert.equal(getChainById(undefined), null);
  assert.equal(isSupportedChainId(1), false);
  assert.equal(isSupportedChainId(677), true);
  assert.throws(() => assertSupportedChainId(1), /Unsupported chain ID/);
  assert.equal(isBotChainId(1), false);
  assert.equal(isBotChainId(42220), false);
  assert.equal(isBotChainId(968), true);

  // --- 3. Mainnet/testnet isolation ---
  assert.equal(getChainRecord("botTestnet").isTestnet, true);
  assert.equal(getChainRecord("botMainnet").isTestnet, false);
  assert.equal(getChainRecord("celo").isTestnet, false);
  assert.equal(isSameNetworkTier("botMainnet", "celo"), true);
  assert.equal(isSameNetworkTier("botMainnet", "botTestnet"), false);
  assert.equal(isSameNetworkTier("celo", "botTestnet"), false);
  // USDT is mainnet-only: the same address on testnet is a different token.
  assert.equal(getBotErc20Address("botMainnet", "USDT"), BOT_MAINNET_USDT_ADDRESS);
  assert.equal(getBotErc20Address("botTestnet", "USDT"), null);

  // --- 4. Native versus ERC-20 asset handling ---
  const testnetNative = getNativeAsset("botTestnet");
  assert.equal(testnetNative.symbol, "BOT");
  assert.equal(getBotErc20Address("botTestnet", "BOT"), null); // native has no contract
  assert.equal(BOT_MAINNET_USDT.kind, "erc20");
  assert.ok(BOT_MAINNET_USDT.address !== null);
  assert.equal(typeof BOT_MAINNET_USDT.decimals, "number");

  // --- 5. Unsupported tokens ---
  assert.equal(isAssetSupportedOnChain("botMainnet", "BOT"), true);
  assert.equal(isAssetSupportedOnChain("botMainnet", "USDT"), true);
  assert.equal(isAssetSupportedOnChain("botMainnet", "USDC"), false);
  assert.equal(isAssetSupportedOnChain("botMainnet", "CNGN"), false);
  assert.equal(isAssetSupportedOnChain("botTestnet", "USDT"), false);
  assert.equal(isAssetSupportedOnChain("botTestnet", "BOT"), true);
  assert.equal(isAssetSupportedOnChain("botTestnet", "FAKE"), false);
  // BOT assets stay separate from the Celo Paycrest path.
  assert.equal(isAssetSupportedOnChain("celo", "USDT"), false);

  // --- 6. Celo backward compatibility (untouched modules) ---
  assert.equal(CELO_CHAIN_ID, 42220);
  assert.equal(BOT_TESTNET_CHAIN_ID, 968);
  assert.equal(BOT_MAINNET_CHAIN_ID, 677);
  assert.equal(getPaymentAsset("USDC").address, CANONICAL_CELO_USDC_ADDRESS);
  assert.equal(getPaymentAsset(undefined).symbol, "USDC");
  assert.equal(isBotChainKey("celo"), false);
  assert.equal(isBotChainKey("botMainnet"), true);
  // Chain-scoped explorer links never cross networks.
  const botTx = explorerTxUrl("botMainnet", "0xabc");
  const celoAddr = explorerAddressUrl("celo", CANONICAL_CELO_USDC_ADDRESS);
  assert.ok(botTx.startsWith("https://scan.botchain.ai/tx/"));
  assert.ok(!botTx.includes("celoscan") && !botTx.includes("bohr"));
  assert.ok(celoAddr.includes("celoscan.io"));
  assert.ok(explorerAddressUrl("botTestnet", "0x0").startsWith("https://scan.bohr.life/address/"));

  // --- 7. Unavailable RPC / token metadata (deterministic, offline) ---
  const deadClient = createPublicClient({
    transport: http(UNREACHABLE_RPC, { timeout: 2000 }),
  });
  const deadChain = await verifyRpcChainId(deadClient, BOT_MAINNET_CHAIN_ID);
  assert.equal(deadChain.ok, false);
  assert.match(deadChain.error, /RPC_ERROR/);
  const deadMeta = await fetchErc20Metadata(deadClient, BOT_MAINNET_USDT_ADDRESS);
  assert.equal(deadMeta.error !== null, true);
  assert.equal(deadMeta.decimals, null);
  const badAddress = await fetchErc20Metadata(deadClient, "not-an-address");
  assert.equal(badAddress.error, "INVALID_ADDRESS");
  // Mismatched expectation is rejected without throwing.
  const fakeClient = { getChainId: async () => 1 };
  const mismatch = await verifyRpcChainId(fakeClient, BOT_MAINNET_CHAIN_ID);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error, /CHAIN_ID_MISMATCH/);

  // --- 8. B1 non-executable gate ---
  assert.equal(isBotPaymentExecutable(), false);
  assert.equal(BOT_MAINNET_USDT.executable, false);
  assert.equal(BOT_MAINNET_USDT_VERIFICATION.decimals, 6);
  assert.equal(BOT_MAINNET_USDT_VERIFICATION.chainId, 677);

  // --- 9. Live RPC verification (opt-in; informational only) ---
  if (process.env.BOT_LIVE_VERIFY === "1") {
    const testnet = await verifyRpcChainId(getBotTestnetClient(), BOT_TESTNET_CHAIN_ID);
    assert.equal(testnet.ok, true);
    const mainnet = await verifyRpcChainId(getBotMainnetClient(), BOT_MAINNET_CHAIN_ID);
    assert.equal(mainnet.ok, true);
    const usdt = await fetchErc20Metadata(getBotMainnetClient(), BOT_MAINNET_USDT_ADDRESS);
    assert.equal(usdt.error, null);
    assert.equal(usdt.decimals, 6);
    assert.equal(usdt.symbol, "USDT");
    console.log("live BOT RPC verification passed (chainIds 968/677, USDT decimals 6)");
  } else {
    console.log("live BOT RPC verification skipped (set BOT_LIVE_VERIFY=1 to run)");
  }

  console.log("chains self-check (B1): all assertions passed");
}

run().catch((err) => {
  console.error("chains self-check (B1) failed:", err);
  process.exit(1);
});
