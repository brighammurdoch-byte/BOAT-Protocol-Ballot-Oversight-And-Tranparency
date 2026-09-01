import assert from "node:assert/strict";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  CANDIDATE_SETUP_LEAD_SEC,
  DEFAULT_BOAT_PROGRAM_ID,
  MAX_SIGN_ATTEMPTS,
  asVersionedForSimulation,
  assertMessageHeader,
  blockhashStillValid,
  buildLegacyTransaction,
  computeElectionWindow,
  confirmationSatisfied,
  extractRecentBlockhash,
  formatSimulationError,
  isAlreadyProcessedError,
  isExpiredBlockhashError,
  parseCandidateLabels,
  parseVoterKeys,
  pdaOutcome,
  remainingCandidateLabels,
  sendAndConfirmInstructions,
  sendRawUntilConfirmed,
  simulateDispatchKind,
  totalsWithAllCandidates,
} from "../packages/boat-sdk/src/index";

const election = Keypair.generate().publicKey;

function testPdaIndexesAreDistinct() {
  const keys = [0, 1, 2].map(
    (i) => pdaOutcome(election, i, DEFAULT_BOAT_PROGRAM_ID)[0].toBase58()
  );
  assert.equal(new Set(keys).size, 3, "outcome PDAs for 0/1/2 must differ");
  const [idx2] = pdaOutcome(election, 2, DEFAULT_BOAT_PROGRAM_ID);
  const [manual] = PublicKey.findProgramAddressSync(
    [Buffer.from("outcome"), election.toBuffer(), Buffer.from([2])],
    DEFAULT_BOAT_PROGRAM_ID
  );
  assert.equal(idx2.toBase58(), manual.toBase58());
}

function testElectionWindow() {
  const nowMs = 1_700_000_000_000;
  const nowSec = Math.floor(nowMs / 1000);

  const immediate = computeElectionWindow({
    startInMin: 0,
    durationHours: 2,
    nowMs,
    candidateCount: 3,
  });
  assert.equal(immediate.start, nowSec + CANDIDATE_SETUP_LEAD_SEC);
  assert.equal(immediate.end, immediate.start + 2 * 3600);

  const fiveMin = computeElectionWindow({
    startInMin: 5,
    durationHours: 2,
    nowMs,
    candidateCount: 3,
  });
  assert.equal(fiveMin.start, nowSec + CANDIDATE_SETUP_LEAD_SEC);

  const later = computeElectionWindow({
    startInMin: 15,
    durationHours: 2,
    nowMs,
    candidateCount: 3,
  });
  assert.equal(later.start, nowSec + 15 * 60);

  const noCandidates = computeElectionWindow({
    startInMin: 0,
    durationHours: 1,
    nowMs,
    candidateCount: 0,
  });
  assert.equal(noCandidates.start, nowSec);
}

function testParseVoters() {
  const a = "7Hjk9PfcwKurESHHn2SZaD3ByGKCUa9NF8nie3xF4hjt";
  const keys = parseVoterKeys(`${a}\n${a} , ${a}`);
  assert.equal(keys.length, 1);
  assert.equal(keys[0].toBase58(), a);
}

function testParseCandidates() {
  assert.deepEqual(parseCandidateLabels("Alice\nBob\nCarol\nBob\n"), [
    "Alice",
    "Bob",
    "Carol",
  ]);
}

function testRemainingCandidatesStartAtOnChainCount() {
  assert.deepEqual(remainingCandidateLabels(["Alice", "Bob", "Carol"], 0), [
    "Alice",
    "Bob",
    "Carol",
  ]);
  assert.deepEqual(remainingCandidateLabels(["Alice", "Bob", "Carol"], 2), [
    "Carol",
  ]);
  assert.deepEqual(remainingCandidateLabels(["Alice", "Bob", "Carol"], 3), []);
}

function testSimulationErrorDoesNotBlameMissingProgram() {
  const msg = formatSimulationError(
    { InstructionError: [0, "InvalidAccountData"] },
    ["Program log: Allocate: account already in use"]
  );
  assert.match(msg, /already exists/i);
  assert.doesNotMatch(msg, /not deployed/i);
}

function testTallyIncludesZeroVoteCandidates() {
  const rows = totalsWithAllCandidates({ Alice: 1n }, ["Alice", "Bob", "Carol"]);
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.weight]));
  assert.equal(byLabel.Alice, 1n);
  assert.equal(byLabel.Bob, 0n);
  assert.equal(byLabel.Carol, 0n);
}

