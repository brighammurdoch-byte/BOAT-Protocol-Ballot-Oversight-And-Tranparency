import {
  PublicKey,
  type Connection,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  AnchorProvider,
  BN,
  BorshAccountsCoder,
  Program,
  type Idl,
} from "@coral-xyz/anchor";
import boatIdl from "./idl/boat_final.json";
import { listForumPosts, publishForumPost } from "./nostr";
import { BOAT_ELECTION_TAG, DEFAULT_FORUM_RELAYS } from "./constants";

export const BOAT_IDL = boatIdl as unknown as Idl;
const PROGRAM_ADDRESS: string =
  (boatIdl as any).metadata?.address ?? (boatIdl as any).address;
export const DEFAULT_BOAT_PROGRAM_ID = new PublicKey(PROGRAM_ADDRESS);

export { BOAT_ELECTION_TAG, DEFAULT_FORUM_RELAYS };

export const PDA_SEEDS = {
  election: "election",
  config: "config",
  mint: "mint",
  voterRegistry: "voter_registry",
  outcome: "outcome",
} as const;

export type AnchorWalletLike = {
  publicKey: PublicKey;
  signTransaction: (tx: any) => Promise<any>;
  signAllTransactions: (txs: any[]) => Promise<any[]>;
};

export function getBoatProgram(
  connection: Connection,
  wallet: AnchorWalletLike,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const provider = new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });
  return new Program(BOAT_IDL, programId, provider);
}

export function pdaElection(authority: PublicKey, title: string) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(PDA_SEEDS.election),
      authority.toBuffer(),
      Buffer.from(title),
    ],
    DEFAULT_BOAT_PROGRAM_ID
  );
}

export function pdaElectionConfig(election: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.config), election.toBuffer()],
    DEFAULT_BOAT_PROGRAM_ID
  );
}

export function pdaSbtMint(election: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.mint), election.toBuffer()],
    DEFAULT_BOAT_PROGRAM_ID
  );
}

export function pdaVoterRegistry(election: PublicKey, voter: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.voterRegistry), election.toBuffer(), voter.toBuffer()],
    DEFAULT_BOAT_PROGRAM_ID
  );
}

export function pdaOutcome(election: PublicKey, outcomeIndex: number) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(PDA_SEEDS.outcome),
      election.toBuffer(),
      Buffer.from([outcomeIndex & 0xff]),
    ],
    DEFAULT_BOAT_PROGRAM_ID
  );
}

export type CreateElectionArgs = {
  title: string;
  startTime: number; // unix seconds
  endTime: number; // unix seconds
};

export async function initializeElection(
  connection: Connection,
  wallet: AnchorWalletLike,
  args: CreateElectionArgs,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, wallet, programId);
  const [election] = pdaElection(wallet.publicKey, args.title);
  const [electionConfig] = pdaElectionConfig(election);
  const [sbtMint] = pdaSbtMint(election);

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
  const [outcome] = pdaOutcome(election, outcomeIndex);
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
  const [electionConfig] = pdaElectionConfig(election);
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

export async function setRegistrationPolicy(
  connection: Connection,
  wallet: AnchorWalletLike,
  election: PublicKey,
  params: {
    registrationMode: number;
    merkleRoot: Uint8Array; // 32
    registrationEndTs: number;
    maxRegisteredVoters: number;
    registrationFeeLamports: bigint;
  },
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, wallet, programId);
  const [electionConfig] = pdaElectionConfig(election);
  const rootArr = Array.from(params.merkleRoot);
  if (rootArr.length !== 32) throw new Error("Merkle root must be 32 bytes.");
  const sig = await program.methods
    .setRegistrationPolicy(
      params.registrationMode,
      rootArr,
      new BN(params.registrationEndTs),
      params.maxRegisteredVoters,
      new BN(params.registrationFeeLamports.toString())
    )
    .accounts({
      authority: wallet.publicKey,
      election,
      electionConfig,
    } as any)
    .rpc();
  return { signature: sig };
}

