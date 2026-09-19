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
  locked?: boolean;
  onVerifiedChange: (recipient: VerifiedRecipientBinding | null) => void;
};

export function CashOutRecipient({
  enabled,
  locked = false,
  onVerifiedChange,
}: CashOutRecipientProps) {
  const institutions = useNgnInstitutions(enabled);
  const verification = useAccountVerification();
  const [institutionCode, setInstitutionCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankQuery, setBankQuery] = useState("");
  const [bankOpen, setBankOpen] = useState(false);
  const [activeBankIndex, setActiveBankIndex] = useState(0);

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
    const selected = institutions.state.kind === "ready"
      ? institutions.state.institutions.find((institution) => institution.code === code)
      : null;
    setBankQuery(selected?.name ?? "");
    setBankOpen(false);
    setActiveBankIndex(0);
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
        <div className="mt-4 flex items-center gap-2 text-sm text-receipt-grey" role="status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading NGN banks…
        </div>
      ) : null}

      {institutions.state.kind === "error" ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-loss-red" role="alert">
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
        <p className="mt-4 text-sm text-ledger-stone" role="status">
          No supported NGN banks are available right now. Cash-out recipient
          setup is temporarily unavailable.
        </p>
      ) : null}

      {institutions.state.kind === "ready" ? (
        <div className="mt-5 space-y-5">
          <div>
            <label
              htmlFor="bank-search"
              className="text-sm font-semibold text-ledger-stone"
            >
              Bank
            </label>
            <input
              id="bank-search"
              role="combobox"
              aria-controls="bank-options"
              aria-expanded={bankOpen}
              aria-autocomplete="list"
              aria-activedescendant={bankOpen && filteredBanks[activeBankIndex] ? `bank-option-${filteredBanks[activeBankIndex].code}` : undefined}
              className="mt-1.5 min-h-12 w-full rounded-[10px] border-ledger bg-clear-paper px-4 py-3 text-base text-ledger-stone shadow-base focus:outline-none focus:shadow-elevated"
              placeholder="Search banks…"
              value={bankQuery}
              disabled={locked}
              onFocus={() => setBankOpen(true)}
              onChange={(e) => {
                setBankQuery(e.target.value);
                setBankOpen(true);
                setActiveBankIndex(0);
                if (institutionCode) {
                  setInstitutionCode("");
                  verification.clear();
                  onVerifiedChange(null);
                }
              }}
              onKeyDown={(event) => {
                if (!filteredBanks.length) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setBankOpen(true);
                  setActiveBankIndex((index) => Math.min(index + 1, filteredBanks.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setBankOpen(true);
                  setActiveBankIndex((index) => Math.max(index - 1, 0));
                } else if (event.key === "Home") {
                  event.preventDefault();
                  setActiveBankIndex(0);
                } else if (event.key === "End") {
                  event.preventDefault();
                  setActiveBankIndex(filteredBanks.length - 1);
                } else if (event.key === "Enter" && bankOpen) {
                  event.preventDefault();
                  const bank = filteredBanks[activeBankIndex];
                  if (bank) handleBankChange(bank.code);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setBankOpen(false);
                }
              }}
              autoComplete="off"
            />
            {bankOpen ? <div
              id="bank-options"
              className="mt-2 max-h-48 overflow-y-auto rounded-[10px] border-ledger bg-receipt-field"
              role="listbox"
              aria-label="Nigerian banks"
            >
              {filteredBanks.length === 0 ? (
                <p className="px-3 py-3 text-sm text-receipt-grey">
                  No banks match your search.
                </p>
              ) : (
                filteredBanks.map((bank, index) => {
                  const selected = bank.code === institutionCode;
                  return (
                    <button
                      key={bank.code}
                      type="button"
                      id={`bank-option-${bank.code}`}
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 border-b border-ledger-edge px-3 py-2.5 text-left text-sm last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-provident-green",
                        selected
                          ? "bg-provident-green text-white"
                          : "text-ledger-stone hover:bg-ledger-edge/50",
                      )}
                      onMouseEnter={() => setActiveBankIndex(index)}
                      onClick={() => handleBankChange(bank.code)}
                      disabled={locked}
                    >
                      <span className="font-semibold">{bank.name}</span>
                    </button>
                  );
                })
              )}
            </div> : null}
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
              disabled={locked || !institutionCode}
              hint="Exactly 10 digits. Leading zeroes are kept."
              error={accountCheck && !accountCheck.ok ? accountCheck.message : undefined}
              aria-invalid={
                accountCheck !== null && !accountCheck.ok ? true : undefined
              }
            />
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={
              locked || !institutionCode || !accountCheck?.ok || verification.isVerifying
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
            <p className="text-sm text-loss-red" role="alert">
              {verification.state.message}
            </p>
          ) : null}

          {verified ? (
            <div
              className="rounded-[10px] border border-provident-green/40 bg-receipt-field px-4 py-3"
              role="status"
            >
              <div className="flex items-start gap-2">
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 text-provident-green"
                  aria-hidden
                />
                <div className="space-y-1 text-sm">
                  <p className="font-semibold text-ledger-stone">
                    Account verified
                  </p>
                  <p className="text-ledger-stone">
                    <span className="text-receipt-grey">Name: </span>
                    {verified.accountName}
                  </p>
                  <p className="text-ledger-stone">
                    <span className="text-receipt-grey">Bank: </span>
                    {verified.institutionName}
                  </p>
                  <p className="font-proof text-[12px] text-ledger-stone">
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
