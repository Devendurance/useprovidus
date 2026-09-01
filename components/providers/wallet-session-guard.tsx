"use client";

import { useEffect, useRef } from "react";
import { useAccount, useConfig, useDisconnect } from "wagmi";
import {
  clearObsoleteWalletSessionClient,
  shouldInvalidateConnectorSession,
} from "@/lib/wallet/session-migration";
import { isSupportedConnectorId } from "@/lib/wallet/supported-wallets";

/**
 * On mount, drop reconnection to generic/Phantom/unsupported connectors.
 * Does not auto-connect a different wallet.
 */
export function WalletSessionGuard() {
  const { connector, isConnected, isReconnecting } = useAccount();
  const { disconnect } = useDisconnect();
  const config = useConfig();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const cookieResult = clearObsoleteWalletSessionClient();

    const connectorId = connector?.id;
    if (
      connectorId &&
      shouldInvalidateConnectorSession(connectorId) &&
      (isConnected || isReconnecting)
    ) {
      void disconnect();
      return;
    }

    // If storage still thinks we are on unsupported connector, force disconnect once.
    void (async () => {
      try {
        const recent = await config.storage?.getItem("recentConnectorId");
        const recentId =
          typeof recent === "string"
            ? recent
            : recent != null
              ? String(recent)
              : null;
        if (shouldInvalidateConnectorSession(recentId)) {
          await config.storage?.removeItem("recentConnectorId");
          if (isConnected || isReconnecting) {
            void disconnect();
          }
        }
      } catch {
        // ignore storage shape differences
      }
    })();

    void cookieResult;
  }, [config.storage, connector?.id, disconnect, isConnected, isReconnecting]);

  // Ongoing: if somehow an unsupported connector becomes active, disconnect.
  useEffect(() => {
    if (!connector?.id) return;
    if (!isSupportedConnectorId(connector.id) && isConnected) {
      void disconnect();
    }
  }, [connector?.id, disconnect, isConnected]);

  return null;
}
