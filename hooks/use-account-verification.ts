"use client";

import { useCallback, useRef, useState } from "react";
import {
  isVerificationBoundToSelection,
  validateNgnAccountIdentifier,
  type VerifiedRecipientBinding,
} from "@/lib/paycrest/recipient";

export type VerificationUiState =
  | { kind: "idle" }
  | { kind: "invalid_account"; message: string }
  | { kind: "verifying" }
  | { kind: "verified"; recipient: VerifiedRecipientBinding }
  | { kind: "error"; code: string; message: string };

/**
 * Account verification against POST /api/paycrest/verify-account.
 * Call clear() when bank, account, or direction changes.
 * verify() returns the binding on success, null otherwise.
 */
export function useAccountVerification() {
  const [state, setState] = useState<VerificationUiState>({ kind: "idle" });
  const seq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    seq.current += 1;
    abortRef.current?.abort();
    setState({ kind: "idle" });
  }, []);

  const verify = useCallback(
    async (input: {
      institution: string;
      institutionName: string;
      accountIdentifier: string;
    }): Promise<VerifiedRecipientBinding | null> => {
      const accountCheck = validateNgnAccountIdentifier(
        input.accountIdentifier,
      );
      if (!accountCheck.ok) {
        setState({ kind: "invalid_account", message: accountCheck.message });
        return null;
      }
      if (!input.institution.trim()) {
        setState({
          kind: "error",
          code: "INVALID_INSTITUTION",
          message: "Select a bank",
        });
        return null;
      }

      const id = ++seq.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ kind: "verifying" });

      try {
        const res = await fetch("/api/paycrest/verify-account", {
          method: "POST",
          signal: controller.signal,
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            institution: input.institution,
            accountIdentifier: accountCheck.data,
          }),
        });
        const body = await res.json();
        if (id !== seq.current) return null;

        if (!res.ok || !body?.ok || !body?.verified) {
          setState({
            kind: "error",
            code: body?.error?.code ?? "UPSTREAM_ERROR",
            message: body?.error?.message ?? "Account verification failed",
          });
          return null;
        }

        const recipient: VerifiedRecipientBinding = {
          institution: String(body.recipient.institution),
          accountIdentifier: accountCheck.data,
          accountName: String(body.recipient.accountName),
          institutionName:
            typeof body.recipient.institutionName === "string"
              ? body.recipient.institutionName
              : input.institutionName,
          verifiedAt: String(body.verifiedAt),
        };

        if (
          !isVerificationBoundToSelection(
            recipient,
            input.institution,
            input.accountIdentifier,
          )
        ) {
          setState({ kind: "idle" });
          return null;
        }

        setState({ kind: "verified", recipient });
        return recipient;
      } catch (err) {
        if (id !== seq.current) return null;
        if (err instanceof DOMException && err.name === "AbortError") {
          return null;
        }
        setState({
          kind: "error",
          code: "PAYCREST_UNAVAILABLE",
          message: "Network error during verification",
        });
        return null;
      }
    },
    [],
  );

  function boundVerified(
    institution: string,
    accountIdentifier: string,
  ): VerifiedRecipientBinding | null {
    if (state.kind !== "verified") return null;
    if (
      !isVerificationBoundToSelection(
        state.recipient,
        institution,
        accountIdentifier,
      )
    ) {
      return null;
    }
    return state.recipient;
  }

  return {
    state,
    verify,
    clear,
    boundVerified,
    isVerifying: state.kind === "verifying",
  };
}
