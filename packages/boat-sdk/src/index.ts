import {
  PublicKey,
  type Connection,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  AnchorProvider,
  BorshAccountsCoder,
  Program,
  type Idl,
} from "@anchor-lang/core";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import boatIdl from "./idl/boat_final.json";
import { listForumPosts, publishForumPost } from "./nostr";
import { BOAT_ELECTION_TAG, DEFAULT_FORUM_RELAYS } from "./constants";

export const BOAT_IDL = boatIdl as unknown as Idl;
const PROGRAM_ADDRESS: string =
  (boatIdl as any).address ?? (boatIdl as any).metadata?.address;
export const DEFAULT_BOAT_PROGRAM_ID = new PublicKey(PROGRAM_ADDRESS);

export { BOAT_ELECTION_TAG, DEFAULT_FORUM_RELAYS, TOKEN_2022_PROGRAM_ID };

export const PDA_SEEDS = {
  election: "election",
  config: "config",
  mint: "mint",
  voterRegistry: "voter_registry",
  outcome: "outcome",
  private: "private",
  nullifier: "nullifier",
  privateTally: "private_tally",
} as const;

export type AnchorWalletLike = {
  publicKey: PublicKey;
  signTransaction: (tx: any) => Promise<any>;
  signAllTransactions: (txs: any[]) => Promise<any[]>;
};

export function getBoatProgram(
  connection: Connection,
  wallet: AnchorWalletLike,
  _programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const provider = new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });
  // Anchor 1.x: Program(idl, provider) — address comes from IDL
  return new Program(BOAT_IDL, provider);
}

export function pdaElection(
  authority: PublicKey,
  title: string,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(PDA_SEEDS.election),
      authority.toBuffer(),
      Buffer.from(title),
    ],
    programId
  );
}

export function pdaElectionConfig(
  election: PublicKey,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.config), election.toBuffer()],
    programId
  );
}

export function pdaSbtMint(
  election: PublicKey,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.mint), election.toBuffer()],
    programId
  );
}

export function pdaVoterRegistry(
  election: PublicKey,
  voter: PublicKey,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.voterRegistry), election.toBuffer(), voter.toBuffer()],
    programId
  );
}

export function pdaOutcome(
  election: PublicKey,
  outcomeIndex: number,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(PDA_SEEDS.outcome),
      election.toBuffer(),
      Buffer.from([outcomeIndex & 0xff]),
    ],
    programId
  );
}

export function pdaPrivateConfig(
  election: PublicKey,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.private), election.toBuffer()],
    programId
  );
}

export function pdaNullifier(
  election: PublicKey,
  nullifier: Uint8Array,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(PDA_SEEDS.nullifier),
      election.toBuffer(),
      Buffer.from(nullifier),
    ],
    programId
  );
}

export function pdaPrivateTally(
  election: PublicKey,
  outcomeIndex: number,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(PDA_SEEDS.privateTally),
      election.toBuffer(),
      Buffer.from([outcomeIndex & 0xff]),
    ],
    programId
  );
}

export type CreateElectionArgs = {
  title: string;
  startTime: number;
  endTime: number;
};

export async function initializeElection(
  connection: Connection,
  wallet: AnchorWalletLike,
  args: CreateElectionArgs,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, wallet, programId);
  const [election] = pdaElection(wallet.publicKey, args.title, programId);
  const [electionConfig] = pdaElectionConfig(election, programId);
  const [sbtMint] = pdaSbtMint(election, programId);

  const sig = await program.methods
    .initializeElection(args.title, new BN(args.startTime), new BN(args.endTime))
    .accounts({
      authority: wallet.publicKey,
      election,
      electionConfig,
      sbtMint,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    } as any)
    .rpc();

  return { signature: sig, election, electionConfig, sbtMint };
}

