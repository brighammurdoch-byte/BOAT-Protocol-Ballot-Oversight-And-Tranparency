import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EligibilityMerkleTree,
  buildPrivateBallot,
  leafFromSecret,
  nullifierFrom,
  electionIdFromPubkey,
  buildDevProof,
  encodePublicInputs,
  GROTH16_PROOF_LEN,
} from "./index.js";

describe("eligibility merkle", () => {
  it("builds a stable root and proof path", () => {
    const leaves = ["alice", "bob", "carol"].map((s) => leafFromSecret(s));
    const tree = new EligibilityMerkleTree(leaves);
    const proof = tree.proof(1);
    assert.equal(proof.pathElements.length, 8);
    assert.equal(proof.root.length, 32);
    assert.deepEqual(proof.leaf, leaves[1]);
  });
});

describe("private ballot package", () => {
  it("produces 256-byte proof and 4 public inputs", () => {
    const election = new Uint8Array(32);
    election[31] = 7;
    const pkg = buildPrivateBallot({
      secret: "voter-sk-1",
      electionPubkey: election,
      outcomeIndex: 2,
      electorateSecrets: ["voter-sk-1", "voter-sk-2", "voter-sk-3"],
      leafIndex: 0,
    });
    assert.equal(pkg.proof.length, GROTH16_PROOF_LEN);
    assert.equal(pkg.publicInputs.length, 4);
    assert.equal(pkg.outcomeIndex, 2);
    const eid = electionIdFromPubkey(election);
    assert.deepEqual(pkg.nullifier, nullifierFrom("voter-sk-1", eid));
  });

  it("dev proof is deterministic for same inputs", () => {
    const pi = {
      merkleRoot: new Uint8Array(32).fill(1),
      nullifier: new Uint8Array(32).fill(2),
      outcomeIndex: 0,
      electionId: new Uint8Array(32).fill(3),
    };
    const a = buildDevProof(pi, new Uint8Array(32).fill(9));
    const b = buildDevProof(pi, new Uint8Array(32).fill(9));
    assert.deepEqual(a, b);
    assert.deepEqual(encodePublicInputs(pi).length, 4);
  });
});