function sampleLegacyTx(): Transaction {
  const payer = Keypair.generate();
  return buildLegacyTransaction(
    payer.publicKey,
    [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: payer.publicKey,
        lamports: 1,
      }),
    ],
    "11111111111111111111111111111111",
    1
  );
}

/**
 * Reproduce the live Create Election TypeError: Connection.simulateTransaction
 * treats a non-instanceof Transaction as a Message and reads
 * message.header.numRequiredSignatures.
 */
function testForeignLegacyTxHitsNumRequiredSignatures() {
  const tx = sampleLegacyTx();
  assert.equal(simulateDispatchKind(tx), "legacy-instanceof");
  assert.ok(!("message" in tx), "legacy tx must not look versioned");
  assert.ok(!("version" in tx), "legacy tx must not trip wallet-adapter version check");

  const foreign = {
    feePayer: tx.feePayer,
    instructions: tx.instructions,
    signatures: tx.signatures,
    recentBlockhash: tx.recentBlockhash,
    lastValidBlockHeight: tx.lastValidBlockHeight,
  };
  assert.equal(simulateDispatchKind(foreign), "message-populate");
  assert.throws(
    () => assertMessageHeader(foreign),
    (err: unknown) =>
      err instanceof TypeError &&
      /numRequiredSignatures/.test((err as Error).message)
  );
}

function testVersionedSimulationBypassesInstanceof() {
  const tx = sampleLegacyTx();
  const versioned = asVersionedForSimulation(tx);
  assert.equal(simulateDispatchKind(versioned), "versioned");
  assert.ok(versioned.message.header.numRequiredSignatures >= 1);
  assert.equal(
    assertMessageHeader(versioned),
    versioned.message.header.numRequiredSignatures
  );
  // serialize() is what Connection.simulateTransaction calls on this branch —
  // it must not throw the populate TypeError.
  const wire = versioned.serialize();
  assert.ok(wire.byteLength > 0);
}

function testSetupLeadOutlivesExpiredCandidatesTx() {
  // One Devnet blockhash is ~60–90s. Init + dropped candidates confirm wait
  // burns that window; 120s left Start-in-0 elections with 0 candidates.
  assert.ok(
    CANDIDATE_SETUP_LEAD_SEC >= 480,
    `CANDIDATE_SETUP_LEAD_SEC=${CANDIDATE_SETUP_LEAD_SEC} must survive init + expiry + retry`
  );
  const nowMs = 1_700_000_000_000;
  const nowSec = Math.floor(nowMs / 1000);
  const immediate = computeElectionWindow({
    startInMin: 0,
    durationHours: 2,
    nowMs,
    candidateCount: 3,
  });
  assert.equal(immediate.start, nowSec + CANDIDATE_SETUP_LEAD_SEC);
  assert.ok(immediate.start - nowSec >= 480);
}

function testBlockhashValidityAndExpiryDetection() {
  assert.equal(blockhashStillValid(100, 150), true);
  assert.equal(blockhashStillValid(150, 150), false);
  assert.equal(blockhashStillValid(151, 150), false);
  assert.equal(blockhashStillValid(129, 150, 20), true);
  assert.equal(blockhashStillValid(130, 150, 20), false);

  assert.equal(confirmationSatisfied("confirmed", "confirmed"), true);
  assert.equal(confirmationSatisfied("processed", "confirmed"), false);
  assert.equal(confirmationSatisfied("finalized", "confirmed"), true);
  assert.equal(confirmationSatisfied(undefined, "confirmed"), false);

  assert.ok(
    isExpiredBlockhashError(
      new Error(
        "Signature V2qSzrNUuJXBN8YqyvWUrqmsmC9ogQZwZFRbPnzoiyj7Xo5SDYqRVVsm6ZiEWdkSaJKBmzsU2BAD2ZqHypPW1bF has expired: block height exceeded."
      )
    )
  );
  assert.ok(isExpiredBlockhashError(new Error("blockhash not found")));
  assert.ok(!isExpiredBlockhashError(new Error("user rejected the request")));
  assert.ok(isAlreadyProcessedError(new Error("This transaction has already been processed")));
}

