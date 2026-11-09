/**
 * B9B — Deploy ProvidusPay to BOT Chain MAINNET (chain 677) ONLY.
 * Usage (ONLY after explicit user approval of exact costs):
 *   BOT_MAINNET_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-providus-pay-mainnet.js --network botMainnet
 *
 * Safety: refuses any other chain; never logs the key; checks balance; verifies
 * code/owner/allowlist post-deploy; refuses repeat deployment when a record
 * exists or code already sits at the derived address.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- hardhat scripts are CJS */
const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_CHAIN_ID = 677n;
const USDT_MAINNET = "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C";
const MAX_SPEND_WEI = 100000000000000000n; // 0.1 BOT hard cap for the deploy tx

function redact(msg) {
  return String(msg).replace(/0x[0-9a-fA-F]{64}/g, "0x<redacted-key>");
}

function loadLocalEnv() {
  for (const file of [".env.local", ".env"]) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
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
loadLocalEnv();

async function main() {
  const key = process.env.BOT_MAINNET_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key.trim())) {
    throw new Error("BOT_MAINNET_PRIVATE_KEY is missing or malformed. Refusing to deploy.");
  }
  const chainId = await hre.ethers.provider.send("eth_chainId", []).then((h) => BigInt(h));
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Wrong chain: got ${chainId}, expected 677. Refusing to deploy.`);
  }
  const expectedDeployer = (process.env.BOT_MAINNET_DEPLOYER_ADDRESS || "").trim().toLowerCase();
  const derivedDeployer = hre.ethers.computeAddress(key.trim()).toLowerCase();
  if (!expectedDeployer || derivedDeployer !== expectedDeployer) {
    throw new Error("Deployer mismatch with BOT_MAINNET_DEPLOYER_ADDRESS. Refusing to deploy.");
  }

  const recordPath = path.join(__dirname, "..", "deployments", "bot-mainnet.json");
  if (fs.existsSync(recordPath)) {
    throw new Error("A mainnet deployment record already exists. Refusing repeat deployment.");
  }

  const deployer = new hre.ethers.Wallet(key.trim(), hre.ethers.provider);
  const deployerAddr = await deployer.getAddress();
  const balance = await hre.ethers.provider.getBalance(deployerAddr);
  console.log("deployer: " + deployerAddr);
  console.log("deployer balance (wei): " + balance.toString());

  // Pre-derive the CREATE address and refuse if it is already occupied.
  const nonce = await hre.ethers.provider.getTransactionCount(deployerAddr);
  const expectedAddress = hre.ethers.getCreateAddress({ from: deployerAddr, nonce });
  console.log("derived contract address: " + expectedAddress);
  const existing = await hre.ethers.provider.getCode(expectedAddress);
  if (existing && existing !== "0x") {
    throw new Error("Derived contract address already has code. Refusing to deploy.");
  }

  const factory = await hre.ethers.getContractFactory("ProvidusPay", deployer);
  const estimate = await hre.ethers.provider.estimateGas({
    ...(await factory.getDeployTransaction([USDT_MAINNET])),
    from: deployerAddr,
  });
  const fee = await hre.ethers.provider.getFeeData();
  const price = fee.gasPrice ?? 20000000000n;
  const cost = estimate * price;
  console.log("estimated deployment gas: " + estimate.toString());
  console.log("total deploy cost estimate (wei): " + cost.toString());
  if (cost > MAX_SPEND_WEI) {
    throw new Error("Estimate exceeds 0.1 BOT hard cap. Refusing to deploy.");
  }
  if (balance < cost) {
    throw new Error("Insufficient BOT for deployment gas. Fund the deployer and retry.");
  }

  const contract = await factory.deploy([USDT_MAINNET]);
  console.log("deploy tx sent, waiting for confirmation...");
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  if (address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error("Deployed address differs from derived address. Investigate before proceeding.");
  }
  const receipt = await hre.ethers.provider.getTransactionReceipt(contract.deploymentTransaction().hash);
  if (!receipt || receipt.status !== 1) throw new Error("Deployment transaction failed.");

  const code = await hre.ethers.provider.getCode(address);
  if (!code || code === "0x") throw new Error("No contract code at deployed address.");
  const owner = await contract.owner();
  if (owner.toLowerCase() !== deployerAddr.toLowerCase()) throw new Error("Owner mismatch after deployment.");
  const allowed = await contract.allowedTokens(USDT_MAINNET);
  if (!allowed) throw new Error("USDT allowlist not set by constructor.");

  const record = {
    network: "botMainnet",
    chainId: 677,
    contract: address,
    deployTxHash: contract.deploymentTransaction().hash,
    blockNumber: Number(receipt.blockNumber),
    owner,
    initialAllowlist: [USDT_MAINNET],
    deployedBytecodeHash: hre.ethers.keccak256(code),
    compiler: "solc 0.8.24",
    verified: new Date().toISOString(),
    explorer: {
      contract: `https://scan.botchain.ai/address/${address}`,
      tx: `https://scan.botchain.ai/tx/${contract.deploymentTransaction().hash}`,
    },
  };
  fs.mkdirSync(path.join(__dirname, "..", "deployments"), { recursive: true });
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
  console.log("deployment record: " + recordPath);
  console.log(JSON.stringify({ ...record }, null, 2));
}

main().catch((err) => {
  console.error("DEPLOY ABORTED: " + redact(err.message || err).slice(0, 500));
  process.exit(1);
});
