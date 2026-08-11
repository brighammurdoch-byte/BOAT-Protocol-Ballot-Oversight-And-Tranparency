/**
 * USU mock officer election demo.
 * Uses the local wallet (~/.config/solana/id.json) against SOLANA_RPC (default localnet).
 *
 * Usage (from repo root, after program deploy):
 *   SOLANA_RPC=https://api.devnet.solana.com yarn demo:usu
 */
import fs from "fs";
import os from "os";
import path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
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

async function main() {
  const rpc = process.env.SOLANA_RPC ?? "http://127.0.0.1:8899";
  const connection = new Connection(rpc, "confirmed");
  const authority = loadKeypair();
  const wallet = new Wallet(authority);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new Program(idl as any, provider);

  const title = `USU Officers Demo ${Date.now()}`;
  const now = Math.floor(Date.now() / 1000);
  const startTime = now + 8;
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

  console.log("Program", program.programId.toBase58());
  console.log("Creating", title);

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

  for (const [i, label] of ["President A", "President B", "President C"].entries()) {
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
    console.log("Outcome", i, label);
  }

  const voter = Keypair.generate();
  // Fund voter from authority (devnet airdrop is often rate-limited)
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: voter.publicKey,
      lamports: 50_000_000,
    })
  );
  await sendAndConfirmTransaction(connection, fundTx, [authority]);

  const [voterRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("voter_registry"), election.toBuffer(), voter.publicKey.toBuffer()],
    program.programId
  );
  const voterAta = getAssociatedTokenAddressSync(
    sbtMint,
    voter.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  await program.methods
    .registerVoter(new BN(1))
    .accounts({
      authority: authority.publicKey,
      election,
      electionConfig,
      sbtMint,
      voter: voter.publicKey,
      voterRegistry,
      voterTokenAccount: voterAta,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();

  // Wait until cluster clock is past start (validator clock can lag wall time)
  for (;;) {
    const slot = await connection.getSlot("confirmed");
    const bt = await connection.getBlockTime(slot);
    if (bt != null && bt >= startTime) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  await new Promise((r) => setTimeout(r, 2000));

  const [outcome0] = PublicKey.findProgramAddressSync(
    [Buffer.from("outcome"), election.toBuffer(), Buffer.from([0])],
    program.programId
  );

  await program.methods
    .castVote(0)
    .accounts({
      voter: voter.publicKey,
      feeReceiver: voter.publicKey,
      election,
        electionConfig,
        privateConfig: null,
        sbtMint,
      voterRegistry,
      voterTokenAccount: voterAta,
      outcome: outcome0,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([voter])
    .rpc();

  const reg = await program.account.voterRegistry.fetch(voterRegistry);
  console.log("Election PDA", election.toBase58());
  console.log("Voter", voter.publicKey.toBase58());
  console.log("Vote", reg.currentVote);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
