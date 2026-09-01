/**
 * Move Money direction ↔ Paycrest side mapping.
 */

export type MoveDirection = "buy-usdc" | "cash-out";
export type PaycrestSide = "buy" | "sell";

/** User-facing direction → API side. */
export function directionToSide(direction: MoveDirection): PaycrestSide {
  return direction === "buy-usdc" ? "buy" : "sell";
}

export function sideToDirection(side: PaycrestSide): MoveDirection {
  return side === "buy" ? "buy-usdc" : "cash-out";
}

export function directionLabel(direction: MoveDirection): string {
  return direction === "buy-usdc" ? "Buy USDC" : "Cash out";
}

export function directionDescription(direction: MoveDirection): string {
  return direction === "buy-usdc"
    ? "NGN → USDC on Celo"
    : "USDC on Celo → NGN";
}

export function walletRoleForDirection(direction: MoveDirection): string {
  return direction === "buy-usdc"
    ? "Destination for USDC on Celo"
    : "Source of USDC on Celo";
}
