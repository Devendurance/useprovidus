import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const files = {
  home: read("app/page.tsx"),
  howItWorks: read("app/how-it-works/page.tsx"),
  dashboard: read("app/dashboard/page.tsx"),
  positioning: read("lib/product/positioning.ts"),
  networkMenu: read("components/ui/connect-wallet-button.tsx"),
  suggestions: read("components/assistant/message-list.tsx"),
  footer: read("components/layout/site-footer.tsx"),
  readme: read("README.md"),
  receipt: read("app/receipt/receipt-client.tsx"),
  network: read("lib/wallet/network.ts"),
  execution: read("lib/transfers/web-execution.ts"),
};

const required = [
  ["central live Mainnet availability", files.positioning, "BOT Chain Mainnet payments are live: native BOT and official USDT"],
  ["verified BOT evidence wording", files.positioning, "Native BOT and Official USDT transactions are independently verified on BOT Chain Mainnet."],
  ["utility settlement boundary", files.positioning, "BOT-funded utilities are not live without an independently verified settlement and provider-delivery route."],
  ["BOT Mainnet domain availability", files.positioning, 'availability: "live"'],
  ["Mainnet chain label", files.positioning, "BOT Chain Mainnet · chain ID 677"],
  ["homepage Celo availability", files.home, "Celo services and BOT Chain Mainnet recipient payments are live."],
  ["homepage Mainnet evidence", files.home, "BOT_MAINNET_STATUS.transactionLabel"],
  ["dashboard Mainnet recipient flow", files.dashboard, "on BOT Chain Mainnet"],
  ["dashboard domain registry", files.dashboard, "EXECUTION_DOMAINS"],
  ["Mainnet payment example", files.suggestions, "Pay Douglas 0.01 BOT on BOT Chain Mainnet"],
  ["Mainnet wallet status", files.networkMenu, "BOT_MAINNET_STATUS.networkLabel"],
  ["footer current status", files.footer, "BOT_MAINNET_STATUS.productionLabel"],
  ["README live payment description", files.readme, "Mainnet payments live"],
  ["historical receipt network filter", files.receipt, "BOT Chain Testnet (historical)"],
  ["official Mainnet explorer", files.positioning, "https://scan.botchain.ai"],
  ["historical Testnet explorer", files.positioning, "https://scan.bohr.life"],
  ["hidden public Testnet network selection", files.network, "PUBLIC_WALLET_NETWORK_OPTIONS"],
  ["production Testnet execution block", files.execution, "BOT Testnet payments are disabled in production"],
];
for (const [label, source, value] of required) {
  if (!source.includes(value)) throw new Error(`Missing ${label}: ${value}`);
}

const publicCopy = [
  ["homepage", files.home],
  ["How it works", files.howItWorks],
  ["dashboard", files.dashboard],
  ["wallet navigation", files.networkMenu],
  ["assistant examples", files.suggestions],
  ["footer", files.footer],
  ["README", files.readme],
  ["positioning", files.positioning],
];
const stale = /production payment availability remains gated|pending B9|payments coming soon|BOT Testnet recipient payments|pay a named recipient on BOT Testnet|BOT Testnet transfers are verified/i;
for (const [label, source] of publicCopy) {
  if (stale.test(source)) throw new Error(`${label} contains stale BOT payment availability copy`);
}
if (!files.home.includes("BOT_MAINNET_STATUS.utilityLabel") || !files.dashboard.includes("domain.boundary")) {
  throw new Error("Public product copy is missing the BOT utility settlement limitation");
}
if (!files.network.includes("NETWORKS.celo") || !files.network.includes("NETWORKS.botMainnet")) {
  throw new Error("Celo or BOT Chain Mainnet was removed from public network options");
}

console.log(`B8 positioning checks passed (${required.length + publicCopy.length + 2} assertions)`);