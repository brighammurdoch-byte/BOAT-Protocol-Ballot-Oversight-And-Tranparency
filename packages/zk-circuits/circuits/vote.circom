pragma circom 2.1.6;

// BOAT private ballot v0 — eligibility Merkle + nullifier + outcome bound.
// Prove offline (snarkjs); verify on Solana via alt_bn128 / groth16-solana.

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/switcher.circom";

template MerkleHasher() {
    signal input left;
    signal input right;
    signal output hash;
    component h = Poseidon(2);
    h.inputs[0] <== left;
    h.inputs[1] <== right;
    hash <== h.out;
}

template MerkleMembership(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    component hashers[depth];
    component switchers[depth];
    signal level[depth + 1];
    level[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        switchers[i] = Switcher();
        switchers[i].sel <== pathIndices[i];
        switchers[i].L <== level[i];
        switchers[i].R <== pathElements[i];
        hashers[i] = MerkleHasher();
        hashers[i].left <== switchers[i].outL;
        hashers[i].right <== switchers[i].outR;
        level[i + 1] <== hashers[i].hash;
    }
    root <== level[depth];
}

/// depth 8 => up to 256 eligible voters (campus trial size).
template PrivateBallot(depth, maxOutcomes) {
    // Public
    signal input merkleRoot;
    signal input nullifier;
    signal input outcomeIndex;
    signal input electionId;

    // Private
    signal input sk;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    component leafHash = Poseidon(1);
    leafHash.inputs[0] <== sk;

    component merkle = MerkleMembership(depth);
    merkle.leaf <== leafHash.out;
    for (var i = 0; i < depth; i++) {
        merkle.pathElements[i] <== pathElements[i];
        merkle.pathIndices[i] <== pathIndices[i];
    }
    merkle.root === merkleRoot;

    component nf = Poseidon(2);
    nf.inputs[0] <== sk;
    nf.inputs[1] <== electionId;
    nf.out === nullifier;

    component lt = LessThan(8);
    lt.in[0] <== outcomeIndex;
    lt.in[1] <== maxOutcomes;
    lt.out === 1;
}

component main {public [merkleRoot, nullifier, outcomeIndex, electionId]} =
    PrivateBallot(8, 16);
