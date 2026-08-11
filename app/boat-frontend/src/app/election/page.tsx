"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import {
  DEFAULT_BOAT_PROGRAM_ID,
  fetchElection,
  fetchVoterRegistriesForElection,
  tallyFromRegistries,
} from "@boat/sdk";

export default function ElectionTallyPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [electionStr, setElectionStr] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const election = useMemo(() => {
    try {
      return electionStr.trim() ? new PublicKey(electionStr.trim()) : null;
    } catch {
      return null;
    }
  }, [electionStr]);

  const load = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      if (!election) throw new Error("Paste a valid election PDA.");
      const dummy = wallet.publicKey
        ? (wallet as any)
        : {
            publicKey: PublicKey.default,
            signTransaction: async (tx: any) => tx,
            signAllTransactions: async (txs: any) => txs,
          };
      let quorumPct = 33;
      try {
        const { config } = await fetchElection(connection, election, dummy);
        quorumPct = Number(config.quorumPercentage ?? 33);
      } catch {
        // config fetch optional if walletless RPC-only path struggles
      }
      const rows = await fetchVoterRegistriesForElection(
        connection,
        DEFAULT_BOAT_PROGRAM_ID,
        election
      );
      const totalW = rows.reduce((s, r) => s + r.weight, 0n);
      const tally = tallyFromRegistries(rows, totalW, quorumPct);
      const mine = wallet.publicKey
        ? rows.find((r) => r.voter.equals(wallet.publicKey!))
        : undefined;
      setText(
        JSON.stringify(
          {
            election: election.toBase58(),
            totalsByCandidate: Object.fromEntries(
              Object.entries(tally.totalsByCandidate).map(([k, v]) => [
                k,
                v.toString(),
              ])
            ),
            votedWeight: tally.votedWeight.toString(),
            registeredWeight: tally.registeredWeight.toString(),
            quorumPct,
            quorumMet: tally.quorumMet,
            participationPct: tally.participationPct,
            registeredVoters: rows.length,
            yourRegistry: mine
              ? {
                  hasVoted: mine.hasVoted,
                  currentVote: mine.currentVote,
                  weight: mine.weight.toString(),
                }
              : null,
          },
          null,
          2
        )
      );
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [connection, election, wallet]);

  return (
    <main className="min-h-screen px-6 py-10 max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <Link href="/" className="text-teal-800 text-sm">
          ← BOAT
        </Link>
        <WalletMultiButton />
      </div>
      <h1 className="text-3xl font-semibold">Public tally</h1>
      <p className="text-stone-600 mt-2 mb-8">
        Anyone can recompute results from on-chain voter registries — the
        answer to “was the count fair?”
      </p>
      <label className="block mb-4">
        <span className="text-sm text-stone-600">Election PDA</span>
        <input
          className="mt-1 w-full border border-stone-300 bg-white/70 px-3 py-2 font-mono text-sm"
          value={electionStr}
          onChange={(e) => setElectionStr(e.target.value)}
        />
      </label>
      <button
        disabled={busy}
        onClick={load}
        className="bg-teal-800 text-white px-4 py-2 disabled:opacity-40 mb-6"
      >
        Load tally
      </button>
      {err && <p className="text-red-700 mb-4">{err}</p>}
      {text && (
        <pre className="whitespace-pre-wrap text-sm bg-white/60 border border-stone-200 p-4 overflow-auto">
          {text}
        </pre>
      )}
    </main>
  );
}
