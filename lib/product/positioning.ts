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
  productionLabel: "Production payment availability remains gated pending separate launch authorization.",
  utilityLabel: "BOT-funded utilities are not live without an independently verified settlement and provider-delivery route.",
  networkLabel: "Transactions verified · production gated",
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
    availability: "tested",
    label: "Testnet verified",
    summary: "Pay a named recipient on BOT Testnet with a wallet-authorized native BOT transfer.",
    examples: ["Pay Douglas 2 BOT", "Saved recipient lookup"],
    network: "BOT Testnet · chain ID 968",
    assets: "Native BOT on testnet",
    boundary: `${BOT_MAINNET_STATUS.productionLabel} ${BOT_MAINNET_STATUS.utilityLabel}`,
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
