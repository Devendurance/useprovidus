"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

const COUNTRY_OPTIONS = [
  { value: "ng", label: "Nigeria (NGN)" },
  { value: "ke", label: "Kenya (KES)" },
  { value: "gh", label: "Ghana (GHS)" },
  { value: "other", label: "Other (limited coverage)" },
];

const METHOD_OPTIONS = [
  { value: "bank", label: "Bank transfer" },
  { value: "mobile", label: "Mobile money" },
  { value: "card", label: "Card" },
];

const ASSET_OPTIONS = [
  { value: "cusd", label: "cUSD" },
  { value: "usdc", label: "USDC" },
  { value: "celo", label: "CELO" },
];

export function RouteCheckForm() {
  const router = useRouter();
  const [country, setCountry] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [asset, setAsset] = useState("");
  const [submittedNote, setSubmittedNote] = useState<string | null>(null);

  const canContinue =
    country !== "" && amount.trim() !== "" && method !== "" && asset !== "";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canContinue) {
      setSubmittedNote("Fill country, amount, payment method and target asset.");
      return;
    }
    // Shell only: navigate to preview empty state. No quotes invented.
    const params = new URLSearchParams({
      country,
      amount: amount.trim(),
      method,
      asset,
    });
    router.push(`/check/preview?${params.toString()}`);
  }

  return (
    <Card variant="surface" className="w-full">
      <CardTitle>Cash-out details</CardTitle>
      <CardDescription>
        This legacy form carries basic details into the review shell. The live
        Move Money flow is the source of truth for Celo USDC bank cash-outs,
        recipient verification and Paycrest quotes.
      </CardDescription>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
        <Select
          id="country"
          label="Country / currency"
          options={COUNTRY_OPTIONS}
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder="Select country"
          hint="Coverage starts narrow. Unsupported markets show limited routes."
          required
        />

        <Input
          id="amount"
          label="Fiat amount"
          type="text"
          inputMode="decimal"
          placeholder="e.g. 100000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          hint="Local currency amount you intend to move."
          autoComplete="off"
        />

        <Select
          id="method"
          label="Payment method"
          options={METHOD_OPTIONS}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          placeholder="Select payment method"
          required
        />

        <Select
          id="asset"
          label="Target asset"
          options={ASSET_OPTIONS}
          value={asset}
          onChange={(e) => setAsset(e.target.value)}
          placeholder="Select target asset"
          hint="What you want to receive on Celo."
          required
        />

        {submittedNote ? (
          <p className="text-sm text-ledger-stone" role="status">
            {submittedNote}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
            <Button type="submit" variant="primary" disabled={!canContinue}>
            Continue to review shell
          </Button>
          <p className="text-sm text-receipt-grey">
            No transfer starts here. Review and explicit wallet approval happen
            in Move Money.
          </p>
        </div>
      </form>
    </Card>
  );
}
