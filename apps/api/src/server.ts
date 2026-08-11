import cors from "cors";
import express from "express";
import { Connection, PublicKey } from "@solana/web3.js";

const PORT = Number(process.env.PORT ?? 8787);
const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";

const connection = new Connection(RPC, "confirmed");
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

async function boat() {
  return await import("@boat/sdk");
}

app.get("/health", async (_req, res) => {
  try {
    const { DEFAULT_BOAT_PROGRAM_ID } = await boat();
    const version = await connection.getVersion();
    const account = await connection.getAccountInfo(DEFAULT_BOAT_PROGRAM_ID);
    res.json({
      ok: true,
      rpc: RPC,
      solana: version,
      programId: DEFAULT_BOAT_PROGRAM_ID.toBase58(),
      programDeployed: Boolean(account),
    });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/elections/:pda", async (req, res) => {
  try {
    const {
      getBoatProgram,
      pdaElectionConfig,
      pdaOutcome,
      pdaSbtMint,
    } = await boat();
    const election = new PublicKey(req.params.pda);
    const readWallet = {
      publicKey: PublicKey.default,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any[]) => txs,
    };
    const program = getBoatProgram(connection, readWallet as any);
    const data = await (program.account as any).election.fetch(election);
    const [configPda] = pdaElectionConfig(election);
    const config = await (program.account as any).electionConfig.fetch(configPda);
    const [sbtMint] = pdaSbtMint(election);
    const outcomes = [];
    for (let i = 0; i < Number(data.outcomeCount); i++) {
      const [pk] = pdaOutcome(election, i);
      const o = await (program.account as any).electionOutcome.fetch(pk);
      outcomes.push({ index: o.index, label: o.label, pubkey: pk.toBase58() });
    }
    res.json({
      election: election.toBase58(),
      title: data.title,
      authority: data.authority.toBase58(),
      startTime: Number(data.startTime),
      endTime: Number(data.endTime),
      outcomeCount: Number(data.outcomeCount),
      registeredVoterCount: Number(data.registeredVoterCount),
      totalWeight: data.totalWeight?.toString?.() ?? String(data.totalWeight),
      sbtMint: sbtMint.toBase58(),
      config: {
        quorumPercentage: Number(config.quorumPercentage),
        defaultVoterWeight:
          config.defaultVoterWeight?.toString?.() ?? String(config.defaultVoterWeight),
        maxFreeVoteChanges: Number(config.maxFreeVoteChanges),
        allowDelegation: Boolean(config.allowDelegation),
      },
      outcomes,
    });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/elections/:pda/tally", async (req, res) => {
  try {
    const {
      DEFAULT_BOAT_PROGRAM_ID,
      fetchVoterRegistriesForElection,
      tallyFromRegistries,
      pdaElectionConfig,
      getBoatProgram,
    } = await boat();
    const election = new PublicKey(req.params.pda);
    const rows = await fetchVoterRegistriesForElection(
      connection,
      DEFAULT_BOAT_PROGRAM_ID,
      election
    );
    let quorumPct = 33;
    try {
      const readWallet = {
        publicKey: PublicKey.default,
        signTransaction: async (tx: any) => tx,
        signAllTransactions: async (txs: any[]) => txs,
      };
      const program = getBoatProgram(connection, readWallet as any);
      const [configPda] = pdaElectionConfig(election);
      const config = await (program.account as any).electionConfig.fetch(configPda);
      quorumPct = Number(config.quorumPercentage);
    } catch {
      // keep default
    }
    const registeredWeight = rows.reduce((s, r) => s + r.weight, 0n);
    const tally = tallyFromRegistries(rows, registeredWeight, quorumPct);
    res.json({
      election: election.toBase58(),
      quorumPct,
      totalsByCandidate: Object.fromEntries(
        Object.entries(tally.totalsByCandidate).map(([k, v]) => [k, v.toString()])
      ),
      votedWeight: tally.votedWeight.toString(),
      registeredWeight: tally.registeredWeight.toString(),
      quorumMet: tally.quorumMet,
      participationPct: tally.participationPct,
      voters: rows.map((r) => ({
        voter: r.voter.toBase58(),
        weight: r.weight.toString(),
        hasVoted: r.hasVoted,
        currentVote: r.currentVote,
      })),
    });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/tx/initialize-election", async (req, res) => {
  try {
    const { buildInitializeElectionIx } = await boat();
    const { authority, title, startTime, endTime } = req.body ?? {};
    if (!authority || !title || startTime == null || endTime == null) {
      return res.status(400).json({ error: "authority, title, startTime, endTime required" });
    }
    const auth = new PublicKey(authority);
    const built = await buildInitializeElectionIx(connection, auth, {
      title,
      startTime: Number(startTime),
      endTime: Number(endTime),
    });
    const serialized = built.transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");
    res.json({
      transactionBase64: serialized,
      election: built.election.toBase58(),
      electionConfig: built.electionConfig.toBase58(),
      sbtMint: built.sbtMint.toBase58(),
    });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

console.log(`BOAT API listening on http://localhost:${PORT}`);
console.log(`RPC ${RPC}`);
app.listen(PORT, () => {
  console.log("ready");
});
