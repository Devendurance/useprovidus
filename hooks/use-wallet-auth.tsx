"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useHydrated } from "@/lib/wallet/hydration";
import {
  getWalletAuthStatus,
  isCurrentWalletAuthRequest,
  isSameWalletAddress,
  normalizeWalletAddress,
  shouldRequireReauthenticationAfterAccountChange,
  shouldDispatchWalletSessionExpired,
  walletAuthStatusCopy,
  type WalletAuthRequestStamp,
  type WalletAuthStatus,
} from "@/lib/auth/wallet-ui-state";

export class WalletApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WalletApiError";
    this.status = status;
  }
}

type WalletApiOptions = { purpose?: "session-probe" | "sign-in" | "protected" };

export async function walletApi<T>(
  path: string,
  body?: unknown,
  method?: string,
  expectedOwner?: string | null,
  options: WalletApiOptions = {},
): Promise<T> {
  const response = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(expectedOwner ? { "X-Providus-Wallet": expectedOwner } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  let json: { ok?: boolean; error?: { message?: string } | string };
  try {
    json = await response.json();
  } catch {
    json = {};
  }
  if (!response.ok || !json.ok) {
    const purpose = options.purpose ?? "protected";
    if (shouldDispatchWalletSessionExpired(response.status, purpose) && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("providus-session-expired", {
        detail: { owner: expectedOwner ? normalizeWalletAddress(expectedOwner) : null },
      }));
    }
    const message = typeof json.error === "object" && json.error
      ? json.error.message
      : typeof json.error === "string"
        ? json.error
        : "Request failed. Recheck before trying again.";
    throw new WalletApiError(message ?? "Request failed. Recheck before trying again.", response.status);
  }
  return json as T;
}

export type WalletAuth = {
  owner: string | null;
  address: string | undefined;
  chainId: number | undefined;
  status: WalletAuthStatus;
  statusCopy: string;
  busy: boolean;
  checking: boolean;
  error: string | null;
  hydrated: boolean;
  signIn(): Promise<void>;
  refreshSession(): Promise<void>;
};

const WalletAuthContext = createContext<WalletAuth | null>(null);

export function WalletAuthProvider({ children }: { children: ReactNode }) {
  const auth = useWalletAuthController();
  return <WalletAuthContext.Provider value={auth}>{children}</WalletAuthContext.Provider>;
}

export function useWalletAuth(): WalletAuth {
  const auth = useContext(WalletAuthContext);
  if (!auth) throw new Error("useWalletAuth must be used inside WalletAuthProvider");
  return auth;
}

