import {
  type Commitment,
  type Connection,
  type TransactionInstruction,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import type { AnchorWalletLike } from "./wallet";

/** Legacy tx hard cap is 1232 bytes; leave headroom for the fee signature. */
export const MAX_SAFE_TX_BYTES = 1200;

export async function waitForAccount(
  connection: Connection,
  pubkey: PublicKey,
  timeoutMs = 25_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await connection.getAccountInfo(pubkey, "confirmed");
    if (info) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `Timed out waiting for ${pubkey.toBase58()} to confirm on Devnet.`
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Sign once, send once, confirm at `confirmed`.
 * Sequential dependent txs must use this (or a single multi-ix tx) so Phantom
 * does not simulate the next ix against stale `outcome_count`.
 */
export async function sendAndConfirmInstructions(
  connection: Connection,
  wallet: AnchorWalletLike,
  ixs: TransactionInstruction[],
  opts?: { commitment?: Commitment }
): Promise<string> {
  if (ixs.length === 0) {
    throw new Error("No instructions to send.");
  }
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error("Connect a wallet first.");
  }
  const commitment = opts?.commitment ?? "confirmed";
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash(commitment);
  const tx = new Transaction({
    feePayer: wallet.publicKey,
    blockhash,
    lastValidBlockHeight,
  });
  tx.add(...ixs);
  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: commitment,
    maxRetries: 5,
  });
  const conf = await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    commitment
  );
  if (conf.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(conf.value.err)}`);
  }
  return sig;
}

export function unsignedTxSize(tx: Transaction): number {
  return tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).length;
}
