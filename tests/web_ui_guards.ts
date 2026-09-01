import assert from "node:assert/strict";
import {
  canSendVoteTx,
  friendlyError,
  isAbortError,
} from "../app/boat-frontend/src/lib/demo";

function testAbortIsVisibleError() {
  const aborted = Object.assign(new Error(""), { name: "AbortError" });
  assert.equal(isAbortError(aborted), true);
  assert.equal(isAbortError(new Error("The user aborted a request.")), true);
  assert.equal(isAbortError(new Error("signal is aborted without reason")), true);
  const msg = friendlyError(aborted);
  assert.ok(msg.length > 0, "abort must not produce an empty banner");
  assert.match(msg, /interrupted/i);
}

function testEmptyErrorIsVisible() {
  const msg = friendlyError(new Error(""));
  assert.ok(msg.length > 0);
  assert.doesNotMatch(msg, /^\s*$/);
}

function testAliceRadioDoesNotSend() {
  // Alice is outcome index 0 — a truthy check would wrongly treat this as "no selection".
  assert.equal(canSendVoteTx(false, 0), false);
  assert.equal(canSendVoteTx(false, 1), false);
  assert.equal(canSendVoteTx(false, 2), false);
  assert.equal(canSendVoteTx(false, null), false);
}

function testCastButtonSendsSelectedIncludingAlice() {
  assert.equal(canSendVoteTx(true, 0), true, "Alice (index 0) must still be castable");
  assert.equal(canSendVoteTx(true, 2), true, "change-vote to Carol must still send");
  assert.equal(canSendVoteTx(true, null), false);
}

const tests = [
  testAbortIsVisibleError,
  testEmptyErrorIsVisible,
  testAliceRadioDoesNotSend,
  testCastButtonSendsSelectedIncludingAlice,
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
  if (failed) process.exit(1);
  console.log(`${tests.length} passed`);
}

void main();
