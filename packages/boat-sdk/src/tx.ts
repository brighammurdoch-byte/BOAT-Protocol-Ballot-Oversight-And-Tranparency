import {
  type Commitment,
  type Connection,
  type TransactionInstruction,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import type { AnchorWalletLike } from "./wallet";

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function formatSimulationError(
  err: unknown,
  logs?: (string | undefined)[] | null
): string {
  const logText = (logs ?? []).filter(Boolean).join("\n");
  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object"
        ? JSON.stringify(err)
        : String(err);
  const blob = `${raw}\n${logText}`.toLowerCase();
  if (blob.includes("already in use") || blob.includes("already been processed")) {
    return "Account already exists on Devnet (duplicate election title or voter already registered).";
  }
  if (blob.includes("electionalreadystarted") || blob.includes("already started")) {
    return "Voting already started, so new candidates cannot be added.";
  }
  if (blob.includes("invalidoutcomeindex") || blob.includes("invalid outcome index")) {
    return "Candidate index does not match on-chain outcome_count. Wait for the previous transaction to confirm, then retry.";
  }
  if (logText) {
    const last = [...(logs ?? [])].reverse().find((l) => l && l.trim());
    return `Transaction simulation failed: ${last}`;
  }
  return `Transaction simulation failed: ${raw}`;
}

export async function waitForAccount(
  connection: Connection,
  pubkey: PublicKey,
  timeoutMs = 25_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await connection.getAccountInfo(pubkey, "confirmed");
    if (info) return;
    await sleep(400);
  }
  throw new Error(
    `Timed out waiting for ${pubkey.toBase58()} to confirm on Devnet.`
  );
}

async function latestTx(
  connection: Connection,
  wallet: AnchorWalletLike,
  ixs: TransactionInstruction[],
  commitment: Commitment
): Promise<Transaction> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash(commitment);
  const tx = new Transaction({
    feePayer: wallet.publicKey,
    blockhash,
    lastValidBlockHeight,
  });
  tx.add(...ixs);
  return tx;
}

/** Simulate on our RPC before Phantom ever sees the tx. */
export async function simulateInstructions(
  connection: Connection,
  wallet: AnchorWalletLike,
  ixs: TransactionInstruction[],
  commitment: Commitment = "confirmed"
): Promise<Transaction> {
  const tx = await latestTx(connection, wallet, ixs, commitment);
  const sim = await connection.simulateTransaction(tx);
  if (sim.value.err) {
    throw new Error(formatSimulationError(sim.value.err, sim.value.logs));
  }
  return tx;
}

/**
 * Wait until our Devnet RPC can simulate `ixs` (prior create must be visible).
 * Never opens the wallet during this poll.
 */
export async function waitUntilSimulates(
  connection: Connection,
  wallet: AnchorWalletLike,
  ixs: TransactionInstruction[],
  timeoutMs = 25_000
): Promise<void> {
  const start = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      await simulateInstructions(connection, wallet, ixs);
      await sleep(600);
      return;
    } catch (e) {
      lastErr = e;
      await sleep(500);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Timed out waiting for Devnet to accept the next transaction.");
}

/**
 * Simulate on our RPC, then sign once, send once, confirm at `confirmed`.
 * Callers must not queue a dependent tx until this resolves.
 */
export async function sendAndConfirmInstructions(
  connection: Connection,
  wallet: AnchorWalletLike,
  ixs: TransactionInstruction[],
  opts?: { commitment?: Commitment; waitFor?: PublicKey[] }
): Promise<string> {
  if (ixs.length === 0) {
    throw new Error("No instructions to send.");
  }
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error("Connect a wallet first.");
  }
  const commitment = opts?.commitment ?? "confirmed";
  await simulateInstructions(connection, wallet, ixs, commitment);
  const tx = await latestTx(connection, wallet, ixs, commitment);
  const blockhash = tx.recentBlockhash!;
  const lastValidBlockHeight = tx.lastValidBlockHeight!;
  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
    maxRetries: 5,
  });
  const conf = await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    commitment
  );
  if (conf.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(conf.value.err)}`);
  }
  for (const pk of opts?.waitFor ?? []) {
    await waitForAccount(connection, pk);
  }
  return sig;
}
