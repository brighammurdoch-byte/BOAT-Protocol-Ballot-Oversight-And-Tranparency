import {
  type Commitment,
  type Connection,
  type TransactionInstruction,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { AnchorWalletLike } from "./wallet";

/** Slots that must remain on a *fresh* RPC hash before we hand it to Phantom. */
export const MIN_BLOCKHASH_SLOTS_REMAINING = 20;

/** How often to rebroadcast the same signed bytes while the hash is still valid. */
export const TX_RESEND_INTERVAL_MS = 400;

/**
 * One signing prompt, plus one rebuild if that hash is actually dead.
 * Do not stack three identical Phantom Confirms on a single Create click.
 */
export const MAX_SIGN_ATTEMPTS = 2;

/**
 * After a confirm miss, wait this long for the PDA to appear before
 * re-signing or telling the user the first tx died.
 */
export const EXPIRED_LANDING_GRACE_MS = 10_000;

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

export async function waitForAccountSettled(
  connection: Connection,
  pubkey: PublicKey,
  timeoutMs = 25_000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await connection.getAccountInfo(pubkey, "confirmed");
    if (info) return true;
    await sleep(400);
  }
  return false;
}

export async function waitForAccount(
  connection: Connection,
  pubkey: PublicKey,
  timeoutMs = 25_000
): Promise<void> {
  if (await waitForAccountSettled(connection, pubkey, timeoutMs)) return;
  throw new Error(
    `Timed out waiting for ${pubkey.toBase58()} to confirm on Devnet.`
  );
}

export async function waitForAccountsSettled(
  connection: Connection,
  pubkeys: PublicKey[],
  timeoutMs: number,
  commitment: Commitment = "confirmed"
): Promise<boolean> {
  if (pubkeys.length === 0) return false;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await accountsExist(connection, pubkeys, commitment)) return true;
    await sleep(400);
  }
  return false;
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

/** Legacy `recentBlockhash` or VersionedTransaction `message.recentBlockhash`. */
export function extractRecentBlockhash(signed: unknown): string | null {
  if (!signed || typeof signed !== "object") return null;
  const s = signed as {
    recentBlockhash?: unknown;
    message?: { recentBlockhash?: unknown };
  };
  if (typeof s.recentBlockhash === "string" && s.recentBlockhash.length > 0) {
    return s.recentBlockhash;
  }
  if (
    typeof s.message?.recentBlockhash === "string" &&
    s.message.recentBlockhash.length > 0
  ) {
    return s.message.recentBlockhash;
  }
  return null;
}

/** Decode the hash we are actually rebroadcasting (Phantom may have replaced it). */
export function blockhashFromSignedBytes(raw: Uint8Array): string | null {
  const bytes =
    typeof Buffer !== "undefined" && typeof Buffer.from === "function"
      ? Buffer.from(raw)
      : raw;
  try {
    const tx = Transaction.from(bytes);
    if (tx.recentBlockhash) return tx.recentBlockhash;
  } catch {
    // not a legacy transaction
  }
  try {
    const vtx = VersionedTransaction.deserialize(raw);
    if (vtx.message.recentBlockhash) return vtx.message.recentBlockhash;
  } catch {
    // not a versioned transaction
  }
  return null;
}

type BlockhashValidConn = Connection & {
  isBlockhashValid?: (
    blockhash: string,
    config?: { commitment?: Commitment }
  ) => Promise<boolean | { value: boolean }>;
};

/**
 * Prefer `isBlockhashValid` on the signed hash. lastValidBlockHeight belongs
 * to whichever hash we fetched — Phantom may have replaced it.
 */
export async function signedBlockhashStillValid(
  connection: Connection,
  blockhash: string,
  lastValidBlockHeight: number,
  commitment: Commitment = "confirmed"
): Promise<boolean> {
  const conn = connection as BlockhashValidConn;
  if (typeof conn.isBlockhashValid === "function") {
    try {
      const res = await conn.isBlockhashValid(blockhash, { commitment });
      if (typeof res === "boolean") return res;
      if (res && typeof res.value === "boolean") return res.value;
    } catch {
      // fall through to lastValid
    }
  }
  const height = await connection.getBlockHeight(commitment);
  return blockhashStillValid(height, lastValidBlockHeight);
}

