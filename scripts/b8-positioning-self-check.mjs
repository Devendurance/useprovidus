import { readFileSync } from "node:fs";

const files = {
  home: readFileSync("app/page.tsx", "utf8"),
  dashboard: readFileSync("app/dashboard/page.tsx", "utf8"),
  footer: readFileSync("components/layout/site-footer.tsx", "utf8"),
  assistant: readFileSync("components/assistant/assistant-panel.tsx", "utf8"),
  suggestions: readFileSync("components/assistant/message-list.tsx", "utf8"),
  positioning: readFileSync("lib/product/positioning.ts", "utf8"),
  layout: readFileSync("app/layout.tsx", "utf8"),
};

const required = [
  ["positioning headline", files.positioning, "Payments that understand your intent. And prove the outcome."],
  ["homepage BOT Chain domain", files.home, "BOT Chain"],
  ["homepage Celo domain", files.home, "Celo"],
  ["dashboard domain registry", files.dashboard, "EXECUTION_DOMAINS"],
  ["assistant multichain copy", files.assistant, "BOT Testnet recipient payment"],
  ["assistant BOT example", files.suggestions, "Pay Douglas 2 BOT on BOT Testnet"],
  ["footer partner links", files.footer, "BOT_CHAIN_LINKS"],
  ["official website link", files.positioning, "https://www.botchain.ai"],
  ["official mainnet explorer link", files.positioning, "https://scan.botchain.ai"],
  ["testnet explorer link", files.positioning, "https://scan.bohr.life"],
  ["metadata BOT Chain keyword", files.layout, '"BOT Chain"'],
];

for (const [label, source, value] of required) {
  if (!source.includes(value)) throw new Error(`Missing ${label}: ${value}`);
}

if (files.home.includes("Celo-native payment execution")) {
  throw new Error("Homepage still leads with Celo-only positioning");
}

if (files.footer.includes("Built for Celo ·")) {
  throw new Error("Footer still claims a Celo-only product");
}

console.log(`B8 positioning checks passed (${required.length} assertions)`);
