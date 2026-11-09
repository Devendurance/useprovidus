import { isSameWalletAddress } from "@/lib/auth/wallet-ui-state";

export type WalletReviewContext = {
  owner: string;
  address: string;
  chainId: number;
  intentId: string;
  termsFingerprint: string;
};

export function isSameWalletReviewContext(
  a: WalletReviewContext | null | undefined,
  b: WalletReviewContext | null | undefined,
): boolean {
  return Boolean(a && b &&
    isSameWalletAddress(a.owner, b.owner) &&
    isSameWalletAddress(a.address, b.address) &&
    a.chainId === b.chainId &&
    a.intentId === b.intentId &&
    a.termsFingerprint === b.termsFingerprint);
}
