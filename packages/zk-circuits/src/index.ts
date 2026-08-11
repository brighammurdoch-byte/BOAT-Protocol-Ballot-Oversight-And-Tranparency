import {
  EligibilityMerkleTree,
  electionIdFromPubkey,
  leafFromSecret,
  nullifierFrom,
  bytes32ToHex,
  MERKLE_DEPTH,
} from "./merkle.js";
import {
  buildDevProof,
  encodePublicInputs,
  GROTH16_PROOF_LEN,
  type PublicInputs,
} from "./proof.js";

export * from "./merkle.js";
export * from "./proof.js";

export type PrivateBallotWitness = {
  secret: string | Uint8Array;
  electionPubkey: Uint8Array;
  outcomeIndex: number;
  /** Other eligible voter secrets (including this voter) to build the tree. */
  electorateSecrets: (string | Uint8Array)[];
  leafIndex: number;
};

export type PrivateBallotPackage = {
  merkleRoot: Uint8Array;
  nullifier: Uint8Array;
  electionId: Uint8Array;
  outcomeIndex: number;
  publicInputs: Uint8Array[];
  proof: Uint8Array;
  merkleDepth: number;
};

/** Build a private-ballot package (dev Groth16-shaped proof) for SDK / scripts. */
export function buildPrivateBallot(w: PrivateBallotWitness): PrivateBallotPackage {
  const leaves = w.electorateSecrets.map((s) => leafFromSecret(s));
  const tree = new EligibilityMerkleTree(leaves, MERKLE_DEPTH);
  const electionId = electionIdFromPubkey(w.electionPubkey);
  const nullifier = nullifierFrom(w.secret, electionId);
  const pi: PublicInputs = {
    merkleRoot: tree.root,
    nullifier,
    outcomeIndex: w.outcomeIndex,
    electionId,
  };
  const proof = buildDevProof(pi, leafFromSecret(w.secret));
  return {
    merkleRoot: tree.root,
    nullifier,
    electionId,
    outcomeIndex: w.outcomeIndex,
    publicInputs: encodePublicInputs(pi),
    proof,
    merkleDepth: MERKLE_DEPTH,
  };
}

export function summarizePackage(pkg: PrivateBallotPackage): string {
  return [
    `root=${bytes32ToHex(pkg.merkleRoot)}`,
    `nullifier=${bytes32ToHex(pkg.nullifier)}`,
    `outcome=${pkg.outcomeIndex}`,
    `proofLen=${pkg.proof.length}/${GROTH16_PROOF_LEN}`,
  ].join(" ");
}