function useWalletAuthController(): WalletAuth {
  const { address, chainId, isConnected, isReconnecting } = useAccount();
  const { data: wallet } = useWalletClient();
  const [sessionAddress, setSessionAddressState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [requiresReauthentication, setRequiresReauthenticationState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useHydrated();

  const connected = Boolean(address) && (isConnected || isReconnecting);
  const accountKey = connected ? normalizeWalletAddress(address) : null;
  const currentRef = useRef({ address: accountKey, connected, chainId, wallet });
  useEffect(() => {
    currentRef.current = { address: accountKey, connected, chainId, wallet };
  }, [accountKey, connected, chainId, wallet]);

  const sessionRef = useRef<string | null>(null);
  const requiresReauthenticationRef = useRef(false);
  const accountRevisionRef = useRef(0);
  const requestRevisionRef = useRef(0);
  const previousAccountRef = useRef<string | null>(accountKey);
  const signInLockRef = useRef<number | null>(null);
  const refreshPromiseRef = useRef<{ address: string; promise: Promise<void> } | null>(null);

  const setSessionAddress = useCallback((value: string | null) => {
    sessionRef.current = value;
    setSessionAddressState(value);
  }, []);

  const setRequiresReauthentication = useCallback((value: boolean) => {
    requiresReauthenticationRef.current = value;
    setRequiresReauthenticationState(value);
  }, []);

  const stamp = useCallback((requestRevision: number, requestAddress: string | null): WalletAuthRequestStamp => ({
    address: requestAddress,
    accountRevision: accountRevisionRef.current,
    requestRevision,
  }), []);

  const isCurrent = useCallback((captured: WalletAuthRequestStamp) => isCurrentWalletAuthRequest(captured, {
    address: currentRef.current.address,
    accountRevision: accountRevisionRef.current,
    requestRevision: requestRevisionRef.current,
  }), []);

  useEffect(() => {
    if (previousAccountRef.current === accountKey) return;
    const previousSessionAddress = sessionRef.current;
    previousAccountRef.current = accountKey;
    accountRevisionRef.current += 1;
    requestRevisionRef.current += 1;
    signInLockRef.current = null;
    setSessionAddress(null);
    setRequiresReauthentication(shouldRequireReauthenticationAfterAccountChange(previousSessionAddress, accountKey));
    setError(null);
    setBusy(false);
    setChecking(false);
  }, [accountKey, setRequiresReauthentication, setSessionAddress]);

  useEffect(() => {
    const invalidate = (event: Event) => {
      const detail = (event as CustomEvent<{ owner?: string | null }>).detail;
      const expiredOwner = detail?.owner ?? null;
      const currentAddress = currentRef.current.address;
      if (expiredOwner && !isSameWalletAddress(expiredOwner, currentAddress)) return;
      if (!currentAddress) return;
      if (signInLockRef.current !== null) return;
      requestRevisionRef.current += 1;
      setSessionAddress(null);
      setRequiresReauthentication(true);
      setChecking(false);
      setError(null);
    };
    window.addEventListener("providus-session-expired", invalidate);
    return () => window.removeEventListener("providus-session-expired", invalidate);
  }, [setRequiresReauthentication, setSessionAddress]);

  const refreshSession = useCallback(async () => {
    const requestAddress = currentRef.current.address;
    if (!requestAddress || !currentRef.current.connected) return;
    if (signInLockRef.current !== null) return;
    if (refreshPromiseRef.current?.address === requestAddress) return refreshPromiseRef.current.promise;

    const revision = ++requestRevisionRef.current;
    const captured = stamp(revision, requestAddress);
    setChecking(true);
    const pending = (async () => {
      try {
        const result = await walletApi<{ address: string }>("/api/auth/session", undefined, undefined, null, { purpose: "session-probe" });
        if (!isCurrent(captured)) return;
        if (isSameWalletAddress(result.address, requestAddress)) {
          setSessionAddress(result.address);
          setRequiresReauthentication(false);
          setError(null);
        } else {
          setSessionAddress(null);
          setRequiresReauthentication(true);
          setError(null);
        }
      } catch (err) {
        if (!isCurrent(captured)) return;
        if (err instanceof WalletApiError && err.status === 401) {
          const hadVerifiedSession = isSameWalletAddress(sessionRef.current, requestAddress);
          setSessionAddress(null);
          setRequiresReauthentication(hadVerifiedSession || requiresReauthenticationRef.current);
          setError(null);
        } else {
          setError("Could not check wallet sign-in status. Try again.");
        }
      } finally {
        if (isCurrent(captured)) setChecking(false);
      }
    })();
    const refreshRequest = { address: requestAddress, promise: pending };
    refreshPromiseRef.current = refreshRequest;
    try {
      await pending;
    } finally {
      if (refreshPromiseRef.current === refreshRequest) refreshPromiseRef.current = null;
    }
  }, [isCurrent, setRequiresReauthentication, setSessionAddress, stamp]);

  const signIn = useCallback(async () => {
    const current = currentRef.current;
    if (!current.wallet || !current.address || !current.chainId || !current.connected || signInLockRef.current !== null) return;

    const attempt = ++requestRevisionRef.current;
    const captured = stamp(attempt, current.address);
    signInLockRef.current = attempt;
    setBusy(true);
    setChecking(false);
    setError(null);
    try {
      const challenge = await walletApi<{ message: string }>("/api/auth/challenge", { address, chainId: current.chainId }, undefined, null, { purpose: "sign-in" });
      const signature = await current.wallet.signMessage({ account: address!, message: challenge.message });
      if (!isCurrent(captured) || !isSameWalletAddress((await current.wallet.getAddresses())[0], current.address)) {
        throw new Error("Wallet changed. Sign in again.");
      }
      const verified = await walletApi<{ address: string }>("/api/auth/verify", { message: challenge.message, signature }, undefined, null, { purpose: "sign-in" });
      if (!isCurrent(captured) || !isSameWalletAddress(verified.address, current.address)) {
        throw new Error("Session wallet mismatch. Sign in again.");
      }
      setSessionAddress(verified.address);
      setRequiresReauthentication(false);
      setError(null);
    } catch (err) {
      if (isCurrent(captured)) {
        const message = err instanceof Error ? err.message : "Sign-in failed or was rejected.";
        const lower = message.toLowerCase();
        const rejected = lower.includes("rejected") || lower.includes("denied");
        const mismatch = lower.includes("wallet changed") || lower.includes("session wallet mismatch");
        if (mismatch) {
          setRequiresReauthentication(true);
          setError(null);
        } else {
          setError(rejected ? "Sign-in was declined in your wallet. Choose sign in to try again." : message);
        }
      }
    } finally {
      if (signInLockRef.current === attempt) {
        signInLockRef.current = null;
        setBusy(false);
      }
    }
  }, [address, isCurrent, setRequiresReauthentication, setSessionAddress, stamp]);

  const owner = hydrated && connected && isSameWalletAddress(address, sessionAddress) ? sessionAddress : null;
  const status = hydrated ? getWalletAuthStatus({
    connected,
    address,
    sessionAddress,
    signing: busy,
    reauthenticationRequired: requiresReauthentication,
  }) : "disconnected";

  return useMemo(() => ({
    owner,
    address: hydrated ? address : undefined,
    chainId: hydrated ? chainId : undefined,
    status,
    statusCopy: walletAuthStatusCopy[status],
    busy,
    checking,
    error,
    hydrated,
    signIn,
    refreshSession,
  }), [owner, hydrated, address, chainId, status, busy, checking, error, signIn, refreshSession]);
}
