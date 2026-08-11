/**
 * Tiny private-ballot electorate trial (dev_mode Groth16 binder proofs).
 *
 * Usage (localnet after `anchor test` deploy, or after deploying this program):
 *   SOLANA_RPC=http://127.0.0.1:8899 yarn demo:zk
 *
 * Limits: not coercion-resistant; not campus-production until audited + real VK.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { createRequire } from "module";
import BN from "bn.js";
import idl from "../target/idl/boat_final.json";

const require = createRequire(import.meta.url);
const anchor = require("@anchor-lang/core");
const { AnchorProvider, Program, Wallet } = anchor;

function loadKeypair(): Keypair {
  const p = path.join(os.homedir(), ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function sha256(...parts: Buffer[]): Buffer {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
}

function leafFromSecret(sk: string): Buffer {
  return sha256(Buffer.from(sk));
}

function buildTree(leaves: Buffer[], depth = 8): { root: Buffer } {
  const size = 1 << depth;
  let layer = Array.from({ length: size }, (_, i) =>
    i < leaves.length ? leaves[i] : Buffer.alloc(32)
  );
  for (let d = 0; d < depth; d++) {
    const next: Buffer[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(sha256(layer[i], layer[i + 1]));
    }
    layer = next;
  }
  return { root: layer[0] };
}

function nullifierOf(sk: string, electionId: Buffer): Buffer {
  return sha256(Buffer.from(sk), electionId);
}

function electionIdFromPubkey(key: PublicKey): Buffer {
  const out = Buffer.from(key.toBytes());
  out[0] &= 0x1f;
  return out;
}

function outcomeField(index: number): Buffer {
  const out = Buffer.alloc(32);
  out[31] = index & 0xff;
  return out;
}

function buildDevProof(publicInputs: Buffer[]): Buffer {
  const domain = Buffer.from("BOAT_GROTH16_DEV_V0");
  const binder = sha256(domain, ...publicInputs);
  const proof = Buffer.alloc(256);
  proof[0] = 0x01;
  binder.copy(proof, 1);
  let seed = binder;
  for (let i = 33; i < 256; i += 32) {
    seed = sha256(seed);
    seed.copy(proof, i, 0, Math.min(32, 256 - i));
  }
  return proof;
}

async function main() {
  const rpc = process.env.SOLANA_RPC ?? "http://127.0.0.1:8899";
  const connection = new Connection(rpc, "confirmed");
  const authority = loadKeypair();
  const wallet = new Wallet(authority);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new Program(idl as any, provider);

  const secrets = Array.from({ length: 8 }, (_, i) => `usu-zk-voter-${i}`);
  const leaves = secrets.map(leafFromSecret);
  const { root } = buildTree(leaves);

  const title = `USU ZK Trial ${Date.now()}`;
  const now = Math.floor(Date.now() / 1000);
  const startTime = now + 6;
  const endTime = now + 3600;

  const [election] = PublicKey.findProgramAddressSync(
    [Buffer.from("election"), authority.publicKey.toBuffer(), Buffer.from(title)],
    program.programId
  );
  const [electionConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), election.toBuffer()],
    program.programId
  );
  const [sbtMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint"), election.toBuffer()],
    program.programId
  );
  const [privateConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("private"), election.toBuffer()],
    program.programId
  );

  console.log("Program", program.programId.toBase58());
  console.log("Creating private trial:", title);

  await program.methods
    .initializeElection(title, new BN(startTime), new BN(endTime))
    .accounts({
      authority: authority.publicKey,
      election,
      electionConfig,
      sbtMint,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  for (const [i, label] of ["Alice", "Bob"].entries()) {
    const [outcome] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome"), election.toBuffer(), Buffer.from([i])],
      program.programId
    );
    await program.methods
      .addOutcome(label, i)
      .accounts({
        authority: authority.publicKey,
        election,
        outcome,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  await program.methods
    .enablePrivateBallots(Array.from(root), true)
    .accounts({
      authority: authority.publicKey,
      election,
      privateConfig,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const waitMs = Math.max(0, (startTime - Math.floor(Date.now() / 1000) + 1) * 1000);
  console.log(`Waiting ${waitMs}ms for voting window...`);
  await new Promise((r) => setTimeout(r, waitMs));

  const electionId = electionIdFromPubkey(election);
  const votes = [
    { sk: secrets[0], outcome: 0 },
    { sk: secrets[1], outcome: 0 },
    { sk: secrets[2], outcome: 1 },
    { sk: secrets[3], outcome: 0 },
    { sk: secrets[4], outcome: 1 },
    { sk: secrets[5], outcome: 1 },
    { sk: secrets[6], outcome: 0 },
    { sk: secrets[7], outcome: 1 },
  ];

  for (const v of votes) {
    const nullifier = nullifierOf(v.sk, electionId);
    const publicInputs = [root, nullifier, outcomeField(v.outcome), electionId];
    const proof = buildDevProof(publicInputs);
    const [nullifierRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from("nullifier"), election.toBuffer(), nullifier],
      program.programId
    );
    const [outcome] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome"), election.toBuffer(), Buffer.from([v.outcome])],
      program.programId
    );
    const [privateTally] = PublicKey.findProgramAddressSync(
      [Buffer.from("private_tally"), election.toBuffer(), Buffer.from([v.outcome])],
      program.programId
    );
    const sig = await program.methods
      .castVoteZk(
        v.outcome,
        Array.from(nullifier),
        proof,
        publicInputs.map((p) => Array.from(p))
      )
      .accounts({
        payer: authority.publicKey,
        election,
        privateConfig,
        nullifierRecord,
        outcome,
        privateTally,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`vote outcome=${v.outcome} sig=${sig.slice(0, 16)}...`);
  }

  for (const i of [0, 1]) {
    const [tallyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("private_tally"), election.toBuffer(), Buffer.from([i])],
      program.programId
    );
    const t: any = await program.account.privateOutcomeTally.fetch(tallyPda);
    console.log(`tally[${i}] weight=${t.weight.toString()}`);
  }

  const cfg: any = await program.account.privateBallotConfig.fetch(privateConfig);
  console.log("private_vote_count", cfg.privateVoteCount.toString());
  console.log("Election PDA", election.toBase58());
  console.log("OK — private ballot trial complete (dev_mode proofs).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