export async function delegateVote(
  connection: Connection,
  wallet: AnchorWalletLike,
  election: PublicKey,
  delegate: PublicKey,
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, wallet, programId);
  const [electionConfig] = pdaElectionConfig(election);
  const [voterRegistry] = pdaVoterRegistry(election, wallet.publicKey);
  const [delegateRegistry] = pdaVoterRegistry(election, delegate);
  const sig = await program.methods
    .delegateVote()
    .accounts({
      voter: wallet.publicKey,
      election,
      electionConfig,
      voterRegistry,
      delegateRegistry,
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
  const [electionConfig] = pdaElectionConfig(election);
  const [sbtMint] = pdaSbtMint(election);
  const [voterRegistry] = pdaVoterRegistry(election, wallet.publicKey);
  const [outcome] = pdaOutcome(election, outcomeIndex);

  // Associated token account for token-2022: we still can derive it client-side
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

export async function registerVoterSponsored(
  connection: Connection,
  authorityWallet: AnchorWalletLike,
  voterWallet: AnchorWalletLike,
  election: PublicKey,
  merkleProof: Uint8Array[], // each 32 bytes
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, authorityWallet, programId);
  const [electionConfig] = pdaElectionConfig(election);
  const [sbtMint] = pdaSbtMint(election);
  const [voterRegistry] = pdaVoterRegistry(election, voterWallet.publicKey);
  const voterTokenAccount = await getAssociatedTokenAddress(
    sbtMint,
    voterWallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const proof = merkleProof.map((p) => {
    const a = Array.from(p);
    if (a.length !== 32) throw new Error("Each merkle proof node must be 32 bytes.");
    return a;
  });

  // This requires both authority + voter signers. Anchor supports extra signers via provider wallet only,
  // so for mobile we will submit via a single combined transaction in the app (UI layer).
  // Here we only build the instruction.
  const ix = await program.methods
    .registerVoterSponsored(proof)
    .accounts({
      authority: authorityWallet.publicKey,
      voter: voterWallet.publicKey,
      election,
      electionConfig,
      sbtMint,
      voterRegistry,
      voterTokenAccount,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    } as any)
    .instruction();

  return { instruction: ix, voterRegistry, voterTokenAccount };
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
  const [electionConfig] = pdaElectionConfig(election);
  const [sbtMint] = pdaSbtMint(election);
  const [voterRegistry] = pdaVoterRegistry(election, voter);
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

export async function selfRegisterVoter(
  connection: Connection,
  wallet: AnchorWalletLike,
  election: PublicKey,
  merkleProof: Uint8Array[] = [],
  programId: PublicKey = DEFAULT_BOAT_PROGRAM_ID
) {
  const program = getBoatProgram(connection, wallet, programId);
  const [electionConfig] = pdaElectionConfig(election);
  const [sbtMint] = pdaSbtMint(election);
  const [voterRegistry] = pdaVoterRegistry(election, wallet.publicKey);
  const voterTokenAccount = await getAssociatedTokenAddress(
    sbtMint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const proof = merkleProof.map((p) => {
    const a = Array.from(p);
    if (a.length !== 32) throw new Error("Each merkle proof node must be 32 bytes.");
    return a;
  });

  const sig = await program.methods
    .registerVoterSponsored(proof)
    .accounts({
      authority: wallet.publicKey,
      voter: wallet.publicKey,
      election,
      electionConfig,
      sbtMint,
      voterRegistry,
      voterTokenAccount,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    } as any)
    .rpc();

  return { signature: sig, voterRegistry, voterTokenAccount };
}

// ---- Token program ids / helpers (token-2022) ----
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
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
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      // Anchor account discriminator is 8 bytes; election pubkey is first field in VoterRegistry
      { memcmp: { offset: 8, bytes: election.toBase58() } },
    ],
  });

  const rows: VoterRegistryRow[] = [];
  for (const a of accounts) {
    try {
      const decoded = coder.decode("VoterRegistry", a.account.data) as any;
      rows.push({
        election: decoded.election as PublicKey,
        voter: decoded.voter as PublicKey,
        weight: bnToBigInt(decoded.weight),
        isWhitelisted: Boolean(decoded.isWhitelisted),
        hasVoted: Boolean(decoded.hasVoted),
        currentVote: decoded.currentVote ?? null,
        voteChangesUsed: Number(decoded.voteChangesUsed ?? 0),
        delegatedTo: decoded.delegatedTo ?? null,
      });
    } catch {
      // Ignore non-matching accounts in the program.
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
    // no-op: our nostr helpers use one-shot connections
  }
}

function bnToBigInt(x: any): bigint {
  if (typeof x === "bigint") return x;
  if (typeof x === "number") return BigInt(x);
  if (typeof x === "string") return BigInt(x);
  if (x && typeof x.toString === "function") return BigInt(x.toString());
  throw new Error("Unsupported bigint-like value");
}

