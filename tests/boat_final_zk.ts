const anchor = require("@anchor-lang/core");
import BN from "bn.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { assert } from "chai";
import { createHash } from "crypto";

const { AnchorProvider, Program, setProvider, workspace } = anchor;

/** Mirror of @boat/zk-circuits buildDevProof binder (no package resolve in mocha). */
function buildDevProof(publicInputs: Buffer[]): Buffer {
  const domain = Buffer.from("BOAT_GROTH16_DEV_V0");
  const material = Buffer.concat([domain, ...publicInputs]);
  const binder = createHash("sha256").update(material).digest();
  const proof = Buffer.alloc(256);
  proof[0] = 0x01;
  binder.copy(proof, 1);
  let seed = binder;
  for (let i = 33; i < 256; i += 32) {
    seed = createHash("sha256").update(seed).digest();
    seed.copy(proof, i, 0, Math.min(32, 256 - i));
  }
  return proof;
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

describe("boat_final private ballot (ZK v0)", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);
  const program = (workspace as any).boatFinal as InstanceType<typeof Program>;
  const authority = provider.wallet;

  const title = `USU Private ${Date.now()}`;
  let election: PublicKey;
  let electionConfig: PublicKey;
  let sbtMint: PublicKey;
  let privateConfig: PublicKey;

  const now = Math.floor(Date.now() / 1000);
  const startTime = now + 8;
  const endTime = now + 3600;
  const merkleRoot = Buffer.alloc(32, 7);

  it("initializes transparent election then enables private mode", async () => {
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
    [privateConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("private"), election.toBuffer()],
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

    await program.methods
      .addOutcome("Alice", 0)
      .accounts({
        authority: authority.publicKey,
        election,
        outcome: PublicKey.findProgramAddressSync(
          [Buffer.from("outcome"), election.toBuffer(), Buffer.from([0])],
          program.programId
        )[0],
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .addOutcome("Bob", 1)
      .accounts({
        authority: authority.publicKey,
        election,
        outcome: PublicKey.findProgramAddressSync(
          [Buffer.from("outcome"), election.toBuffer(), Buffer.from([1])],
          program.programId
        )[0],
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .enablePrivateBallots(Array.from(merkleRoot), true)
      .accounts({
        authority: authority.publicKey,
        election,
        privateConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const cfg: any = await program.account.privateBallotConfig.fetch(privateConfig);
    assert.isTrue(cfg.enabled);
    assert.isTrue(cfg.devMode);
  });

  it("casts private ballots and aggregates tallies; rejects double nullifier", async () => {
    const waitMs = Math.max(0, (startTime - Math.floor(Date.now() / 1000) + 1) * 1000);
    await new Promise((r) => setTimeout(r, waitMs));

    const castOne = async (nullifierByte: number, outcomeIndex: number) => {
      const nullifier = Buffer.alloc(32, nullifierByte);
      const electionId = electionIdFromPubkey(election);
      const publicInputs = [
        merkleRoot,
        nullifier,
        outcomeField(outcomeIndex),
        electionId,
      ];
      const proof = buildDevProof(publicInputs);
      const [nullifierRecord] = PublicKey.findProgramAddressSync(
        [Buffer.from("nullifier"), election.toBuffer(), nullifier],
        program.programId
      );
      const [outcome] = PublicKey.findProgramAddressSync(
        [Buffer.from("outcome"), election.toBuffer(), Buffer.from([outcomeIndex])],
        program.programId
      );
      const [privateTally] = PublicKey.findProgramAddressSync(
        [Buffer.from("private_tally"), election.toBuffer(), Buffer.from([outcomeIndex])],
        program.programId
      );

      await program.methods
        .castVoteZk(
          outcomeIndex,
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
    };

    await castOne(11, 0);
    await castOne(12, 0);
    await castOne(13, 1);

    const [tally0] = PublicKey.findProgramAddressSync(
      [Buffer.from("private_tally"), election.toBuffer(), Buffer.from([0])],
      program.programId
    );
    const [tally1] = PublicKey.findProgramAddressSync(
      [Buffer.from("private_tally"), election.toBuffer(), Buffer.from([1])],
      program.programId
    );
    const t0: any = await program.account.privateOutcomeTally.fetch(tally0);
    const t1: any = await program.account.privateOutcomeTally.fetch(tally1);
    assert.equal(Number(t0.weight), 2);
    assert.equal(Number(t1.weight), 1);

    let threw = false;
    try {
      await castOne(11, 0); // same nullifier
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "duplicate nullifier must fail");
  });
});
