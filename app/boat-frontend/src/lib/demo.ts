/** Map common Solana / Anchor errors to demo-friendly copy. */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("connect") && lower.includes("wallet")) {
    return "Connect a Solana wallet (Phantom or Solflare) first.";
  }
  if (lower.includes("trust")) {
    return "Trust Wallet is not supported on this site. Use Phantom or Solflare.";
  }
  if (lower.includes("electionnotstarted") || lower.includes("has not started")) {
    return "Voting has not opened yet. Wait until the election start time, then try again.";
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
  if (lower.includes("already in use") || lower.includes("already been processed")) {
    return "This account may already exist (duplicate title or already registered). Try a new title or skip that voter.";
  }
  if (
    lower.includes("blockhash not found") ||
    lower.includes("failed to simulate") ||
    lower.includes("simulation failed") ||
    lower.includes("proceeding is unsafe")
  ) {
    return "The transaction was not sent. Phantom could not simulate it — usually Phantom is not on Devnet, or the BOAT program is not deployed on this cluster. Switch Phantom to Devnet and check Explorer; if nothing new appears under your wallet, nothing landed.";
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
