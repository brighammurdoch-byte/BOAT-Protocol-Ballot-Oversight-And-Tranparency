import {
  type Commitment,
  type Connection,
  type TransactionInstruction,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { AnchorWalletLike } from "./wallet";

/** Slots that must remain after Phantom returns or we rebuild with a fresh hash. */
export const MIN_BLOCKHASH_SLOTS_REMAINING = 20;

/** How often to rebroadcast the same signed bytes while the hash is still valid. */
export const TX_RESEND_INTERVAL_MS = 1_500;

/** Fresh blockhash + Phantom approve attempts for one instruction set. */
export const MAX_SIGN_ATTEMPTS = 3;

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

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isExpiredBlockhashError(err: unknown): boolean {
  const lower = errorMessage(err).toLowerCase();
  return (
    lower.includes("block height exceeded") ||
    lower.includes("blockhash not found") ||
    lower.includes("blockhash expired") ||
    (lower.includes("expired") && lower.includes("block"))
  );
}

export function isAlreadyProcessedError(err: unknown): boolean {
  const lower = errorMessage(err).toLowerCase();
  return (
    lower.includes("already been processed") ||
    lower.includes("already processed")
  );
}

/** `currentHeight + minSlotsRemaining < lastValidBlockHeight` — Solana's confirm predicate. */
export function blockhashStillValid(
  currentHeight: number,
  lastValidBlockHeight: number,
  minSlotsRemaining = 0
): boolean {
  return currentHeight + minSlotsRemaining < lastValidBlockHeight;
}

export function confirmationSatisfied(
  confirmationStatus: string | null | undefined,
  commitment: Commitment
): boolean {
  if (!confirmationStatus) return false;
  if (confirmationStatus === "finalized") return true;
  if (confirmationStatus === "confirmed") return commitment !== "finalized";
  if (confirmationStatus === "processed") return commitment === "processed";
  return false;
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

export async function accountsExist(
  connection: Connection,
  pubkeys: PublicKey[],
  commitment: Commitment = "confirmed"
): Promise<boolean> {
  if (pubkeys.length === 0) return false;
  const infos = await connection.getMultipleAccountsInfo(pubkeys, commitment);
  return infos.every((info) => info != null);
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

function serializeSigned(signed: { serialize?: (opts?: unknown) => Uint8Array | Buffer }): Uint8Array {
  if (typeof signed.serialize !== "function") {
    throw new Error("Wallet did not return a serializable transaction.");
  }
  const raw = signed.serialize();
  return raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
}

/**
 * Rebroadcast the same signed bytes until confirmed or the hash expires.
 * `confirmTransaction` only polls — Devnet routinely drops the first send.
 */
export async function sendRawUntilConfirmed(
  connection: Connection,
  raw: Uint8Array,
  _blockhash: string,
  lastValidBlockHeight: number,
  commitment: Commitment = "confirmed"
): Promise<string> {
  let signature: string | null = null;

  const sendOnce = async (): Promise<string> => {
    try {
      const sig = await connection.sendRawTransaction(raw, {
        skipPreflight: true,
        maxRetries: 0,
      });
      signature = sig;
      return sig;
    } catch (e) {
      if (isAlreadyProcessedError(e) && signature) return signature;
      if (isExpiredBlockhashError(e)) {
        throw new Error(
          signature
            ? `Signature ${signature} has expired: block height exceeded.`
            : "Transaction blockhash expired: block height exceeded."
        );
      }
      if (signature) return signature;
      throw e;
    }
  };

  signature = await sendOnce();

  while (true) {
    const height = await connection.getBlockHeight(commitment);
    if (!blockhashStillValid(height, lastValidBlockHeight)) {
      throw new Error(
        `Signature ${signature} has expired: block height exceeded.`
      );
    }

    const status = await connection.getSignatureStatus(signature);
    if (status.value?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
    }
    if (confirmationSatisfied(status.value?.confirmationStatus, commitment)) {
      return signature;
    }

    await sendOnce();
    await sleep(TX_RESEND_INTERVAL_MS);
  }
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
      await sleep(400);
      return;
    } catch (e) {
      lastErr = e;
      await sleep(400);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Timed out waiting for Devnet to accept the next transaction.");
}

/**
 * Simulate on our RPC (optional), then:
 *   1. fetch a fresh blockhash immediately before Phantom
 *   2. drop the signed bytes if the hash is already dead after approve
 *   3. rebroadcast until confirmed, or rebuild + re-sign if it expires
 *
 * Callers must not queue a dependent tx until this resolves.
 */
export async function sendAndConfirmInstructions(
  connection: Connection,
  wallet: AnchorWalletLike,
  ixs: TransactionInstruction[],
  opts?: {
    commitment?: Commitment;
    waitFor?: PublicKey[];
    skipSimulate?: boolean;
  }
): Promise<string> {
  if (ixs.length === 0) {
    throw new Error("No instructions to send.");
  }
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error("Connect a wallet first.");
  }
  const commitment = opts?.commitment ?? "confirmed";
  const waitFor = opts?.waitFor ?? [];

  if (!opts?.skipSimulate) {
    await simulateInstructions(connection, wallet, ixs, commitment);
  }

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_SIGN_ATTEMPTS; attempt++) {
    if (waitFor.length > 0 && (await accountsExist(connection, waitFor, commitment))) {
      return "";
    }

    const tx = await latestTx(connection, wallet, ixs, commitment);
    const blockhash = tx.recentBlockhash!;
    const lastValidBlockHeight = tx.lastValidBlockHeight!;

    const heightBefore = await connection.getBlockHeight(commitment);
    if (
      !blockhashStillValid(
        heightBefore,
        lastValidBlockHeight,
        MIN_BLOCKHASH_SLOTS_REMAINING
      )
    ) {
      lastErr = new Error("Latest blockhash was already near expiry; fetching another.");
      continue;
    }

    const signed = await wallet.signTransaction(tx);
    if (!signed) {
      throw new Error("Wallet returned an empty signed transaction.");
    }

    const usedBlockhash =
      typeof signed.recentBlockhash === "string" && signed.recentBlockhash
        ? signed.recentBlockhash
        : blockhash;
    const usedLastValid =
      typeof signed.lastValidBlockHeight === "number"
        ? signed.lastValidBlockHeight
        : lastValidBlockHeight;

    const heightAfter = await connection.getBlockHeight(commitment);
    if (
      !blockhashStillValid(
        heightAfter,
        usedLastValid,
        MIN_BLOCKHASH_SLOTS_REMAINING
      )
    ) {
      lastErr = new Error(
        "Transaction blockhash expired while waiting for wallet approval: block height exceeded."
      );
      continue;
    }

    const raw = serializeSigned(signed);
    try {
      const sig = await sendRawUntilConfirmed(
        connection,
        raw,
        usedBlockhash,
        usedLastValid,
        commitment
      );
      for (const pk of waitFor) {
        await waitForAccount(connection, pk);
      }
      return sig;
    } catch (e) {
      lastErr = e;
      if (waitFor.length > 0 && (await accountsExist(connection, waitFor, commitment))) {
        return errorMessage(e).match(/[1-9A-HJ-NP-Za-km-z]{64,}/)?.[0] ?? "";
      }
      if (!isExpiredBlockhashError(e) || attempt === MAX_SIGN_ATTEMPTS) {
        throw e instanceof Error ? e : new Error(errorMessage(e));
      }
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("Transaction blockhash expired: block height exceeded.");
}