function expiryError(signature: string | null): Error {
  return new Error(
    signature
      ? `Signature ${signature} has expired: block height exceeded.`
      : "Transaction blockhash expired: block height exceeded."
  );
}

/**
 * Rebroadcast the same signed bytes until confirmed or the hash expires.
 * Never opens the wallet. Devnet routinely drops the first send, and a
 * `blockhash not found` from one RPC node is not proof the hash is dead.
 */
export async function sendRawUntilConfirmed(
  connection: Connection,
  raw: Uint8Array,
  blockhash: string,
  lastValidBlockHeight: number,
  commitment: Commitment = "confirmed"
): Promise<string> {
  let signature: string | null = null;
  const wireHash = blockhashFromSignedBytes(raw) ?? blockhash;

  const sendOnce = async (): Promise<void> => {
    try {
      const sig = await connection.sendRawTransaction(raw, {
        skipPreflight: true,
        maxRetries: 0,
      });
      signature = sig;
    } catch (e) {
      if (isAlreadyProcessedError(e) && signature) return;
      // Expiry-shaped send errors are unverified — another node may
      // still hold a live hash or the first send may already have landed.
    }
  };

  const statusOf = async (sig: string) =>
    connection.getSignatureStatus(sig, { searchTransactionHistory: true });

  await sendOnce();

  while (true) {
    if (signature) {
      const status = await statusOf(signature);
      if (status.value?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
      }
      if (confirmationSatisfied(status.value?.confirmationStatus, commitment)) {
        return signature;
      }
    }

    const hashAlive = await signedBlockhashStillValid(
      connection,
      wireHash,
      lastValidBlockHeight,
      commitment
    );
    if (!hashAlive) {
      if (signature) {
        const status = await statusOf(signature);
        if (status.value?.err) {
          throw new Error(
            `Transaction failed: ${JSON.stringify(status.value.err)}`
          );
        }
        if (confirmationSatisfied(status.value?.confirmationStatus, commitment)) {
          return signature;
        }
      }
      throw expiryError(signature);
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
 *   1. fetch a fresh blockhash immediately before Phantom (no extra RPC in between)
 *   2. send the signed bytes even if few slots remain — do not discard them
 *   3. rebroadcast those same bytes until confirmed, or the hash is actually dead
 *   4. only then fetch a new hash and re-sign (one extra prompt, not a stack)
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

    // Last RPC before the wallet prompt — do not getBlockHeight here.
    const tx = await latestTx(connection, wallet, ixs, commitment);
    const blockhash = tx.recentBlockhash!;
    const lastValidBlockHeight = tx.lastValidBlockHeight!;

    const signed = await wallet.signTransaction(tx);
    if (!signed) {
      throw new Error("Wallet returned an empty signed transaction.");
    }

    const raw = serializeSigned(signed);
    const usedBlockhash =
      blockhashFromSignedBytes(raw) ?? extractRecentBlockhash(signed) ?? blockhash;
    let usedLastValid = lastValidBlockHeight;
    if (usedBlockhash !== blockhash) {
      // Phantom / wallet-standard may refresh the message hash on approve.
      // lastValidBlockHeight is not on the wire — do not keep our stale value.
      const latest = await connection.getLatestBlockhash(commitment);
      usedLastValid = latest.lastValidBlockHeight;
    }

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
      if (waitFor.length > 0) {
        const landed =
          (await accountsExist(connection, waitFor, commitment)) ||
          (await waitForAccountsSettled(
            connection,
            waitFor,
            EXPIRED_LANDING_GRACE_MS,
            commitment
          ));
        if (landed) {
          return errorMessage(e).match(/[1-9A-HJ-NP-Za-km-z]{64,}/)?.[0] ?? "";
        }
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