/** Dropped first send must be rebroadcast until confirmed — the live Devnet bug. */
async function testSendRawResendsUntilConfirmed() {
  let sends = 0;
  let polls = 0;
  const connection = {
    async sendRawTransaction() {
      sends += 1;
      return "5QKym4ZZaZf1x5QhoRuvB9LydWEQSTeHfqNNWJbWb7ULP2qeoPKJJxnW8JzAD1YPHnfBwDeWqR5cVgbTtD5QdaiC";
    },
    async getBlockHeight() {
      return 100;
    },
    async getSignatureStatus() {
      polls += 1;
      if (polls < 3) return { value: null };
      return { value: { err: null, confirmationStatus: "confirmed" } };
    },
  };
  const sig = await sendRawUntilConfirmed(
    connection as never,
    new Uint8Array([1, 2, 3]),
    "11111111111111111111111111111111",
    200,
    "confirmed"
  );
  assert.equal(
    sig,
    "5QKym4ZZaZf1x5QhoRuvB9LydWEQSTeHfqNNWJbWb7ULP2qeoPKJJxnW8JzAD1YPHnfBwDeWqR5cVgbTtD5QdaiC"
  );
  assert.ok(sends >= 3, `expected resends while unconfirmed, got ${sends}`);
}

async function testSendRawRetriesWhenFirstSendThrows() {
  let sends = 0;
  let polls = 0;
  const connection = {
    async sendRawTransaction() {
      sends += 1;
      if (sends === 1) throw new Error("429 Too Many Requests");
      return "5QKym4ZZaZf1x5QhoRuvB9LydWEQSTeHfqNNWJbWb7ULP2qeoPKJJxnW8JzAD1YPHnfBwDeWqR5cVgbTtD5QdaiC";
    },
    async getBlockHeight() {
      return 100;
    },
    async getSignatureStatus() {
      polls += 1;
      if (polls < 2) return { value: null };
      return { value: { err: null, confirmationStatus: "confirmed" } };
    },
  };
  const sig = await sendRawUntilConfirmed(
    connection as never,
    new Uint8Array([1]),
    "11111111111111111111111111111111",
    200,
    "confirmed"
  );
  assert.equal(
    sig,
    "5QKym4ZZaZf1x5QhoRuvB9LydWEQSTeHfqNNWJbWb7ULP2qeoPKJJxnW8JzAD1YPHnfBwDeWqR5cVgbTtD5QdaiC"
  );
  assert.ok(sends >= 2, `expected retry after first send throw, got ${sends}`);
}

async function testSendRawThrowsWhenBlockHeightExceeded() {
  const connection = {
    async sendRawTransaction() {
      return "V2qSzrNUuJXBN8YqyvWUrqmsmC9ogQZwZFRbPnzoiyj7Xo5SDYqRVVsm6ZiEWdkSaJKBmzsU2BAD2ZqHypPW1bF";
    },
    async getBlockHeight() {
      return 201;
    },
    async getSignatureStatus() {
      return { value: null };
    },
  };
  await assert.rejects(
    () =>
      sendRawUntilConfirmed(
        connection as never,
        new Uint8Array([1]),
        "11111111111111111111111111111111",
        200,
        "confirmed"
      ),
    (err: unknown) =>
      err instanceof Error && /block height exceeded/.test(err.message)
  );
}

function dummyIx() {
  const payer = Keypair.generate();
  return SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: payer.publicKey,
    lamports: 1,
  });
}

function mockWallet(onSign: (tx: Transaction) => void = () => undefined) {
  const keypair = Keypair.generate();
  return {
    publicKey: keypair.publicKey,
    signTransaction: async (tx: Transaction) => {
      onSign(tx);
      return {
        recentBlockhash: tx.recentBlockhash,
        lastValidBlockHeight: tx.lastValidBlockHeight,
        serialize: () => new Uint8Array([1, 2, 3]),
      };
    },
    signAllTransactions: async (txs: Transaction[]) => txs,
  };
}

const CONFIRMED_SIG =
  "5QKym4ZZaZf1x5QhoRuvB9LydWEQSTeHfqNNWJbWb7ULP2qeoPKJJxnW8JzAD1YPHnfBwDeWqR5cVgbTtD5QdaiC";