export async function addOutcome(
  connection: Connection,
  wallet: AnchorWalletLike,
  election: PublicKey,
  label: string,
  outcomeIndex: number,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, wallet, programId);
  const [outcome] = pdaOutcome(election, outcomeIndex, programId);
  const sig = await program.methods
    .addOutcome(label, outcomeIndex)
    .accounts({
      authority: wallet.publicKey,
      election,
      outcome,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
  return { signature: sig, outcome };
}

export async function setElectionConfig(
  connection: Connection,
  wallet: AnchorWalletLike,
  election: PublicKey,
  params: {
    defaultVoterWeight: bigint;
    quorumPercentage: number;
    maxFreeVoteChanges: number;
    pricePerVoteChange: bigint;
    allowDelegation: boolean;
  },
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, wallet, programId);
  const [electionConfig] = pdaElectionConfig(election, programId);
  const sig = await program.methods
    .setElectionConfig(
      new BN(params.defaultVoterWeight.toString()),
      params.quorumPercentage,
      params.maxFreeVoteChanges,
      new BN(params.pricePerVoteChange.toString()),
      params.allowDelegation
    )
    .accounts({
      authority: wallet.publicKey,
      election,
      electionConfig,
    } as any)
    .rpc();
  return { signature: sig };
}

export async function castVote(
  connection: Connection,
  wallet: AnchorWalletLike,
  election: PublicKey,
  outcomeIndex: number,
  feeReceiver: PublicKey,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, wallet, programId);
  const [electionConfig] = pdaElectionConfig(election, programId);
  const [sbtMint] = pdaSbtMint(election, programId);
  const [voterRegistry] = pdaVoterRegistry(election, wallet.publicKey, programId);
  const [outcome] = pdaOutcome(election, outcomeIndex, programId);

  const voterTokenAccount = await getAssociatedTokenAddress(
    sbtMint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const sig = await program.methods
    .castVote(outcomeIndex)
    .accounts({
      voter: wallet.publicKey,
      feeReceiver,
      election,
      electionConfig,
      privateConfig: null,
      sbtMint,
      voterRegistry,
      voterTokenAccount,
      outcome,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();

  return { signature: sig };
}

export async function enablePrivateBallots(
  connection: Connection,
  wallet: AnchorWalletLike,
  election: PublicKey,
  eligibilityMerkleRoot: Uint8Array,
  devMode: boolean = true,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, wallet, programId);
  const [privateConfig] = pdaPrivateConfig(election, programId);
  const root = Array.from(eligibilityMerkleRoot);
  const sig = await program.methods
    .enablePrivateBallots(root, devMode)
    .accounts({
      authority: wallet.publicKey,
      election,
      privateConfig,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
  return { signature: sig, privateConfig };
}

export async function setEligibilityRoot(
  connection: Connection,
  wallet: AnchorWalletLike,
  election: PublicKey,
  eligibilityMerkleRoot: Uint8Array,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, wallet, programId);
  const [privateConfig] = pdaPrivateConfig(election, programId);
  const root = Array.from(eligibilityMerkleRoot);
  const sig = await program.methods
    .setEligibilityRoot(root)
    .accounts({
      authority: wallet.publicKey,
      election,
      privateConfig,
    } as any)
    .rpc();
  return { signature: sig };
}

export async function castVoteZk(
  connection: Connection,
  wallet: AnchorWalletLike,
  election: PublicKey,
  args: {
    outcomeIndex: number;
    nullifier: Uint8Array;
    proof: Uint8Array;
    publicInputs: Uint8Array[];
  },
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, wallet, programId);
  const [privateConfig] = pdaPrivateConfig(election, programId);
  const [nullifierRecord] = pdaNullifier(election, args.nullifier, programId);
  const [outcome] = pdaOutcome(election, args.outcomeIndex, programId);
  const [privateTally] = pdaPrivateTally(election, args.outcomeIndex, programId);

  const sig = await program.methods
    .castVoteZk(
      args.outcomeIndex,
      Array.from(args.nullifier),
      Buffer.from(args.proof),
      args.publicInputs.map((pi) => Array.from(pi))
    )
    .accounts({
      payer: wallet.publicKey,
      election,
      privateConfig,
      nullifierRecord,
      outcome,
      privateTally,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();

  return { signature: sig, nullifierRecord, privateTally };
}

export async function fetchPrivateConfig(
  connection: Connection,
  election: PublicKey,
  wallet: AnchorWalletLike,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, wallet, programId);
  const [privateConfig] = pdaPrivateConfig(election, programId);
  try {
    const data = await (program.account as any).privateBallotConfig.fetch(
      privateConfig
    );
    return { privateConfig, data };
  } catch {
    return { privateConfig, data: null };
  }
}

export async function fetchPrivateTallies(
  connection: Connection,
  election: PublicKey,
  outcomeCount: number,
  wallet: AnchorWalletLike,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, wallet, programId);
  const out: { index: number; weight: bigint; pubkey: PublicKey }[] = [];
  for (let i = 0; i < outcomeCount; i++) {
    const [pubkey] = pdaPrivateTally(election, i, programId);
    try {
      const data = await (program.account as any).privateOutcomeTally.fetch(pubkey);
      out.push({
        index: Number(data.outcomeIndex ?? data.outcome_index ?? i),
        weight: bnToBigInt(data.weight),
        pubkey,
      });
    } catch {
      out.push({ index: i, weight: 0n, pubkey });
    }
  }
  return out;
}

export async function registerVoter(
  connection: Connection,
  authorityWallet: AnchorWalletLike,
  election: PublicKey,
  voter: PublicKey,
  weight: bigint,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, authorityWallet, programId);
  const [electionConfig] = pdaElectionConfig(election, programId);
  const [sbtMint] = pdaSbtMint(election, programId);
  const [voterRegistry] = pdaVoterRegistry(election, voter, programId);
  const voterTokenAccount = await getAssociatedTokenAddress(
    sbtMint,
    voter,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const sig = await program.methods
    .registerVoter(new BN(weight.toString()))
    .accounts({
      authority: authorityWallet.publicKey,
      election,
      electionConfig,
      sbtMint,
      voter,
      voterRegistry,
      voterTokenAccount,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    } as any)
    .rpc();

  return { signature: sig, voterRegistry, voterTokenAccount };
}

export async function fetchElection(
  connection: Connection,
  election: PublicKey,
  wallet: AnchorWalletLike,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, wallet, programId);
  const data = await (program.account as any).election.fetch(election);
  const [configPda] = pdaElectionConfig(election, programId);
  const config = await (program.account as any).electionConfig.fetch(configPda);
  return { election: data, config, configPda };
}

