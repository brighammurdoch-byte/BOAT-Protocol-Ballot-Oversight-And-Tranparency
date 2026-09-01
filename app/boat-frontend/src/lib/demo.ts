import { Connection, PublicKey } from "@solana/web3.js";

type WalletLike = {
  publicKey: PublicKey;
  signTransaction: (tx: any) => Promise<any>;
  signAllTransactions: (txs: any[]) => Promise<any[]>;
};

/** Wallet / fetch abort — must never look like a silent form reset. */
export function isAbortError(err: unknown): boolean {
  if (err == null) return false;
  const name =
    typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  const raw = err instanceof Error ? err.message : String(err);
  const blob = `${name} ${raw}`.toLowerCase();
  return (
    name === "AbortError" ||
    blob.includes("aborterror") ||
    blob.includes("the user aborted") ||
    blob.includes("signal is aborted") ||
    blob.includes("operation was aborted") ||
    blob.includes("request was aborted") ||
    blob.includes("aborted without reason")
  );
}

/**
 * Only the Cast / change vote click may send. Radios must pass armed=false.
 */
export function canSendVoteTx(armed: boolean, selected: number | null): boolean {
  return armed === true && selected !== null;
}

/** Connection that is not torn down when a React provider remounts. */
export function durableConnection(connection: Connection): Connection {
  return new Connection(connection.rpcEndpoint, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });
}

/** Sign through the adapter instance so a remount cannot abort the wallet request. */
export function durableWallet(wallet: any): WalletLike {
  if (!wallet?.publicKey) {
    throw new Error("Connect a wallet first.");
  }
  const adapter = wallet.wallet?.adapter;
  const publicKey = wallet.publicKey;
  return {
    publicKey,
    signTransaction: async (tx) => {
      const fn = adapter?.signTransaction?.bind(adapter) ?? wallet.signTransaction;
      if (!fn) throw new Error("Connect a wallet first.");
      return fn(tx);
    },
    signAllTransactions: async (txs) => {
      const fn =
        adapter?.signAllTransactions?.bind(adapter) ?? wallet.signAllTransactions;
      if (!fn) throw new Error("Connect a wallet first.");
      return fn(txs);
    },
  };
}

/** Fetches must not be able to open Phantom. */
export function readOnlyWallet(publicKey?: PublicKey | null): WalletLike {
  return {
    publicKey: publicKey ?? PublicKey.default,
    signTransaction: async () => {
      throw new Error("Read-only account fetch must not open the wallet.");
    },
    signAllTransactions: async () => {
      throw new Error("Read-only account fetch must not open the wallet.");
    },
  };
}

/** Map common Solana / Anchor errors to demo-friendly copy. */
export function friendlyError(err: unknown): string {
  if (isAbortError(err)) {
    return "The request was interrupted before a transaction landed. Nothing was silently reset — click Create again (same title) if the election PDA is still empty.";
  }
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (!raw.trim()) {
    return "Create/vote failed with no error details. Check that Phantom is on Devnet and try again — the form was not submitted.";
  }
  if (lower.includes("connect") && lower.includes("wallet")) {
    return "Connect a Solana wallet (Phantom or Solflare) first.";
  }
  if (lower.includes("trust")) {
    return "Trust Wallet is not supported on this site. Use Phantom or Solflare.";
  }
  if (lower.includes("electionnotstarted") || lower.includes("has not started")) {
    return "Voting has not opened yet. Wait until the election start time, then try again.";
  }
  if (
    lower.includes("electionalreadystarted") ||
    lower.includes("voting has already started")
  ) {
    return "Voting already started, so new candidates cannot be added. Create a new election (Start at 0 reserves about 10 minutes so candidates can land).";
  }
  if (lower.includes("invalidoutcomeindex") || lower.includes("invalid outcome index")) {
    return "A candidate transaction was simulated before the previous one confirmed. Retry — later candidates are now sent in one batched transaction.";
  }
  if (lower.includes("electionended") || lower.includes("already over")) {
    return "This election has ended. New votes are not accepted.";
  }
  if (lower.includes("notwhitelisted") || lower.includes("not whitelisted")) {
    return "This wallet is not registered for this election. Ask the election admin to register your pubkey.";
  }
  if (lower.includes("accountnotfound") || lower.includes("account does not exist")) {
    return "Election or voter account not found on this cluster. Check the PDA and that you are on Solana Devnet.";
  }
  if (lower.includes("user rejected") || lower.includes("rejected the request")) {
    return "Transaction was rejected in the wallet.";
  }
  if (lower.includes("insufficient") && lower.includes("fund")) {
    return "Wallet needs more SOL for fees. Use a Devnet faucet, then retry.";
  }
  if (lower.includes("invalid public key") || lower.includes("non-base58")) {
    return "That does not look like a valid base58 public key / election PDA.";
  }
  if (
    lower.includes("already in use") ||
    lower.includes("already been processed") ||
    lower.includes("already exists on devnet") ||
    lower.includes("duplicate election title")
  ) {
    return "This account may already exist (duplicate title or already registered). Try a new title, or click Create again to add any missing candidates.";
  }
  if (lower.includes("transaction simulation failed")) {
    return raw;
  }
  if (
    lower.includes("block height exceeded") ||
    (lower.includes("expired") && lower.includes("block"))
  ) {
    return "A signed transaction expired before Devnet accepted it. The app rebroadcasts the same signature until the blockhash is dead, then asks the wallet once more. Click Create again with the same title if the election PDA is filled but candidates are still missing.";
  }
  if (
    lower.includes("blockhash not found") ||
    lower.includes("failed to simulate") ||
    lower.includes("simulation failed") ||
    lower.includes("proceeding is unsafe")
  ) {
    return "The transaction was not sent — Phantom blocked simulation. This is usually a follow-up tx that ran before the previous one confirmed (or a duplicate title/register). Retry once; create now waits for confirm before adding candidates.";
  }
  return raw;
}

export function formatLocal(tsSec: number): string {
  return new Date(tsSec * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function countdownLabel(startSec: number, nowMs = Date.now()): string {
  const delta = startSec * 1000 - nowMs;
  if (delta <= 0) return "Voting is open";
  const mins = Math.ceil(delta / 60000);
  if (mins < 60) return `Opens in ~${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `Opens in ~${hours}h ${rem}m`;
}

export function readPdaQuery(): string {
  if (typeof window === "undefined") return "";
  try {
    return new URLSearchParams(window.location.search).get("pda")?.trim() ?? "";
  } catch {
    return "";
  }
}

export function explorerWalletUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
