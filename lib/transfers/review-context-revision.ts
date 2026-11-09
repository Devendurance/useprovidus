type Listener = () => void;

let revision = 0;
let walletContextKey: string | null = null;
const listeners = new Set<Listener>();

export function getWalletReviewContextRevision() {
  return revision;
}

export function subscribeWalletReviewContextRevision(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function bumpWalletReviewContextRevision() {
  revision += 1;
  for (const listener of listeners) listener();
}

export function publishWalletReviewContext(key: string | null) {
  if (walletContextKey === key) return;
  walletContextKey = key;
  bumpWalletReviewContextRevision();
}