function testExtractRecentBlockhashReadsLegacyAndVersioned() {
  assert.equal(
    extractRecentBlockhash({ recentBlockhash: "legacyhash11111111111111111111111" }),
    "legacyhash11111111111111111111111"
  );
  assert.equal(
    extractRecentBlockhash({
      message: { recentBlockhash: "versionedhash111111111111111111111" },
    }),
    "versionedhash111111111111111111111"
  );
  assert.equal(extractRecentBlockhash({}), null);
}

function testSignAttemptsIsNotAConfirmStack() {
  assert.equal(MAX_SIGN_ATTEMPTS, 2);
}

/** Dropped first send must rebroadcast the same bytes — no second Phantom prompt. */
async function testDroppedSendDoesNotResign() {
  let signs = 0;
  let sends = 0;
  let polls = 0;
  const wallet = mockWallet(() => {
    signs += 1;
  });
  const connection = {
    async getLatestBlockhash() {
      return {
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight: 200,
      };
    },
    async getBlockHeight() {
      return 100;
    },
    async sendRawTransaction() {
      sends += 1;
      return CONFIRMED_SIG;
    },
    async getSignatureStatus() {
      polls += 1;
      if (polls < 3) return { value: null };
      return { value: { err: null, confirmationStatus: "confirmed" } };
    },
    async getMultipleAccountsInfo() {
      return [null];
    },
  };
  const sig = await sendAndConfirmInstructions(
    connection as never,
    wallet,
    [dummyIx()],
    { skipSimulate: true }
  );
  assert.equal(sig, CONFIRMED_SIG);
  assert.equal(signs, 1, `rebroadcast must not re-open Phantom, got ${signs} signs`);
  assert.ok(sends >= 3, `expected silent resends, got ${sends}`);
}

/**
 * Live hole: after Phantom returns with <20 slots left, PR #4 discarded the
 * signed bytes and opened another Confirm. Those bytes must still be sent.
 */
async function testNearExpiryAfterSignStillSends() {
  let signs = 0;
  let sends = 0;
  const wallet = mockWallet(() => {
    signs += 1;
  });
  const connection = {
    async getLatestBlockhash() {
      return {
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight: 200,
      };
    },
    async getBlockHeight() {
      // 10 slots left — below MIN_BLOCKHASH_SLOTS_REMAINING (20).
      return 190;
    },
    async sendRawTransaction() {
      sends += 1;
      return CONFIRMED_SIG;
    },
    async getSignatureStatus() {
      return { value: { err: null, confirmationStatus: "confirmed" } };
    },
    async getMultipleAccountsInfo() {
      return [null];
    },
  };
  const sig = await sendAndConfirmInstructions(
    connection as never,
    wallet,
    [dummyIx()],
    { skipSimulate: true }
  );
  assert.equal(sig, CONFIRMED_SIG);
  assert.equal(signs, 1);
  assert.ok(sends >= 1, "near-expiry signed bytes must be sent, not discarded");
}

/** Hash actually dead after send → one rebuild + one new prompt, not three. */
async function testResignOnceAfterHashDies() {
  let signs = 0;
  let hashFetch = 0;
  const wallet = mockWallet(() => {
    signs += 1;
  });
  const connection = {
    async getLatestBlockhash() {
      hashFetch += 1;
      return {
        blockhash: `hash${hashFetch}11111111111111111111111111`.slice(0, 32),
        lastValidBlockHeight: signs === 0 ? 200 : 400,
      };
    },
    async getBlockHeight() {
      return signs < 2 ? 201 : 100;
    },
    async sendRawTransaction() {
      return CONFIRMED_SIG;
    },
    async getSignatureStatus() {
      if (signs < 2) return { value: null };
      return { value: { err: null, confirmationStatus: "confirmed" } };
    },
    async getMultipleAccountsInfo() {
      return [null];
    },
  };
  const sig = await sendAndConfirmInstructions(
    connection as never,
    wallet,
    [dummyIx()],
    { skipSimulate: true }
  );
  assert.equal(sig, CONFIRMED_SIG);
  assert.equal(signs, 2, `expected one re-sign after expiry, got ${signs}`);
}

