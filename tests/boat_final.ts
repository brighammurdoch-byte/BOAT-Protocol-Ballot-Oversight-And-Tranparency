import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { createHash } from "crypto";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getAccount,
  mintTo,
  createAssociatedTokenAccountIdempotent,
} from "@solana/spl-token";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const idl = require("../app/boat-frontend/src/idl/boat_final.json");

const SYSTEM_PROGRAM_ID = anchor.web3.SystemProgram.programId;
const ASSOCIATED_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

const rentSysvar = new anchor.web3.PublicKey(
  "SysvarRent111111111111111111111111111111111"
);

const PROGRAM_ID = new anchor.web3.PublicKey(idl.address);

function hashv(parts: Buffer[]): Buffer {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
}

/** Must match on-chain `leaf_hash` (BOAT_V1 || election || voter). */
export function leafHash(
  election: anchor.web3.PublicKey,
  voter: anchor.web3.PublicKey
): Buffer {
  return hashv([
    Buffer.from("BOAT_V1"),
    election.toBuffer(),
    voter.toBuffer(),
  ]);
}

function merkleParent(a: Buffer, b: Buffer): Buffer {
  const [l, r] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return hashv([l, r]);
}

/** Build Merkle root from leaf buffers (sorted-pair tree, matches program). */
export function merkleRootFromLeaves(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) throw new Error("no leaves");
  let layer = [...leaves];
  while (layer.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        next.push(merkleParent(layer[i], layer[i + 1]));
      } else {
        next.push(layer[i]);
      }
    }
    layer = next;
  }
  return layer[0];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("boat_final", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const connection = provider.connection;
  const authority = provider.wallet as anchor.Wallet;

  const program = new Program(idl, PROGRAM_ID, provider) as Program;

  const nowTs = () => Math.floor(Date.now() / 1000);

  const deriveElectionPdas = (title: string) => {
    const [election] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("election"),
        authority.publicKey.toBuffer(),
        Buffer.from(title),
      ],
      program.programId
    );
    const [config] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config"), election.toBuffer()],
      program.programId
    );
    const [mint] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), election.toBuffer()],
      program.programId
    );
    return { election, config, mint };
  };

  const deriveVoterRegistry = (
    election: anchor.web3.PublicKey,
    voter: anchor.web3.PublicKey
  ) => {
    const [voterRegistry] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("voter_registry"),
        election.toBuffer(),
        voter.toBuffer(),
      ],
      program.programId
    );
    return voterRegistry;
  };

  const deriveOutcome = (
    election: anchor.web3.PublicKey,
    index: number
  ) => {
    const [outcome] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("outcome"), election.toBuffer(), Buffer.from([index])],
      program.programId
    );
    return outcome;
  };

  const addOutcomes = async (
    election: anchor.web3.PublicKey,
    labels: string[]
  ) => {
    for (let i = 0; i < labels.length; i++) {
      const outcome = deriveOutcome(election, i);
      await program.methods
        .addOutcome(labels[i], i)
        .accounts({
          authority: authority.publicKey,
          election,
          outcome,
          systemProgram: SYSTEM_PROGRAM_ID,
        })
        .rpc();
    }
  };

  it("initialize_election creates election/config/mint PDAs", async () => {
    const title = `Test_${nowTs()}`;
    const { election, config, mint } = deriveElectionPdas(title);
    const start = new anchor.BN(nowTs() - 2);
    const end = new anchor.BN(nowTs() + 60);

    await program.methods
      .initializeElection(title, start, end)
      .accounts({
        authority: authority.publicKey,
        election,
        electionConfig: config,
        sbtMint: mint,
        systemProgram: SYSTEM_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: rentSysvar,
      })
      .rpc();

    const electionAcct = await program.account.election.fetch(election);
    expect(electionAcct.authority.toBase58()).to.eq(
      authority.publicKey.toBase58()
    );
    expect(electionAcct.title).to.eq(title);
    expect(electionAcct.sbtMint.toBase58()).to.eq(mint.toBase58());
    expect(electionAcct.outcomeCount).to.eq(0);
    expect(electionAcct.registeredVoterCount).to.eq(0);

    const cfgAcct = await program.account.electionConfig.fetch(config);
    expect(cfgAcct.election.toBase58()).to.eq(election.toBase58());
    expect(cfgAcct.allowDelegation).to.eq(true);
    expect(cfgAcct.allowTokenVoting).to.eq(false);
  });

  it("set_election_config updates config fields", async () => {
    const title = `Cfg_${nowTs()}`;
    const { election, config, mint } = deriveElectionPdas(title);
    await program.methods
      .initializeElection(
        title,
        new anchor.BN(nowTs() - 2),
        new anchor.BN(nowTs() + 60)
      )
      .accounts({
        authority: authority.publicKey,
        election,
        electionConfig: config,
        sbtMint: mint,
        systemProgram: SYSTEM_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: rentSysvar,
      })
      .rpc();

    await program.methods
      .setElectionConfig(new anchor.BN(3), 50, 1, new anchor.BN(0), false)
      .accounts({
        authority: authority.publicKey,
        election,
        electionConfig: config,
      })
      .rpc();

    const cfgAcct = await program.account.electionConfig.fetch(config);
    expect(cfgAcct.defaultVoterWeight.toString()).to.eq("3");
    expect(cfgAcct.quorumPercentage).to.eq(50);
  });

  it("register_voter_sponsored in OPEN mode (payer = authority)", async () => {
    const title = `Self_${nowTs()}`;
    const { election, config, mint } = deriveElectionPdas(title);
    const start = new anchor.BN(nowTs() + 30);
    const end = new anchor.BN(nowTs() + 3600);

    await program.methods
      .initializeElection(title, start, end)
      .accounts({
        authority: authority.publicKey,
        election,
        electionConfig: config,
        sbtMint: mint,
        systemProgram: SYSTEM_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: rentSysvar,
      })
      .rpc();

    const rootZero = new Array(32).fill(0);
    await program.methods
      .setRegistrationPolicy(1, rootZero, new anchor.BN(0), 0, new anchor.BN(0))
      .accounts({
        authority: authority.publicKey,
        election,
        electionConfig: config,
      })
      .rpc();

    const voter = anchor.web3.Keypair.generate();
    const voterRegistry = deriveVoterRegistry(election, voter.publicKey);
    const voterAta = getAssociatedTokenAddressSync(
      mint,
      voter.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const sig = await program.methods
      .registerVoterSponsored([])
      .accounts({
        authority: authority.publicKey,
        voter: voter.publicKey,
        election,
        electionConfig: config,
        sbtMint: mint,
        voterRegistry,
        voterTokenAccount: voterAta,
        systemProgram: SYSTEM_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([voter])
      .rpc();

    expect(sig.length).to.be.greaterThan(10);
    const vr = await program.account.voterRegistry.fetch(voterRegistry);
    expect(vr.isWhitelisted).to.eq(true);
    expect(vr.weight.toString()).to.eq("1");
  });

  it("register_voter_sponsored MERKLE with 2-leaf tree", async () => {
    const title = `Mrk_${nowTs()}`;
    const { election, config, mint } = deriveElectionPdas(title);
    const start = new anchor.BN(nowTs() + 30);
    const end = new anchor.BN(nowTs() + 3600);

    await program.methods
      .initializeElection(title, start, end)
      .accounts({
        authority: authority.publicKey,
        election,
        electionConfig: config,
        sbtMint: mint,
        systemProgram: SYSTEM_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: rentSysvar,
      })
      .rpc();

    const voterA = anchor.web3.Keypair.generate();
    const voterB = anchor.web3.Keypair.generate();
    const leafA = leafHash(election, voterA.publicKey);
    const leafB = leafHash(election, voterB.publicKey);
    const root = merkleRootFromLeaves([leafA, leafB]);
    const rootArr = Array.from(root);

    await program.methods
      .setRegistrationPolicy(
        2,
        rootArr,
        new anchor.BN(0),
        0,
        new anchor.BN(0)
      )
      .accounts({
        authority: authority.publicKey,
        election,
        electionConfig: config,
      })
      .rpc();

    const proofArg = [Array.from(leafB)];

    const voterRegistryA = deriveVoterRegistry(election, voterA.publicKey);
    const ataA = getAssociatedTokenAddressSync(
      mint,
      voterA.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    await program.methods
      .registerVoterSponsored(proofArg)
      .accounts({
        authority: authority.publicKey,
        voter: voterA.publicKey,
        election,
        electionConfig: config,
        sbtMint: mint,
        voterRegistry: voterRegistryA,
        voterTokenAccount: ataA,
        systemProgram: SYSTEM_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([voterA])
      .rpc();
  });

  it("register_voter mints SBT + increments registered count", async () => {
    const title = `Reg_${nowTs()}`;
    const { election, config, mint } = deriveElectionPdas(title);
    await program.methods
      .initializeElection(
        title,
        new anchor.BN(nowTs() - 2),
        new anchor.BN(nowTs() + 120)
      )
      .accounts({
        authority: authority.publicKey,
        election,
        electionConfig: config,
        sbtMint: mint,
        systemProgram: SYSTEM_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: rentSysvar,
      })
      .rpc();

    const voter = anchor.web3.Keypair.generate();
    const voterRegistry = deriveVoterRegistry(election, voter.publicKey);
    const voterAta = getAssociatedTokenAddressSync(
      mint,
      voter.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    await program.methods
      .registerVoter(new anchor.BN(2))
      .accounts({
        authority: authority.publicKey,
        election,
        electionConfig: config,
        sbtMint: mint,
        voter: voter.publicKey,
        voterRegistry,
        voterTokenAccount: voterAta,
        systemProgram: SYSTEM_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    const vr = await program.account.voterRegistry.fetch(voterRegistry);
    expect(vr.isWhitelisted).to.eq(true);
    expect(vr.weight.toString()).to.eq("2");

    const el = await program.account.election.fetch(election);
    expect(el.registeredVoterCount).to.eq(1);
  });

  it("delegate_vote blocks direct voting after delegation", async () => {
    const title = `Dlg_${nowTs()}`;
    const { election, config, mint } = deriveElectionPdas(title);
    const t0 = nowTs();
    await program.methods
      .initializeElection(
        title,
        new anchor.BN(t0 + 4),
        new anchor.BN(t0 + 3600)
      )
      .accounts({
        authority: authority.publicKey,
        election,
        electionConfig: config,
        sbtMint: mint,
        systemProgram: SYSTEM_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: rentSysvar,
      })
      .rpc();

    await addOutcomes(election, ["Alice", "Bob"]);

    const voterA = anchor.web3.Keypair.generate();
    const voterB = anchor.web3.Keypair.generate();

    const reg = async (voter: anchor.web3.Keypair) => {
      const voterRegistry = deriveVoterRegistry(election, voter.publicKey);
      const voterAta = getAssociatedTokenAddressSync(
        mint,
        voter.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      await program.methods
        .registerVoter(new anchor.BN(1))
        .accounts({
          authority: authority.publicKey,
          election,
          electionConfig: config,
          sbtMint: mint,
          voter: voter.publicKey,
          voterRegistry,
          voterTokenAccount: voterAta,
          systemProgram: SYSTEM_PROGRAM_ID,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
      return { voterRegistry, voterAta };
    };

    const a = await reg(voterA);
    const b = await reg(voterB);

    await program.methods
      .delegateVote()
      .accounts({
        voter: voterA.publicKey,
        election,
        electionConfig: config,
        voterRegistry: a.voterRegistry,
        delegateRegistry: b.voterRegistry,
      })
      .signers([voterA])
      .rpc();

    await sleep(5000);

    const o0 = deriveOutcome(election, 0);
    await expect(
      program.methods
        .castVote(0)
        .accounts({
          voter: voterA.publicKey,
          feeReceiver: authority.publicKey,
          election,
          electionConfig: config,
          sbtMint: mint,
          voterRegistry: a.voterRegistry,
          voterTokenAccount: a.voterAta,
          outcome: o0,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SYSTEM_PROGRAM_ID,
        })
        .signers([voterA])
        .rpc()
    ).to.be.rejected;
  });

  it("cast_vote requires outcome index + records label", async () => {
    const title = `Vote_${nowTs()}`;
    const { election, config, mint } = deriveElectionPdas(title);
    const t0 = nowTs();
    await program.methods
      .initializeElection(
        title,
        new anchor.BN(t0 + 4),
        new anchor.BN(t0 + 3600)
      )
      .accounts({
        authority: authority.publicKey,
        election,
        electionConfig: config,
        sbtMint: mint,
        systemProgram: SYSTEM_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: rentSysvar,
      })
      .rpc();

    await addOutcomes(election, ["Bob", "Alice"]);

    const voter = anchor.web3.Keypair.generate();
    const voterRegistry = deriveVoterRegistry(election, voter.publicKey);
    const voterAta = getAssociatedTokenAddressSync(
      mint,
      voter.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    await program.methods
      .registerVoter(new anchor.BN(1))
      .accounts({
        authority: authority.publicKey,
        election,
        electionConfig: config,
        sbtMint: mint,
        voter: voter.publicKey,
        voterRegistry,
        voterTokenAccount: voterAta,
        systemProgram: SYSTEM_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    await sleep(5000);

    const o0 = deriveOutcome(election, 0);
    const o1 = deriveOutcome(election, 1);

    await program.methods
      .castVote(0)
      .accounts({
        voter: voter.publicKey,
        feeReceiver: authority.publicKey,
        election,
        electionConfig: config,
        sbtMint: mint,
        voterRegistry,
        voterTokenAccount: voterAta,
        outcome: o0,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM_ID,
      })
      .signers([voter])
      .rpc();

    let vr = await program.account.voterRegistry.fetch(voterRegistry);
    expect(vr.hasVoted).to.eq(true);
    expect(vr.currentVote).to.eq("Bob");
    expect(vr.voteChangesUsed).to.eq(0);

    await program.methods
      .castVote(1)
      .accounts({
        voter: voter.publicKey,
        feeReceiver: authority.publicKey,
        election,
        electionConfig: config,
        sbtMint: mint,
        voterRegistry,
        voterTokenAccount: voterAta,
        outcome: o1,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM_ID,
      })
      .signers([voter])
      .rpc();

    vr = await program.account.voterRegistry.fetch(voterRegistry);
    expect(vr.currentVote).to.eq("Alice");
    expect(vr.voteChangesUsed).to.eq(1);
  });

  it("cast_vote_with_token with outcomes", async () => {
    const title = `Tok_${nowTs()}`;
    const { election, config, mint } = deriveElectionPdas(title);
    const t0 = nowTs();
    await program.methods
      .initializeElection(
        title,
        new anchor.BN(t0 + 4),
        new anchor.BN(t0 + 3600)
      )
      .accounts({
        authority: authority.publicKey,
        election,
        electionConfig: config,
        sbtMint: mint,
        systemProgram: SYSTEM_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: rentSysvar,
      })
      .rpc();

    await addOutcomes(election, ["OptA"]);

    const govMint = await createMint(
      connection,
      authority.payer,
      authority.publicKey,
      null,
      0,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );

    await program.methods
      .enableTokenVoting(new anchor.BN(2))
      .accounts({
        authority: authority.publicKey,
        election,
        electionConfig: config,
        tokenMint: govMint,
        systemProgram: SYSTEM_PROGRAM_ID,
      })
      .rpc();

    const voter = anchor.web3.Keypair.generate();
    const voterGovAta = await createAssociatedTokenAccountIdempotent(
      connection,
      authority.payer,
      govMint,
      voter.publicKey,
      {},
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await mintTo(
      connection,
      authority.payer,
      govMint,
      voterGovAta,
      authority.publicKey,
      1,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    await expect(
      program.methods
        .castVoteWithToken(0)
        .accounts({
          voter: voter.publicKey,
          election,
          electionConfig: config,
          voterTokenAccount: voterGovAta,
          tokenMint: govMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          outcome: deriveOutcome(election, 0),
        })
        .signers([voter])
        .rpc()
    ).to.be.rejected;

    await mintTo(
      connection,
      authority.payer,
      govMint,
      voterGovAta,
      authority.publicKey,
      1,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    await sleep(5000);

    await program.methods
      .castVoteWithToken(0)
      .accounts({
        voter: voter.publicKey,
        election,
        electionConfig: config,
        voterTokenAccount: voterGovAta,
        tokenMint: govMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        outcome: deriveOutcome(election, 0),
      })
      .signers([voter])
      .rpc();
  });
});
