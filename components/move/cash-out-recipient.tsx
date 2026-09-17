"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAccountVerification } from "@/hooks/use-account-verification";
import { useNgnInstitutions } from "@/hooks/use-ngn-institutions";
import {
  maskAccountIdentifier,
  validateNgnAccountIdentifier,
  type VerifiedRecipientBinding,
} from "@/lib/paycrest/recipient";
import { cn } from "@/lib/cn";

type CashOutRecipientProps = {
  enabled: boolean;
  onVerifiedChange: (recipient: VerifiedRecipientBinding | null) => void;
};

export function CashOutRecipient({
  enabled,
  onVerifiedChange,
}: CashOutRecipientProps) {
  const institutions = useNgnInstitutions(enabled);
  const verification = useAccountVerification();
  const [institutionCode, setInstitutionCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankQuery, setBankQuery] = useState("");

  const selectedInstitution = useMemo(() => {
    if (institutions.state.kind !== "ready") return null;
    return (
      institutions.state.institutions.find((i) => i.code === institutionCode) ??
      null
    );
  }, [institutions.state, institutionCode]);

  const filteredBanks = useMemo(() => {
    if (institutions.state.kind !== "ready") return [];
    const q = bankQuery.trim().toLowerCase();
    if (!q) return institutions.state.institutions;
    return institutions.state.institutions.filter(
      (i) =>
        i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q),
    );
  }, [institutions.state, bankQuery]);

  const accountCheck = useMemo(
    () =>
      accountNumber === ""
        ? null
        : validateNgnAccountIdentifier(accountNumber),
    [accountNumber],
  );

  const verified = verification.boundVerified(institutionCode, accountNumber);

  function handleBankChange(code: string) {
    setInstitutionCode(code);
    verification.clear();
    onVerifiedChange(null);
  }

  function handleAccountChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 10);
    setAccountNumber(digits);
    verification.clear();
    onVerifiedChange(null);
  }

  if (!enabled) return null;

  return (
    <Card variant="surface">
      <CardTitle>NGN recipient</CardTitle>
      <CardDescription>
        Select a live Paycrest-supported Nigerian bank and verify the account
        name. No order is created in this step.
      </CardDescription>

      {institutions.state.kind === "loading" ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-receipt-grey">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading NGN banks…
        </div>
      ) : null}

      {institutions.state.kind === "error" ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-error" role="alert">
            {institutions.state.message}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => institutions.refresh()}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {institutions.state.kind === "empty" ? (
        <p className="mt-4 text-sm text-warning" role="status">
          No supported NGN banks are available right now. Cash-out recipient
          setup is temporarily unavailable.
        </p>
      ) : null}

      {institutions.state.kind === "ready" ? (
        <div className="mt-5 space-y-5">
          <div>
            <label
              htmlFor="bank-search"
              className="text-sm font-semibold text-ink"
            >
              Bank
            </label>
            <input
              id="bank-search"
              className="mt-1.5 h-12 w-full rounded-[8px] border-2 border-ink bg-cream px-4 text-base text-ink focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              placeholder="Search banks…"
              value={bankQuery}
              onChange={(e) => setBankQuery(e.target.value)}
              autoComplete="off"
            />
            <div
              className="mt-2 max-h-48 overflow-y-auto rounded-[8px] border-2 border-ink bg-cream"
              role="listbox"
              aria-label="Nigerian banks"
            >
              {filteredBanks.length === 0 ? (
                <p className="px-3 py-3 text-sm text-receipt-grey">
                  No banks match your search.
                </p>
              ) : (
                filteredBanks.map((bank) => {
                  const selected = bank.code === institutionCode;
                  return (
                    <button
                      key={bank.code}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={cn(
                        "flex min-h-11 w-full items-center justify-between gap-2 border-b border-sage-line px-3 py-2.5 text-left text-sm last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus",
                        selected
                          ? "bg-success text-white"
                          : "text-ink hover:bg-sage-line/50",
                      )}
                      onClick={() => handleBankChange(bank.code)}
                    >
                      <span className="font-semibold">{bank.name}</span>
                    </button>
                  );
                })
              )}
            </div>
            {selectedInstitution ? (
              <p className="mt-2 text-xs text-receipt-grey">
                Selected: {selectedInstitution.name}
              </p>
            ) : (
              <p className="mt-2 text-xs text-receipt-grey">
                Choose a bank from the live list.
              </p>
            )}
          </div>

          <div>
            <Input
              id="ngn-account"
              label="Nigerian bank account number"
              inputMode="numeric"
              autoComplete="off"
              placeholder="10 digits"
              value={accountNumber}
              onChange={(e) => handleAccountChange(e.target.value)}
              disabled={!institutionCode}
              hint="Exactly 10 digits. Leading zeroes are kept."
              aria-invalid={
                accountCheck !== null && !accountCheck.ok ? true : undefined
              }
            />
            {accountCheck && !accountCheck.ok ? (
              <p className="mt-2 text-sm text-error" role="alert">
                {accountCheck.message}
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={
              !institutionCode || !accountCheck?.ok || verification.isVerifying
            }
            onClick={() => {
              void (async () => {
                const result = await verification.verify({
                  institution: institutionCode,
                  institutionName: selectedInstitution?.name ?? "",
                  accountIdentifier: accountNumber,
                });
                if (result) {
                  onVerifiedChange(result);
                } else {
                  onVerifiedChange(null);
                }
              })();
            }}
          >
            {verification.isVerifying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Verifying…
              </>
            ) : (
              "Verify account"
            )}
          </Button>

          {verification.state.kind === "error" ? (
            <p className="text-sm text-error" role="alert">
              {verification.state.message}
            </p>
          ) : null}

          {verified ? (
            <div
              className="rounded-[8px] border-2 border-success/40 bg-cream px-4 py-3"
              role="status"
            >
              <div className="flex items-start gap-2">
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 text-success"
                  aria-hidden
                />
                <div className="space-y-1 text-sm">
                  <p className="font-semibold text-ink">
                    Account verified
                  </p>
                  <p className="text-ink">
                    <span className="text-receipt-grey">Name: </span>
                    {verified.accountName}
                  </p>
                  <p className="text-ink">
                    <span className="text-receipt-grey">Bank: </span>
                    {verified.institutionName}
                  </p>
                  <p className="font-sans text-[12px] text-ink">
                    Account:{" "}
                    {maskAccountIdentifier(verified.accountIdentifier)}
                  </p>
                  <p className="text-xs text-receipt-grey">
                    Verified via payout provider ·{" "}
                    {new Date(verified.verifiedAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
