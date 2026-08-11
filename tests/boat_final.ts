import anchor from "@anchor-lang/core";
import BN from "bn.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { assert } from "chai";

const { AnchorProvider, Program, setProvider, workspace } = anchor as any;

describe("boat_final USU MVP", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);

  const program = (workspace as any).boatFinal as InstanceType<typeof Program>;
  const authority = provider.wallet;

  const title = `USU Officers ${Date.now()}`;
  let election: PublicKey;
  let electionConfig: PublicKey;
  let sbtMint: PublicKey;
  const voter = Keypair.generate();

  const now = Math.floor(Date.now() / 1000);
  const startTime = now + 4;
  const endTime = now + 3600;

  it("initializes election", async () => {
    [election] = PublicKey.findProgramAddressSync(
      [Buffer.from("election"), authority.publicKey.toBuffer(), Buffer.from(title)],
      program.programId
    );
    [electionConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), election.toBuffer()],
      program.programId
    );
    [sbtMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), election.toBuffer()],
      program.programId
    );

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

    const e: any = await program.account.election.fetch(election);
    assert.equal(e.title, title);
    assert.equal(e.outcomeCount, 0);
  });

  it("adds outcomes before start", async () => {
    for (const [i, label] of ["Alice", "Bob", "Carol"].entries()) {
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
    const e: any = await program.account.election.fetch(election);
    assert.equal(e.outcomeCount, 3);
  });

  it("sets config before start", async () => {
    await program.methods
      .setElectionConfig(new BN(1), 50, 2, new BN(0), false)
      .accounts({
        authority: authority.publicKey,
        election,
        electionConfig,
      })
      .rpc();
    const cfg: any = await program.account.electionConfig.fetch(electionConfig);
    assert.equal(cfg.quorumPercentage, 50);
  });

  it("registers voter and casts / changes vote after start", async () => {
    const airdrop = await provider.connection.requestAirdrop(voter.publicKey, 2e9);
    await provider.connection.confirmTransaction(airdrop);

    const [voterRegistry] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("voter_registry"),
        election.toBuffer(),
        voter.publicKey.toBuffer(),
      ],
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

    const waitMs = Math.max(0, (startTime - Math.floor(Date.now() / 1000) + 1) * 1000);
    await new Promise((r) => setTimeout(r, waitMs));

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
        sbtMint,
        voterRegistry,
        voterTokenAccount: voterAta,
        outcome: outcome0,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([voter])
      .rpc();

    const reg: any = await program.account.voterRegistry.fetch(voterRegistry);
    assert.isTrue(reg.hasVoted);
    assert.equal(reg.currentVote, "Alice");

    const [outcome1] = PublicKey.findProgramAddressSync(
      [Buffer.from("outcome"), election.toBuffer(), Buffer.from([1])],
      program.programId
    );
    await program.methods
      .castVote(1)
      .accounts({
        voter: voter.publicKey,
        feeReceiver: voter.publicKey,
        election,
        electionConfig,
        sbtMint,
        voterRegistry,
        voterTokenAccount: voterAta,
        outcome: outcome1,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([voter])
      .rpc();

    const reg2: any = await program.account.voterRegistry.fetch(voterRegistry);
    assert.equal(reg2.currentVote, "Bob");
    assert.equal(reg2.voteChangesUsed, 1);
  });
});
