export type WalletAuthStatus =
  | "disconnected"
  | "unauthenticated"
  | "awaiting-signature"
  | "authenticated"
  | "reauthentication-required";

export const walletAuthStatusCopy: Record<WalletAuthStatus, string> = {
  disconnected: "Connect wallet",
  unauthenticated: "Sign in to use saved recipients and payments",
  "awaiting-signature": "Confirm sign-in in your wallet",
  authenticated: "Wallet verified",
  "reauthentication-required": "Sign in again to continue",
};

export function normalizeWalletAddress(address: string | null | undefined): string | null {
  return address ? address.toLowerCase() : null;
}

export function isSameWalletAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const normalizedA = normalizeWalletAddress(a);
  const normalizedB = normalizeWalletAddress(b);
  return normalizedA !== null && normalizedA === normalizedB;
}

export function shouldRequireReauthenticationAfterAccountChange(
  previousSessionAddress: string | null | undefined,
  nextAddress: string | null | undefined,
): boolean {
  return Boolean(previousSessionAddress && nextAddress);
}

export function getWalletAuthStatus(input: {
  connected: boolean;
  address: string | null | undefined;
  sessionAddress: string | null | undefined;
  signing?: boolean;
  reauthenticationRequired?: boolean;
}): WalletAuthStatus {
  if (!input.connected || !input.address) return "disconnected";
  if (input.signing) return "awaiting-signature";
  if (input.reauthenticationRequired) return "reauthentication-required";
  if (!input.sessionAddress) return "unauthenticated";
  return isSameWalletAddress(input.address, input.sessionAddress)
    ? "authenticated"
    : "reauthentication-required";
}

export type WalletAuthRequestStamp = {
  address: string | null;
  accountRevision: number;
  requestRevision: number;
};

export function isCurrentWalletAuthRequest(
  captured: WalletAuthRequestStamp,
  current: WalletAuthRequestStamp,
): boolean {
  return captured.accountRevision === current.accountRevision &&
    captured.requestRevision === current.requestRevision &&
    normalizeWalletAddress(captured.address) === normalizeWalletAddress(current.address);
}

export function shouldDispatchWalletSessionExpired(
  status: number,
  purpose: "session-probe" | "sign-in" | "protected",
): boolean {
  return status === 401 && purpose === "protected";
}
