import {
  type Commitment,
  type Connection,
  type TransactionInstruction,
  PublicKey,
  Transaction,
  VersionedTransaction,
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

/**
 * Build a legacy Transaction the way Phantom / wallet-adapter expect:
 * feePayer + recentBlockhash as instance fields, not the
 * `{ blockhash, lastValidBlockHeight }` ctor (Object.assign can add
 * surprising own-properties that trip versioned-tx detection).
 */
export function buildLegacyTransaction(
  feePayer: PublicKey,
  ixs: TransactionInstruction[],
  blockhash: string,
  lastValidBlockHeight: number
): Transaction {
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.add(...ixs);
  return tx;
}

/**
 * web3.js Connection.simulateTransaction dispatches like this:
 *
 *   if ('message' in tx)        → VersionedTransaction.serialize()
 *   else if (tx instanceof Transaction) → legacy path
 *   else                        → Transaction.populate(tx as Message)
 *                                 which reads message.header.numRequiredSignatures
 *
 * A legacy Transaction from a *different* @solana/web3.js copy (Next.js +
 * wallet-adapter + file: SDK routinely ship two) fails `instanceof` and is
 * treated as a Message. Message.header is undefined → the Create Election
 * TypeError, with zero Phantom prompts.
 *
 * VersionedTransaction always has `.message`, so the first branch runs and
 * calls serialize() on *this* object (duck typing — no instanceof).
 */
export function asVersionedForSimulation(tx: Transaction): VersionedTransaction {
  if (!tx.feePayer) {
    throw new Error("Transaction feePayer is required before simulation.");
  }
  if (!tx.recentBlockhash) {
    throw new Error("Transaction recentBlockhash is required before simulation.");
  }
  return new VersionedTransaction(tx.compileMessage());
}

/**
 * Same dispatch Connection.simulateTransaction uses (1.98.x). Exposed so
 * tests can prove a foreign legacy tx throws numRequiredSignatures and a
 * VersionedTransaction does not.
 */
export function simulateDispatchKind(
  transactionOrMessage: object
): "versioned" | "legacy-instanceof" | "message-populate" {
  if ("message" in transactionOrMessage) {
    return "versioned";
  }
  if (transactionOrMessage instanceof Transaction) {
    return "legacy-instanceof";
  }
  return "message-populate";
}

export function assertMessageHeader(transactionOrMessage: object): number {
  if (simulateDispatchKind(transactionOrMessage) === "message-populate") {
    const header = (transactionOrMessage as { header?: { numRequiredSignatures?: number } })
      .header;
    if (header == null || typeof header.numRequiredSignatures !== "number") {
      throw new TypeError(
        "Cannot read properties of undefined (reading 'numRequiredSignatures')"
      );
    }
    return header.numRequiredSignatures;
  }
  if (simulateDispatchKind(transactionOrMessage) === "versioned") {
    const message = (transactionOrMessage as VersionedTransaction).message;
    return message.header.numRequiredSignatures;
  }
  return 1;
}

async function latestTx(
  connection: Connection,
  wallet: AnchorWalletLike,
  ixs: TransactionInstruction[],
  commitment: Commitment
): Promise<Transaction> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash(commitment);
  return buildLegacyTransaction(
    wallet.publicKey,
    ixs,
    blockhash,
    lastValidBlockHeight
  );
}

/** Simulate on our RPC before Phantom ever sees the tx. */
export async function simulateInstructions(
  connection: Connection,
  wallet: AnchorWalletLike,
  ixs: TransactionInstruction[],
  commitment: Commitment = "confirmed"
): Promise<Transaction> {
  const tx = await latestTx(connection, wallet, ixs, commitment);
  const sim = await connection.simulateTransaction(asVersionedForSimulation(tx), {
    commitment,
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
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
  if (!signed) {
    throw new Error("Wallet returned an empty signed transaction.");
  }
  const raw =
    typeof signed.serialize === "function"
      ? signed.serialize()
      : (() => {
          throw new Error("Wallet did not return a serializable transaction.");
        })();
  const sig = await connection.sendRawTransaction(raw, {
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
