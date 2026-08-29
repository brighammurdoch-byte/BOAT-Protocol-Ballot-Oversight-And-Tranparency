import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  CANDIDATE_SETUP_LEAD_SEC,
  DEFAULT_BOAT_PROGRAM_ID,
  computeElectionWindow,
  formatSimulationError,
  parseCandidateLabels,
  parseVoterKeys,
  pdaOutcome,
  remainingCandidateLabels,
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

  const later = computeElectionWindow({
    startInMin: 5,
    durationHours: 2,
    nowMs,
    candidateCount: 3,
  });
  assert.equal(later.start, nowSec + 5 * 60);

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

const tests = [
  testPdaIndexesAreDistinct,
  testElectionWindow,
  testParseVoters,
  testParseCandidates,
  testRemainingCandidatesStartAtOnChainCount,
  testSimulationErrorDoesNotBlameMissingProgram,
  testTallyIncludesZeroVoteCandidates,
];

let failed = 0;
for (const t of tests) {
  try {
    t();
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
