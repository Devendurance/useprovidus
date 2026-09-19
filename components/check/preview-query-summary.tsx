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
          No cash-out details in this session. Start from Move Money to request
          a live quote and verify a Nigerian bank recipient.
        </CardDescription>
      </Card>
    );
  }

  const rows = [
    {
      label: "Country",
      value: resolveLabel(LABELS.country, country),
    },
    { label: "Entered amount", value: amount || "—" },
    {
      label: "Payment method",
      value: resolveLabel(LABELS.method, method),
    },
    {
      label: "Asset",
      value: resolveLabel(LABELS.asset, asset),
    },
  ];

  return (
    <Card variant="flat">
      <CardTitle className="text-base">Your inputs</CardTitle>
      <CardDescription>
        Carried from a legacy link. These labels are not a live quote and do
        not authorize a transfer.
      </CardDescription>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="font-proof text-receipt-grey">{row.label}</dt>
            <dd className="mt-0.5 text-sm font-semibold text-ledger-stone">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
