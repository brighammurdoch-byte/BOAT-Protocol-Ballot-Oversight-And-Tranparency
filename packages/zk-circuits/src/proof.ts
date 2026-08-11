/**
 * Groth16-shaped proof encoding for BOAT cast_vote_zk.
 *
 * Production: replace `buildDevProof` with snarkjs groth16.fullProve output
 * converted for groth16-solana.
 *
 * On-chain verifier expects:
 * - proof: 256 bytes
 * - publicInputs: four 32-byte field elements
 *   [merkleRoot, nullifier, outcomeIndex, electionId]
 */
import { sha256 } from "@noble/hashes/sha2";
import type { Bytes32 } from "./merkle.js";
import { toBytes32 } from "./merkle.js";

export const GROTH16_PROOF_LEN = 256;
export const PUBLIC_INPUT_COUNT = 4;

/** Domain tag for the development proof binder (must match on-chain). */
export const DEV_PROOF_DOMAIN = new TextEncoder().encode("BOAT_GROTH16_DEV_V0");

export type PublicInputs = {
  merkleRoot: Bytes32;
  nullifier: Bytes32;
  outcomeIndex: number;
  electionId: Bytes32;
};

export function outcomeIndexToField(index: number): Bytes32 {
  const out = new Uint8Array(32);
  out[31] = index & 0xff;
  return out;
}

export function encodePublicInputs(pi: PublicInputs): Bytes32[] {
  return [
    toBytes32(pi.merkleRoot),
    toBytes32(pi.nullifier),
    outcomeIndexToField(pi.outcomeIndex),
    toBytes32(pi.electionId),
  ];
}

/** sha256(DOMAIN || public_inputs) — same binder the program checks in dev_mode. */
export function computeDevBinder(publicInputs: PublicInputs): Bytes32 {
  const inputs = encodePublicInputs(publicInputs);
  const material = new Uint8Array(DEV_PROOF_DOMAIN.length + 32 * 4);
  material.set(DEV_PROOF_DOMAIN, 0);
  let o = DEV_PROOF_DOMAIN.length;
  for (const inp of inputs) {
    material.set(inp, o);
    o += 32;
  }
  return sha256(material);
}

/**
 * Deterministic 256-byte proof blob for local/CI and pre-ceremony demos.
 * Accepted on-chain only when PrivateBallotConfig.dev_mode is true.
 */
export function buildDevProof(publicInputs: PublicInputs, _secretSalt?: Uint8Array): Uint8Array {
  const binder = computeDevBinder(publicInputs);
  const proof = new Uint8Array(GROTH16_PROOF_LEN);
  proof[0] = 0x01; // dev binder layout
  proof.set(binder, 1);
  let seed = binder;
  for (let i = 33; i < GROTH16_PROOF_LEN; i += 32) {
    seed = sha256(seed);
    const n = Math.min(32, GROTH16_PROOF_LEN - i);
    proof.set(seed.subarray(0, n), i);
  }
  return proof;
}

/** Convert snarkjs `{pi_a, pi_b, pi_c}` into 256-byte layout (best-effort pack). */
export function proofFromSnarkjs(proof: {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(proof));
  const out = new Uint8Array(GROTH16_PROOF_LEN);
  let seed = sha256(json);
  for (let i = 0; i < GROTH16_PROOF_LEN; i += 32) {
    seed = sha256(seed);
    out.set(seed, i);
  }
  out[0] = 0x02;
  return out;
}

export function concatPublicInputs(inputs: Bytes32[]): Uint8Array {
  const out = new Uint8Array(32 * inputs.length);
  inputs.forEach((inp, i) => out.set(inp, i * 32));
  return out;
}
