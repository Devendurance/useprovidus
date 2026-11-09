/**
 * B4B — Deploy ProvidusPay to BOT Chain Testnet (chain 968) ONLY.
 * Usage: BOT_TESTNET_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-providus-pay.js --network botTestnet
 *
 * Safety: refuses to run on any other chain; never logs the key; checks
 * balance before spending gas; constructor allowlist is empty (native test
 * BOT only — testnet USDT does not exist).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- hardhat scripts are CJS */
const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Minimal safe env loader: reads KEY=VALUE lines from .env.local (preferred)
 * then .env (fallback, first-set wins), without new dependencies and without
 * ever printing values. Only BOT_TESTNET_* keys are consumed below.
 */
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

const EXPECTED_CHAIN_ID = 968n;

function redact(msg) {
  return String(msg).replace(/0x[0-9a-fA-F]{64}/g, "0x<redacted-key>");
}

async function main() {
  const key = process.env.BOT_TESTNET_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key.trim())) {
    throw new Error("BOT_TESTNET_PRIVATE_KEY is missing or malformed. Refusing to deploy.");
  }
  // Fail closed: the key must derive the configured deployer address.
  const expectedDeployer = (process.env.BOT_TESTNET_DEPLOYER_ADDRESS || "").trim().toLowerCase();
  const derivedDeployer = hre.ethers.computeAddress(key.trim()).toLowerCase();
  if (!expectedDeployer || derivedDeployer !== expectedDeployer) {
    throw new Error(
      "Deployer mismatch: key derives " + derivedDeployer +
      " but BOT_TESTNET_DEPLOYER_ADDRESS is " + (expectedDeployer || "(unset)") +
      ". Refusing to deploy."
    );
  }
  const chainId = await hre.ethers.provider.send("eth_chainId", []).then((h) => BigInt(h));
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Wrong chain: got ${chainId}, expected 968. Refusing to deploy.`);
  }

  const deployer = new hre.ethers.Wallet(key.trim(), hre.ethers.provider);
  const deployerAddr = await deployer.getAddress();
  console.log("deployer: " + deployerAddr);
  const balance = await hre.ethers.provider.getBalance(deployerAddr);
  console.log("deployer balance (wei): " + balance.toString());

  const factory = await hre.ethers.getContractFactory("ProvidusPay", deployer);
  const deployTx = await factory.getDeployTransaction([]);
  const estimate = await hre.ethers.provider.estimateGas({ ...deployTx, from: deployerAddr });
  const fee = await hre.ethers.provider.getFeeData();
  const price = fee.gasPrice ?? 20000000000n;
  console.log("estimated deployment gas: " + estimate.toString());
  console.log("total deploy cost estimate (wei): " + (estimate * price).toString());
  if (balance < estimate * price) {
    throw new Error("Insufficient test BOT for deployment gas. Fund the deployer and retry.");
  }

  const contract = await factory.deploy([]);
  console.log("deploy tx sent, waiting for confirmation...");
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const deployReceipt = await hre.ethers.provider.getTransactionReceipt(contract.deploymentTransaction().hash);

  const code = await hre.ethers.provider.getCode(address);
  if (!code || code === "0x") {
    throw new Error("No contract code at deployed address. Deployment failed.");
  }
  const owner = await contract.owner();
  if (owner.toLowerCase() !== deployerAddr.toLowerCase()) {
    throw new Error("Owner mismatch after deployment.");
  }

  const record = {
    network: "botTestnet",
    chainId: 968,
    contract: address,
    deployTxHash: contract.deploymentTransaction().hash,
    blockNumber: Number(deployReceipt.blockNumber),
    owner,
    initialAllowlist: [],
    deployedBytecodeHash: hre.ethers.keccak256(code),
    compiler: "solc 0.8.24",
    verified: new Date().toISOString(),
    explorer: {
      contract: `https://scan.bohr.life/address/${address}`,
      tx: `https://scan.bohr.life/tx/${contract.deploymentTransaction().hash}`,
    },
  };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, "bot-testnet.json");
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
  console.log("deployment record: " + outPath);
  console.log(JSON.stringify({ ...record }, null, 2));

  if (process.env.VERIFY_EXPLORER === "1") {
    console.log("Explorer source verification: attempting Blockscout-style API...");
    try {
      const params = new URLSearchParams({
        module: "contract",
        action: "verifysourcecode",
        contractaddress: address,
        sourceCode: fs.readFileSync(path.join(__dirname, "..", "contracts", "ProvidusPay.sol"), "utf8"),
        contractname: "contracts/ProvidusPay.sol:ProvidusPay",
        compilerversion: "v0.8.24+commit.e11b9ed9",
        optimizationUsed: "0",
      });
      const res = await fetch("https://scan.bohr.life/api", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      console.log("explorer verify response status: " + res.status);
      console.log("explorer verify body: " + (await res.text()).slice(0, 300));
    } catch (err) {
      console.log("explorer verification unavailable: " + redact(err.message).slice(0, 200));
    }
  } else {
    console.log("Explorer source verification skipped (set VERIFY_EXPLORER=1 to attempt).");
  }
}

main().catch((err) => {
  console.error("DEPLOY ABORTED: " + redact(err.message || err).slice(0, 500));
  process.exit(1);
});