/** Signing blockhash must be the last RPC before Phantom — no getBlockHeight gap. */
async function testBlockhashIsLastRpcBeforeSign() {
  const events: string[] = [];
  const wallet = mockWallet(() => {
    events.push("sign");
  });
  const connection = {
    async getLatestBlockhash() {
      events.push("hash");
      return {
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight: 200,
      };
    },
    async getBlockHeight() {
      events.push("height");
      return 100;
    },
    async sendRawTransaction() {
      events.push("send");
      return CONFIRMED_SIG;
    },
    async getSignatureStatus() {
      return { value: { err: null, confirmationStatus: "confirmed" } };
    },
    async getMultipleAccountsInfo() {
      return [null];
    },
  };
  await sendAndConfirmInstructions(connection as never, wallet, [dummyIx()], {
    skipSimulate: true,
  });
  const signAt = events.indexOf("sign");
  assert.ok(signAt > 0, "wallet must be asked to sign");
  assert.equal(events[signAt - 1], "hash");
  assert.equal(events.slice(0, signAt).includes("height"), false);
}

/** Wallet refreshed the message hash — do not expire using our stale lastValid. */
async function testWalletReplacedBlockhashDoesNotUseStaleLastValid() {
  let signs = 0;
  let latestCalls = 0;
  const keypair = Keypair.generate();
  const wallet = {
    publicKey: keypair.publicKey,
    signTransaction: async () => {
      signs += 1;
      return {
        recentBlockhash: "PhantomReplacedHash1111111111111",
        lastValidBlockHeight: 200,
        serialize: () => new Uint8Array([9]),
      };
    },
    signAllTransactions: async (txs: Transaction[]) => txs,
  };
  const connection = {
    async getLatestBlockhash() {
      latestCalls += 1;
      if (latestCalls === 1) {
        return {
          blockhash: "OriginalHash11111111111111111111",
          lastValidBlockHeight: 200,
        };
      }
      return {
        blockhash: "PostSignLatest111111111111111111",
        lastValidBlockHeight: 350,
      };
    },
    async getBlockHeight() {
      return 201;
    },
    async sendRawTransaction() {
      return CONFIRMED_SIG;
    },
    async getSignatureStatus() {
      return { value: { err: null, confirmationStatus: "confirmed" } };
    },
    async getMultipleAccountsInfo() {
      return [null];
    },
  };
  const sig = await sendAndConfirmInstructions(
    connection as never,
    wallet,
    [dummyIx()],
    { skipSimulate: true }
  );
  assert.equal(sig, CONFIRMED_SIG);
  assert.equal(signs, 1);
  assert.ok(latestCalls >= 2, "must refresh lastValid after Phantom replaces the hash");
}

/** Hit the real web3.js method — populate throws before any RPC. */
async function testRealSimulateTransactionThrowsOnForeignLegacyTx() {
  const connection = new Connection("http://127.0.0.1:9");
  const tx = sampleLegacyTx();
  const foreign = {
    feePayer: tx.feePayer,
    instructions: tx.instructions,
    signatures: tx.signatures,
    recentBlockhash: tx.recentBlockhash,
    lastValidBlockHeight: tx.lastValidBlockHeight,
  };
  await assert.rejects(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => connection.simulateTransaction(foreign as any),
    (err: unknown) =>
      err instanceof TypeError &&
      /numRequiredSignatures/.test((err as Error).message)
  );
}

const tests = [
  testPdaIndexesAreDistinct,
  testElectionWindow,
  testParseVoters,
  testParseCandidates,
  testRemainingCandidatesStartAtOnChainCount,
  testSimulationErrorDoesNotBlameMissingProgram,
  testTallyIncludesZeroVoteCandidates,
  testForeignLegacyTxHitsNumRequiredSignatures,
  testVersionedSimulationBypassesInstanceof,
  testRealSimulateTransactionThrowsOnForeignLegacyTx,
  testSetupLeadOutlivesExpiredCandidatesTx,
  testBlockhashValidityAndExpiryDetection,
  testSendRawResendsUntilConfirmed,
  testSendRawRetriesWhenFirstSendThrows,
  testSendRawThrowsWhenBlockHeightExceeded,
  testExtractRecentBlockhashReadsLegacyAndVersioned,
  testSignAttemptsIsNotAConfirmStack,
  testDroppedSendDoesNotResign,
  testNearExpiryAfterSignStillSends,
  testResignOnceAfterHashDies,
  testBlockhashIsLastRpcBeforeSign,
  testWalletReplacedBlockhashDoesNotUseStaleLastValid,
];

async function main() {
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      console.log(`ok  ${t.name}`);
    } catch (e) {
      failed += 1;
      console.error(`not ok  ${t.name}`);
      console.error(e);
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log(`${tests.length} passed`);
}

void main();