export async function fetchOutcomes(
  connection: Connection,
  election: PublicKey,
  outcomeCount: number,
  wallet: AnchorWalletLike,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, wallet, programId);
  const out: { index: number; label: string; pubkey: PublicKey }[] = [];
  for (let i = 0; i < outcomeCount; i++) {
    const [pubkey] = pdaOutcome(election, i, programId);
    const data = await (program.account as any).electionOutcome.fetch(pubkey);
    out.push({ index: data.index, label: data.label, pubkey });
  }
  return out;
}

/** Build unsigned initialize_election instruction (for API / wallet signing). */
export async function buildInitializeElectionIx(
  connection: Connection,
  authority: PublicKey,
  args: CreateElectionArgs,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
): Promise<{
  transaction: Transaction;
  election: PublicKey;
  electionConfig: PublicKey;
  sbtMint: PublicKey;
}> {
  const dummyWallet: AnchorWalletLike = {
    publicKey: authority,
    signTransaction: async (tx) => tx,
    signAllTransactions: async (txs) => txs,
  };
  const program = getBoatProgram(connection, dummyWallet, programId);
  const [election] = pdaElection(authority, args.title, programId);
  const [electionConfig] = pdaElectionConfig(election, programId);
  const [sbtMint] = pdaSbtMint(election, programId);
  const ix = await program.methods
    .initializeElection(args.title, new BN(args.startTime), new BN(args.endTime))
    .accounts({
      authority,
      election,
      electionConfig,
      sbtMint,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    } as any)
    .instruction();
  const transaction = new Transaction().add(ix);
  transaction.feePayer = authority;
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  return { transaction, election, electionConfig, sbtMint };
}

export type VoterRegistryRow = {
  election: PublicKey;
  voter: PublicKey;
  weight: bigint;
  isWhitelisted: boolean;
  hasVoted: boolean;
  currentVote: string | null;
  voteChangesUsed: number;
  delegatedTo: PublicKey | null;
};

