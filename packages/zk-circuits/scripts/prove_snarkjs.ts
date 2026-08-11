/**
 * Prove a private ballot with snarkjs (Poseidon circuit) and pack the proof
 * for groth16-solana (256 bytes: a||b||c).
 *
 * Requires prior: ./scripts/compile_circuit.sh && ./scripts/setup_groth16.sh
 *
 * Usage: npx tsx scripts/prove_snarkjs.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildPoseidon } from "circomlibjs";
// snarkjs is CJS
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const snarkjs = require("snarkjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "build");

function toFieldHex(v: bigint | number | string): string {
  return BigInt(v).toString();
}

/** Pack snarkjs proof into groth16-solana 256-byte layout (BE, with negated A). */
export function packProofForSolana(proof: {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}): Uint8Array {
  const g1 = (p: string[]) => {
    const x = BigInt(p[0]);
    const y = BigInt(p[1]);
    return [...bigintToBe32(x), ...bigintToBe32(y)];
  };
  // Negate A: (x, -y) on BN254
  const ax = BigInt(proof.pi_a[0]);
  const ay = BigInt(proof.pi_a[1]);
  const FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const anegy = (FIELD - (ay % FIELD)) % FIELD;
  const proofA = [...bigintToBe32(ax), ...bigintToBe32(anegy)];

  // B is G2: snarkjs [[x0,x1],[y0,y1],...] — pack like VK G2 endianness
  const bx = proof.pi_b[0];
  const by = proof.pi_b[1];
  const proofB = [...processG2Pair(bx), ...processG2Pair(by)];
  const proofC = g1(proof.pi_c);

  const out = new Uint8Array(256);
  out.set(proofA, 0);
  out.set(proofB, 64);
  out.set(proofC, 192);
  return out;
}

function bigintToBe32(n: bigint): number[] {
  const out = new Array<number>(32).fill(0);
  let x = n;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function processG2Pair(pair: string[]): number[] {
  const toLe32 = (s: string) => {
    let n = BigInt(s);
    const le: number[] = [];
    for (let i = 0; i < 32; i++) {
      le.push(Number(n & 0xffn));
      n >>= 8n;
    }
    return le;
  };
  const concat = [...toLe32(pair[0]), ...toLe32(pair[1])];
  concat.reverse();
  return concat;
}

async function main() {
  const wasm = path.join(BUILD, "vote_js", "vote.wasm");
  const zkey = path.join(BUILD, "vote_final.zkey");
  if (!fs.existsSync(wasm) || !fs.existsSync(zkey)) {
    throw new Error("Missing build artifacts — run compile_circuit.sh + setup_groth16.sh");
  }

  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const hash1 = (a: bigint) => F.toObject(poseidon([a]));
  const hash2 = (a: bigint, b: bigint) => F.toObject(poseidon([a, b]));

  const depth = 8;
  const sk = 123456789n;
  const electionId = 42n;
  const outcomeIndex = 1n;
  const maxOutcomes = 16n;

  const leaf = hash1(sk);
  // Empty siblings = 0 path for leaf index 0
  const pathElements: string[] = [];
  const pathIndices: number[] = [];
  let node = leaf;
  for (let i = 0; i < depth; i++) {
    const sibling = 0n;
    pathElements.push(toFieldHex(sibling));
    pathIndices.push(0); // we are left
    node = hash2(node, sibling);
  }
  const merkleRoot = node;
  const nullifier = hash2(sk, electionId);

  const input = {
    merkleRoot: toFieldHex(merkleRoot),
    nullifier: toFieldHex(nullifier),
    outcomeIndex: toFieldHex(outcomeIndex),
    electionId: toFieldHex(electionId),
    sk: toFieldHex(sk),
    pathElements,
    pathIndices,
  };

  console.log("Proving…");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasm,
    zkey
  );
  const packed = packProofForSolana(proof);
  const outPath = path.join(BUILD, "sample_proof.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        publicSignals,
        proof,
        packedProofHex: Buffer.from(packed).toString("hex"),
        note: "packedProofHex is 256 bytes for cast_vote_zk when dev_mode=false",
        maxOutcomes: maxOutcomes.toString(),
      },
      null,
      2
    )
  );
  console.log("Wrote", outPath);
  console.log("publicSignals", publicSignals);
  console.log("packed length", packed.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
