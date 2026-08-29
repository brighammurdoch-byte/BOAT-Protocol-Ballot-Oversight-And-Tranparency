/**
 * Dev-mode private ballot helpers (mirrors @boat/zk-circuits binder proofs).
 * Production must use Circom + snarkjs with a real verifying key.
 */
import { sha256 } from "@noble/hashes/sha2";

const DOMAIN = new TextEncoder().encode("BOAT_GROTH16_DEV_V0");

function toBytes32(input: Uint8Array): Uint8Array {
  if (input.length === 32) return input;
  return sha256(input);
}

export function leafFromSecret(sk: string): Uint8Array {
  return sha256(new TextEncoder().encode(sk));
}

export function electionIdFromPubkey(pubkey: Uint8Array): Uint8Array {
  const out = new Uint8Array(pubkey);
  out[0] &= 0x1f;
  return out;
}

export function nullifierFrom(sk: string, electionId: Uint8Array): Uint8Array {
  const skBytes = new TextEncoder().encode(sk);
  const buf = new Uint8Array(skBytes.length + 32);
  buf.set(skBytes, 0);
  buf.set(electionId, skBytes.length);
  return sha256(buf);
}

function outcomeField(index: number): Uint8Array {
  const out = new Uint8Array(32);
  out[31] = index & 0xff;
  return out;
}

function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set(a, 0);
  buf.set(b, 32);
  return sha256(buf);
}

export function merkleRootFromSecrets(secrets: string[], depth = 8): Uint8Array {
  const size = 1 << depth;
  let layer: Uint8Array[] = Array.from({ length: size }, (_, i) =>
    i < secrets.length ? leafFromSecret(secrets[i]) : new Uint8Array(32)
  );
  for (let d = 0; d < depth; d++) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(hashPair(layer[i], layer[i + 1]));
    }
    layer = next;
  }
  return layer[0];
}

export function buildDevProof(publicInputs: Uint8Array[]): Uint8Array {
  const material = new Uint8Array(DOMAIN.length + 32 * publicInputs.length);
  material.set(DOMAIN, 0);
  let o = DOMAIN.length;
  for (const pi of publicInputs) {
    material.set(toBytes32(pi), o);
    o += 32;
  }
  let binder = sha256(material);
  const proof = new Uint8Array(256);
  proof[0] = 0x01;
  proof.set(binder, 1);
  for (let i = 33; i < 256; i += 32) {
    binder = sha256(binder);
    proof.set(binder.subarray(0, Math.min(32, 256 - i)), i);
  }
  return proof;
}

export function buildPrivateBallotPackage(args: {
  secret: string;
  electionPubkey: Uint8Array;
  outcomeIndex: number;
  /** Full electorate secrets used when the Merkle root was committed. */
  electorateSecrets: string[];
}) {
  const merkleRoot = merkleRootFromSecrets(args.electorateSecrets);
  const electionId = electionIdFromPubkey(args.electionPubkey);
  const nullifier = nullifierFrom(args.secret, electionId);
  const publicInputs = [
    merkleRoot,
    nullifier,
    outcomeField(args.outcomeIndex),
    electionId,
  ];
  const proof = buildDevProof(publicInputs);
  return { merkleRoot, nullifier, electionId, publicInputs, proof };
}
