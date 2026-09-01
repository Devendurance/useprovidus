/**
 * Narrow migration for obsolete connector sessions (generic injected / Phantom / WC).
 * Clears only wagmi cookie storage keys related to connection state.
 */

import {
  isSupportedConnectorId,
  isUnsupportedPersistedConnectorId,
} from "@/lib/wallet/supported-wallets";

/** Keys wagmi may store for connection state in cookieStorage. */
const WAGMI_STORE_KEY = "wagmi.store";
const RECENT_CONNECTOR_KEY = "wagmi.recentConnectorId";

export type PersistedWagmiSlice = {
  state?: {
    connections?: {
      __type?: string;
      value?: Map<string, unknown> | Record<string, unknown>;
    };
    current?: string;
  };
  recentConnectorId?: string;
};

/**
 * Pure: decide whether a recentConnectorId should be dropped.
 */
export function shouldInvalidateConnectorSession(
  recentConnectorId: string | null | undefined,
): boolean {
  if (!recentConnectorId) return false;
  if (isSupportedConnectorId(recentConnectorId)) return false;
  return isUnsupportedPersistedConnectorId(recentConnectorId);
}

/**
 * Read recent connector id from a cookie header string (server or client).
 */
export function parseRecentConnectorIdFromCookie(
  cookieHeader: string | null | undefined,
): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    if (part.startsWith(`${RECENT_CONNECTOR_KEY}=`)) {
      return decodeURIComponent(part.slice(RECENT_CONNECTOR_KEY.length + 1));
    }
    // Sometimes nested in wagmi.store JSON
    if (part.startsWith(`${WAGMI_STORE_KEY}=`)) {
      try {
        const raw = decodeURIComponent(part.slice(WAGMI_STORE_KEY.length + 1));
        const parsed = JSON.parse(raw) as {
          state?: { current?: string };
          recentConnectorId?: string;
        };
        if (parsed.recentConnectorId) return String(parsed.recentConnectorId);
        if (parsed.state?.current) return String(parsed.state.current);
      } catch {
        // ignore malformed
      }
    }
  }
  return null;
}

/**
 * Client-only: clear obsolete connector session from cookieStorage-backed keys
 * without wiping unrelated site cookies.
 */
export function clearObsoleteWalletSessionClient(): {
  cleared: boolean;
  reason: string | null;
} {
  if (typeof document === "undefined") {
    return { cleared: false, reason: null };
  }

  const recent = parseRecentConnectorIdFromCookie(document.cookie);
  if (!shouldInvalidateConnectorSession(recent)) {
    return { cleared: false, reason: null };
  }

  // Expire only known wagmi connection cookies for this site.
  const expire = "Max-Age=0; path=/; SameSite=Lax";
  document.cookie = `${RECENT_CONNECTOR_KEY}=; ${expire}`;
  document.cookie = `${WAGMI_STORE_KEY}=; ${expire}`;
  // Shim keys for legacy generic injected
  document.cookie = `injected.connected=; ${expire}`;
  document.cookie = `injected.disconnected=; ${expire}`;
  document.cookie = `phantom.disconnected=; ${expire}`;

  return {
    cleared: true,
    reason: `Unsupported connector session invalidated: ${recent}`,
  };
}

export { isSupportedConnectorId };
