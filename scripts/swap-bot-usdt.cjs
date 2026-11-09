/**
 * B9C.1 — Direct BOT → USDT swap on BOT Mainnet via BDEX V2 (exact-output).
 *
 * DEFAULT IS DRY RUN: quotes, simulates, and prints the exact approval sheet.
 * Broadcasting ONLY happens when BOTH hold:
 *   1. CLI flag `--execute`, AND
 *   2. env SWAP_CONFIRMED equals the printed maxInputWei EXACTLY
 *      (the user copies it from a dry run = explicit approval of the number).
 *
 * Safety: official router + tokens only (hardcoded, bytecode-verified),
 * chain 677 gate, 1% slippage cap, 15-min deadline, 0.2 BOT gas-reserve floor,
 * absolute 0.01 BOT gas cap, no approvals (native input), no full-balance
 * wraps, fail-closed everywhere. Never prints the private key.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- node scripts are CJS */
const { readFileSync } = require("node:fs");
const { createPublicClient, createWalletClient, http, encodeFunctionData, isAddress } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const CHAIN_ID = 677;
const RPC = "https://rpc.botchain.ai";
const USDT = "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C";
const WBOT = "0xD5452816194a3784dBa983426cCe7c122F4abd30";
const V2ROUTER = "0x1414eD29FdFD322c3c0a830330ed982E2D629e76";
const AMOUNT_OUT = 1000000n; // exactly 1.000000 USDT
const SLIPPAGE_BPS = 100n; // 1% max
const DEADLINE_SECS = 900;
const GAS_RESERVE_WEI = 200000000000000000n; // 0.2 BOT stays untouched
const MAX_FEE_WEI = 10000000000000000n; // 0.01 BOT absolute gas cap

function loadDotEnv() {
  for (const file of [".env.local", ".env"]) {
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    for (const raw of text.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (!line || line.trim().startsWith("#")) continue;
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      let v = m[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}
loadDotEnv();

function fail(m) { console.error("ABORT: " + m); process.exit(1); }

async function main() {
  const execute = process.argv.includes("--execute");
  const key = process.env.BOT_MAINNET_PRIVATE_KEY || "";
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key.trim())) fail("BOT_MAINNET_PRIVATE_KEY missing or malformed");
  const account = privateKeyToAccount(key.trim());
  const payer = "0x15451254A70e5bD6FEcA12447c42DCc9B26f3947";
  if (account.address.toLowerCase() !== payer.toLowerCase()) fail("key does not match authorized payer");

  const pub = createPublicClient({ transport: http(RPC, { timeout: 15000 }) });
  if ((await pub.getChainId()) !== CHAIN_ID) fail("wrong chain");
  for (const entry of [["USDT", USDT], ["WBOT", WBOT], ["V2Router", V2ROUTER]]) {
    const name = entry[0]; const addr = entry[1];
    if (!isAddress(addr)) fail("bad hardcoded address: " + name);
    const code = await pub.getBytecode({ address: addr });
    if (!code || code === "0x") fail("no code at " + name);
  }
  const balance = await pub.getBalance({ address: account.address });
  console.log("payer BOT balance: " + (Number(balance) / 1e18).toFixed(6));

  const routerAbi = [
    { type: "function", name: "getAmountsIn", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address[]" }], outputs: [{ type: "uint256[]" }] },
    { type: "function", name: "swapETHForExactTokens", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "address[]" }, { type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256[]" }] },
  ];
  const amounts = await pub.readContract({
    address: V2ROUTER, abi: routerAbi, functionName: "getAmountsIn", args: [AMOUNT_OUT, [WBOT, USDT]],
  });
  const required = amounts[0];
  const maxInput = (required * (10000n + SLIPPAGE_BPS)) / 10000n;
  console.log("quoted BOT in (exact): " + required.toString());
  console.log("maxInputWei (1% slip): " + maxInput.toString());

  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECS);
  const data = encodeFunctionData({
    abi: routerAbi, functionName: "swapETHForExactTokens",
    args: [AMOUNT_OUT, [WBOT, USDT], account.address, deadline],
  });
  const gas = await pub.estimateGas({ account: account.address, to: V2ROUTER, data, value: maxInput });
  const price = await pub.getGasPrice();
  const fee = gas * price;
  console.log("estimate gas=" + gas.toString() + " fee=" + (Number(fee) / 1e18).toFixed(6) + " BOT deadline=" + deadline.toString());
  if (fee > MAX_FEE_WEI) fail("gas fee exceeds 0.01 BOT cap");
  if (balance < maxInput + fee + GAS_RESERVE_WEI) fail("insufficient BOT (need maxInput + fee + 0.2 reserve)");
  const remaining = balance - maxInput - fee;
  console.log("remaining after swap+fee: " + (Number(remaining) / 1e18).toFixed(6) + " BOT");
  console.log("target=" + V2ROUTER + " value=" + maxInput.toString());
  console.log("calldata=" + data.slice(0, 74) + "...");

  if (!execute) {
    console.log("DRY RUN complete — no broadcast. To authorize: SWAP_CONFIRMED=" + maxInput.toString() + " node scripts/swap-bot-usdt.js --execute");
    return;
  }
  if ((process.env.SWAP_CONFIRMED || "").trim() !== maxInput.toString()) {
    fail("SWAP_CONFIRMED does not match maxInputWei — set it from the dry run to approve the exact number");
  }
  const wallet = createWalletClient({ account, transport: http(RPC, { timeout: 20000 }) });
  const hash = await wallet.sendTransaction({
    to: V2ROUTER, data, value: maxInput,
    gas: (gas * 120n) / 100n,
    chain: { id: 677, name: "BOT Chain", nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } },
  });
  console.log("SWAP_TX=" + hash);
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180000 });
  console.log("status=" + receipt.status + " block=" + receipt.blockNumber);
  if (receipt.status !== "success") fail("swap reverted");
  const usdtAbi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
  const usdt = await pub.readContract({ address: USDT, abi: usdtAbi, functionName: "balanceOf", args: [account.address] });
  console.log("USDT balance now: " + (Number(usdt) / 1e6).toFixed(6));
}

main().catch((e) => fail((e instanceof Error ? e.message : String(e)).slice(0, 300).replace(/0x[0-9a-fA-F]{64}/g, "0x<redacted>")));
