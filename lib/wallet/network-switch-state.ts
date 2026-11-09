import type { SupportedChainKey } from "@/lib/chains/registry";
import type { WalletNetworkErrorKind } from "@/lib/wallet/network";

export type WalletNetworkSwitchState =
  | { status: "idle" }
  | { status: "requesting" | "slow"; target: SupportedChainKey }
  | { status: "confirmed"; target: SupportedChainKey }
  | { status: "failed"; target: SupportedChainKey; kind: WalletNetworkErrorKind; message: string };

type Snapshot = { state: WalletNetworkSwitchState; pending: boolean };
type Listener = () => void;

const IDLE_SNAPSHOT: Snapshot = Object.freeze({ state: Object.freeze({ status: "idle" as const }), pending: false });
let snapshot: Snapshot = IDLE_SNAPSHOT;
let activeRequest: number | null = null;
let nextRequest = 1;
let slowTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function publish(state: WalletNetworkSwitchState, pending: boolean) {
  snapshot = Object.freeze({ state, pending });
  for (const listener of listeners) listener();
}

export function subscribeWalletNetworkSwitch(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWalletNetworkSwitchSnapshot(): Snapshot {
  return snapshot;
}

export function getWalletNetworkSwitchServerSnapshot(): Snapshot {
  return IDLE_SNAPSHOT;
}

export function beginWalletNetworkSwitch(target: SupportedChainKey): number | null {
  if (activeRequest !== null) return null;
  const request = nextRequest++;
  activeRequest = request;
  publish({ status: "requesting", target }, true);
  slowTimer = setTimeout(() => {
    if (activeRequest === request) publish({ status: "slow", target }, true);
  }, 6_000);
  return request;
}

export function finishWalletNetworkSwitch(
  request: number,
  state: Exclude<WalletNetworkSwitchState, { status: "idle" | "requesting" | "slow" }>,
) {
  if (activeRequest !== request) return;
  activeRequest = null;
  if (slowTimer) clearTimeout(slowTimer);
  slowTimer = null;
  publish(state, false);
}

export function clearWalletNetworkSwitchMessage() {
  if (activeRequest !== null || snapshot.state.status === "idle") return;
  publish({ status: "idle" }, false);
}
