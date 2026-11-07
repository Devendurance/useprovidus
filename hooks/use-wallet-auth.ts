"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";

export async function walletApi<T>(path: string, body?: unknown, method?: string, expectedOwner?: string | null): Promise<T> {
  const response = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(expectedOwner ? { "X-Providus-Wallet": expectedOwner } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await response.json();
  if (!response.ok || !json.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("providus-session-expired"));
    throw new Error(json.error?.message ?? "Request failed. Recheck before trying again.");
  }
  return json as T;
}

export function useWalletAuth() {
  const { address, chainId, isConnected } = useAccount();
  const { data: wallet } = useWalletClient();
  const [session, setSession] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const owner = isConnected && address?.toLowerCase() === session?.toLowerCase() ? session : null;

  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    const check = async () => {
      try {
        const result = await walletApi<{ address: string }>("/api/auth/session");
        if (active && current === generation.current) setSession(result.address.toLowerCase() === address?.toLowerCase() ? result.address : null);
      } catch { if (active) setSession(null); }
    };
    const invalidate = () => { ++generation.current; setSession(null); };
    void check();
    const timer = setInterval(check, 30_000);
    window.addEventListener("providus-session-expired", invalidate);
    window.addEventListener("focus", check);
    return () => { active = false; clearInterval(timer); window.removeEventListener("providus-session-expired", invalidate); window.removeEventListener("focus", check); };
  }, [address, isConnected]);

  const signIn = useCallback(async () => {
    if (!wallet || !address || !chainId || busy) return;
    const current = generation.current;
    setBusy(true); setError(null);
    try {
      const challenge = await walletApi<{ message: string }>("/api/auth/challenge", { address, chainId });
      const signature = await wallet.signMessage({ account: address, message: challenge.message });
      if (current !== generation.current || (await wallet.getAddresses())[0]?.toLowerCase() !== address.toLowerCase()) throw new Error("Wallet changed. Sign in again.");
      const verified = await walletApi<{ address: string }>("/api/auth/verify", { message: challenge.message, signature });
      if (verified.address.toLowerCase() !== address.toLowerCase() || current !== generation.current) throw new Error("Session wallet mismatch. Sign in again.");
      setSession(verified.address);
    } catch (err) { setSession(null); setError(err instanceof Error ? err.message : "Sign-in failed or was rejected."); }
    finally { setBusy(false); }
  }, [wallet, address, chainId, busy]);

  return { owner, address, chainId, busy, error, signIn };
}

export type WalletAuth = ReturnType<typeof useWalletAuth>;
