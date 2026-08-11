"use client";

import React, { useCallback, useEffect, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import {
  WalletAdapterNetwork,
  type Adapter,
  type WalletError,
} from "@solana/wallet-adapter-base";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";

const SUPPORTED = new Set(["Phantom", "Solflare"]);
const WALLET_STORAGE_KEY = "walletName";

function endpointFromEnv(): string {
  const e = process.env.NEXT_PUBLIC_SOLANA_RPC;
  if (e && e.length > 0) return e;
  return clusterApiUrl(WalletAdapterNetwork.Devnet);
}

function clearUnsupportedWalletSelection() {
  try {
    const raw = localStorage.getItem(WALLET_STORAGE_KEY);
    if (!raw) return;
    const name = JSON.parse(raw) as string;
    if (!SUPPORTED.has(name)) {
      localStorage.removeItem(WALLET_STORAGE_KEY);
    }
  } catch {
    localStorage.removeItem(WALLET_STORAGE_KEY);
  }
}

export default function BoatWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const endpoint = useMemo(() => endpointFromEnv(), []);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  useEffect(() => {
    // Trust (and other Wallet-Standard wallets) can leave a stuck "Connecting…"
    // selection in localStorage after a failed connect.
    clearUnsupportedWalletSelection();
  }, []);

  const onError = useCallback((error: WalletError) => {
    console.error(error);
    clearUnsupportedWalletSelection();
  }, []);

  const autoConnect = useCallback(
    (adapter: Adapter) => SUPPORTED.has(adapter.name),
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider
        wallets={wallets}
        autoConnect={autoConnect}
        localStorageKey={WALLET_STORAGE_KEY}
        onError={onError}
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
