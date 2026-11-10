export type Availability = "live" | "tested" | "in-development" | "planned";

export type ExecutionDomain = {
  id: "celo" | "bot";
  name: string;
  availability: Availability;
  label: string;
  summary: string;
  examples: readonly string[];
  network: string;
  assets: string;
  boundary: string;
};

export const BOT_MAINNET_STATUS = {
  transactionLabel: "Native BOT and Official USDT transactions are independently verified on BOT Chain Mainnet.",
  productionLabel: "BOT Chain Mainnet payments are live: native BOT and official USDT with wallet approval and verified receipts.",
  utilityLabel: "BOT-funded utilities are not live without an independently verified settlement and provider-delivery route.",
  networkLabel: "Live BOT Chain Mainnet payments",
} as const;

export const PRODUCT_POSITIONING = {
  tagline: "Ask. Approve. Prove.",
  heroHeadline: "Payments that understand your intent. And prove the outcome.",
  heroSupport:
    "Tell Providus who to pay or what to purchase. Review the exact terms, authorize with your wallet, and receive evidence of the actual outcome across supported blockchain networks.",
} as const;

export const EXECUTION_DOMAINS: readonly ExecutionDomain[] = [
  {
    id: "celo",
    name: "Celo",
    availability: "live",
    label: "Live",
    summary: "Pay for supported Nigerian services with the existing Celo execution flow.",
    examples: ["₦1,000 MTN airtime", "Nigerian bank cash-out"],
    network: "Celo mainnet",
    assets: "USDC and cNGN",
    boundary: "Airtime and cash-out keep payment, settlement, and fulfilment as separate states.",
  },
  {
    id: "bot",
    name: "BOT Chain",
    availability: "live",
    label: "Live",
    summary: "Pay a named recipient on BOT Chain Mainnet with a wallet-authorized native BOT or official USDT transfer.",
    examples: ["Pay Douglas 0.01 BOT", "Pay Douglas 1 USDT"],
    network: "BOT Chain Mainnet · chain ID 677",
    assets: "Native BOT and official USDT",
    boundary: `${BOT_MAINNET_STATUS.transactionLabel} ${BOT_MAINNET_STATUS.utilityLabel}`,
  },
] as const;

export const UTILITY_ROADMAP = [
  { name: "Airtime", availability: "live" as const, note: "Verified on Celo with the current Nigerian fulfilment path." },
  { name: "Data bundles", availability: "planned" as const, note: "Planned after the current airtime flow." },
  { name: "Electricity", availability: "planned" as const, note: "Requires a verified provider route." },
  { name: "Cable subscriptions", availability: "planned" as const, note: "Requires a verified provider route." },
] as const;

export const BOT_CHAIN_LINKS = {
  website: "https://www.botchain.ai",
  mainnetExplorer: "https://scan.botchain.ai",
  testnetExplorer: "https://scan.bohr.life",
} as const;
