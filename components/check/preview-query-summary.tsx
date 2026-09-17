"use client";

import { useSearchParams } from "next/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

const LABELS: Record<string, Record<string, string>> = {
  country: {
    ng: "Nigeria (NGN)",
    ke: "Kenya (KES)",
    gh: "Ghana (GHS)",
    other: "Other (limited coverage)",
  },
  method: {
    bank: "Bank transfer",
    mobile: "Mobile money",
    card: "Card",
  },
  asset: {
    cusd: "cUSD",
    usdc: "USDC",
    celo: "CELO",
  },
};

function resolveLabel(
  group: Record<string, string>,
  value: string,
): string {
  if (!value) return "—";
  return group[value] ?? value;
}

export function PreviewQuerySummary() {
  const params = useSearchParams();
  const country = params.get("country") ?? "";
  const amount = params.get("amount") ?? "";
  const method = params.get("method") ?? "";
  const asset = params.get("asset") ?? "";

  const hasAny = Boolean(country || amount || method || asset);

  if (!hasAny) {
    return (
      <Card variant="flat">
        <CardTitle className="text-base">Your inputs</CardTitle>
        <CardDescription>
          No Route Check inputs in this session. Start from the form to carry
          country, amount, method and asset into this preview.
        </CardDescription>
      </Card>
    );
  }

  const rows = [
    {
      label: "Country",
      value: resolveLabel(LABELS.country, country),
    },
    { label: "Amount", value: amount || "—" },
    {
      label: "Payment method",
      value: resolveLabel(LABELS.method, method),
    },
    {
      label: "Target asset",
      value: resolveLabel(LABELS.asset, asset),
    },
  ];

  return (
    <Card variant="flat">
      <CardTitle className="text-base">Your inputs</CardTitle>
      <CardDescription>
        Carried from the Route Check form. Labels only—no quote calculated.
      </CardDescription>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="font-sans text-receipt-grey">{row.label}</dt>
            <dd className="mt-0.5 text-sm font-semibold text-ink">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