export async function fetchVoterRegistriesForElection(
  connection: Connection,
  programId: PublicKey,
  election: PublicKey
): Promise<VoterRegistryRow[]> {
  const coder = new BorshAccountsCoder(BOAT_IDL);
  // Anchor account discriminators (from IDL) — required because ElectionConfig /
  // ElectionOutcome also store `election` at offset 8.
  const VOTER_REGISTRY_DISC = Buffer.from([146, 143, 24, 89, 70, 216, 173, 189]);
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [{ memcmp: { offset: 8, bytes: election.toBase58() } }],
  });

  const rows: VoterRegistryRow[] = [];
  for (const a of accounts) {
    const raw = a.account.data as Buffer | Uint8Array;
    const buf = Buffer.from(raw);
    if (buf.length < 8 || !buf.subarray(0, 8).equals(VOTER_REGISTRY_DISC)) continue;
    try {
      let decoded: any;
      try {
        decoded = coder.decode("voterRegistry", buf);
      } catch {
        decoded = coder.decode("VoterRegistry", buf);
      }
      rows.push({
        election: decoded.election as PublicKey,
        voter: decoded.voter as PublicKey,
        weight: bnToBigInt(decoded.weight),
        isWhitelisted: Boolean(decoded.isWhitelisted ?? decoded.is_whitelisted),
        hasVoted: Boolean(decoded.hasVoted ?? decoded.has_voted),
        currentVote: decoded.currentVote ?? decoded.current_vote ?? null,
        voteChangesUsed: Number(
          decoded.voteChangesUsed ?? decoded.vote_changes_used ?? 0
        ),
        delegatedTo: decoded.delegatedTo ?? decoded.delegated_to ?? null,
      });
    } catch {
      // ignore
    }
  }
  return rows;
}

export type TallyResult = {
  totalsByCandidate: Record<string, bigint>;
  votedWeight: bigint;
  registeredWeight: bigint;
  quorumMet: boolean;
  participationPct: number;
};

export function tallyFromRegistries(
  rows: Pick<VoterRegistryRow, "weight" | "hasVoted" | "currentVote">[],
  registeredWeight: bigint,
  quorumPct: number
): TallyResult {
  const totalsByCandidate: Record<string, bigint> = {};
  let votedWeight = 0n;

  for (const r of rows) {
    if (!r.hasVoted) continue;
    votedWeight += r.weight;
    const key = r.currentVote ?? "UNKNOWN";
    totalsByCandidate[key] = (totalsByCandidate[key] ?? 0n) + r.weight;
  }

  const participationPct =
    registeredWeight === 0n
      ? 0
      : Number((votedWeight * 10_000n) / registeredWeight) / 100;
  const quorumMet = participationPct >= quorumPct;

  return {
    totalsByCandidate,
    votedWeight,
    registeredWeight,
    quorumMet,
    participationPct,
  };
}

export class NostrForumClient {
  private relays: string[];
  constructor(relays: string[] = DEFAULT_FORUM_RELAYS) {
    this.relays = relays;
  }

  async listPosts(electionBase58: string) {
    return await listForumPosts(this.relays, electionBase58);
  }

  async publish(secretKey: Uint8Array, electionBase58: string, body: string) {
    return await publishForumPost(this.relays, secretKey, electionBase58, body);
  }

  close() {
    // no-op
  }
}

function bnToBigInt(x: any): bigint {
  if (typeof x === "bigint") return x;
  if (typeof x === "number") return BigInt(x);
  if (typeof x === "string") return BigInt(x);
  if (x && typeof x.toString === "function") return BigInt(x.toString());
  throw new Error("Unsupported bigint-like value");
}

export function explorerTxUrl(signature: string, cluster: "devnet" | "localnet" | "mainnet-beta" = "devnet") {
  const clusterParam = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${clusterParam}`;
}

export function explorerAddressUrl(
  address: string,
  cluster: "devnet" | "localnet" | "mainnet-beta" = "devnet"
) {
  const clusterParam = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/address/${address}${clusterParam}`;
}

export type { TransactionInstruction };
