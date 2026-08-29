"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";

/** Wallets we actively support for the USU / GitHub Pages demo. */
const SUPPORTED = new Set(["Phantom", "Solflare"]);

function shortKey(key: string): string {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * Wallet control that only offers Phantom and Solflare.
 * Trust and other Wallet-Standard injections still exist in the adapter
 * registry, but selecting them hangs on many browsers — so we hide them.
 */
export default function BoatWalletButton() {
  const { wallets, publicKey, connected, connecting, select, connect, disconnect } =
    useWallet();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const options = useMemo(
    () =>
      wallets.filter(
        (w) =>
          SUPPORTED.has(w.adapter.name) &&
          w.readyState !== "Unsupported"
      ),
    [wallets]
  );

  useEffect(() => {
    if (!open) setErr(null);
  }, [open]);

  const onPick = useCallback(
    async (name: WalletName) => {
      setErr(null);
      try {
        select(name);
        setOpen(false);
        // Adapter swap is async in context; autoConnect handles most cases.
        // Explicit connect covers when autoConnect already ran for another wallet.
        await new Promise((r) => setTimeout(r, 50));
        await connect();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // Already connected / in-progress is fine
        if (/already.*connect|WalletNotSelected/i.test(msg)) return;
        setOpen(true);
        setErr(
          msg.includes("User rejected") || msg.includes("rejected")
            ? "Connection cancelled in the wallet."
            : `Could not connect to ${name}. Install the extension, unlock it, and try again.`
        );
      }
    },
    [select, connect]
  );

  if (connected && publicKey) {
    return (
      <button
        type="button"
        className="wallet-adapter-button wallet-adapter-button-trigger"
        onClick={() => void disconnect()}
        title="Disconnect wallet"
      >
        {shortKey(publicKey.toBase58())}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className="wallet-adapter-button wallet-adapter-button-trigger"
        disabled={connecting}
        onClick={() => setOpen(true)}
      >
        {connecting ? "Connecting…" : "Select Wallet"}
      </button>

      {open && (
        <div
          className="boat-wallet-backdrop"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            className="boat-wallet-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="boat-wallet-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="boat-wallet-close"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
            <h2 id="boat-wallet-title">Connect a Solana wallet</h2>
            <p className="boat-wallet-hint">
              Use Phantom or Solflare (browser extension or in-app browser). Trust
              Wallet is not supported here and will hang if selected elsewhere.
            </p>
            <ul className="boat-wallet-list">
              {options.map((w) => (
                <li key={w.adapter.name}>
                  <button
                    type="button"
                    className="boat-wallet-option"
                    disabled={connecting}
                    onClick={() => void onPick(w.adapter.name)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={w.adapter.icon} alt="" width={28} height={28} />
                    <span>{w.adapter.name}</span>
                    <span className="boat-wallet-ready">
                      {w.readyState === "Installed" ? "Detected" : "Install"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {options.length === 0 && (
              <p className="boat-wallet-hint">
                No supported wallet detected. Install{" "}
                <a href="https://phantom.app/" target="_blank" rel="noreferrer">
                  Phantom
                </a>{" "}
                or{" "}
                <a href="https://solflare.com/" target="_blank" rel="noreferrer">
                  Solflare
                </a>
                , then refresh.
              </p>
            )}
            {err && <p className="boat-wallet-error">{err}</p>}
          </div>
        </div>
      )}
    </>
  );
}
