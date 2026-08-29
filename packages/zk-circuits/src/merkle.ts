/**
 * SHA-256 Merkle tree for eligibility leaves (dev / SDK path).
 * Circom circuit uses Poseidon; production proving must use the Circom leaf hash.
 * This tree is for client-side enrollment lists and deterministic proof helpers.
 */
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

export const MERKLE_DEPTH = 8;
export const MAX_LEAVES = 1 << MERKLE_DEPTH;

export type Bytes32 = Uint8Array; // length 32

export function toBytes32(input: Uint8Array | string): Bytes32 {
  if (typeof input === "string") {
    const hex = input.startsWith("0x") ? input.slice(2) : input;
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length === 64) {
      return hexToBytes(hex);
    }
    return sha256(new TextEncoder().encode(input));
  }
  if (input.length === 32) return new Uint8Array(input);
  return sha256(input);
}

export function hashPair(left: Bytes32, right: Bytes32): Bytes32 {
  const buf = new Uint8Array(64);
  buf.set(left, 0);
  buf.set(right, 32);
  return sha256(buf);
}

/** leaf = H(sk) for the SHA-256 reference path */
export function leafFromSecret(sk: Uint8Array | string): Bytes32 {
  return toBytes32(typeof sk === "string" ? new TextEncoder().encode(sk) : sk);
}

/** nullifier = H(sk || electionId) */
export function nullifierFrom(sk: Uint8Array | string, electionId: Bytes32): Bytes32 {
  const skBytes =
    typeof sk === "string" ? new TextEncoder().encode(sk) : sk;
  const buf = new Uint8Array(skBytes.length + 32);
  buf.set(skBytes, 0);
  buf.set(electionId, skBytes.length);
  return sha256(buf);
}

/** Pack Solana pubkey (32 bytes) into a field-ish 32-byte id (clear high bit). */
export function electionIdFromPubkey(pubkey: Uint8Array): Bytes32 {
  const out = new Uint8Array(32);
  out.set(pubkey.subarray(0, 32));
  out[0] &= 0x1f; // keep in BN254 scalar range heuristically
  return out;
}

export type MerkleProof = {
  root: Bytes32;
  leaf: Bytes32;
  pathElements: Bytes32[];
  pathIndices: number[]; // 0 = left, 1 = right
  leafIndex: number;
};

export class EligibilityMerkleTree {
  readonly depth: number;
  private leaves: Bytes32[];
  private layers: Bytes32[][];

  constructor(leaves: Bytes32[], depth: number = MERKLE_DEPTH) {
    if (leaves.length > 1 << depth) {
      throw new Error(`Too many leaves for depth ${depth}`);
    }
    this.depth = depth;
    const size = 1 << depth;
    const zero = new Uint8Array(32);
    this.leaves = Array.from({ length: size }, (_, i) =>
      i < leaves.length ? leaves[i] : zero
    );
    this.layers = [this.leaves];
    for (let d = 0; d < depth; d++) {
      const prev = this.layers[d];
      const next: Bytes32[] = [];
      for (let i = 0; i < prev.length; i += 2) {
        next.push(hashPair(prev[i], prev[i + 1]));
      }
      this.layers.push(next);
    }
  }

  get root(): Bytes32 {
    return this.layers[this.depth][0];
  }

  get rootHex(): string {
    return bytesToHex(this.root);
  }

  proof(leafIndex: number): MerkleProof {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error("leafIndex out of range");
    }
    const pathElements: Bytes32[] = [];
    const pathIndices: number[] = [];
    let idx = leafIndex;
    for (let d = 0; d < this.depth; d++) {
      const layer = this.layers[d];
      const sibling = idx % 2 === 0 ? layer[idx + 1] : layer[idx - 1];
      pathElements.push(sibling);
      pathIndices.push(idx % 2); // 0 if we are left
      idx = Math.floor(idx / 2);
    }
    return {
      root: this.root,
      leaf: this.leaves[leafIndex],
      pathElements,
      pathIndices,
      leafIndex,
    };
  }
}

export function bytes32ToHex(b: Bytes32): string {
  return bytesToHex(b);
}
