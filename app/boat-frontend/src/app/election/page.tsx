"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BoatWalletButton from "../../components/BoatWalletButton";
import { PublicKey } from "@solana/web3.js";
import {
  DEFAULT_BOAT_PROGRAM_ID,
  fetchElection,
  fetchOutcomes,
  fetchPrivateConfig,
  fetchPrivateTallies,
  fetchVoterRegistriesForElection,
  tallyFromRegistries,
  totalsWithAllCandidates,
} from "@boat/sdk";
import { friendlyError, readPdaQuery } from "../../lib/demo";

type TallyView = {
  election: string;
  totals: { label: string; weight: bigint }[];
  votedWeight: bigint;
  registeredWeight: bigint;
  quorumPct: number;
  quorumMet: boolean;
  participationPct: number;
  registeredVoters: number;
  yourVote: string | null;
  privateMode: boolean;
};

export default function ElectionTallyPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [electionStr, setElectionStr] = useState("");
  const [view, setView] = useState<TallyView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const fromQuery = readPdaQuery();
    if (fromQuery) setElectionStr(fromQuery);
  }, []);

  const election = useMemo(() => {
    try {
      return electionStr.trim() ? new PublicKey(electionStr.trim()) : null;
    } catch {
      return null;
    }
  }, [electionStr]);

  const load = useCallback(async () => {
    setErr(null);
    setView(null);
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
      let outcomeCount = 0;
      try {
        const { election: e, config } = await fetchElection(
          connection,
          election,
          dummy
        );
        quorumPct = Number(
          config.quorumPercentage ?? config.quorum_percentage ?? 33
        );
        outcomeCount = Number(e.outcomeCount ?? e.outcome_count ?? 0);
      } catch {
        throw new Error(
          "Election or voter account not found on this cluster. Check the PDA and that you are on Solana Devnet."
        );
      }

      const { data: priv } = await fetchPrivateConfig(connection, election, dummy);
      if (priv?.enabled) {
        const outcomes = await fetchOutcomes(
          connection,
          election,
          outcomeCount,
          dummy
        );
        const tallies = await fetchPrivateTallies(
          connection,
          election,
          outcomeCount,
          dummy
        );
        const totals = outcomes
          .map((o) => {
            const t = tallies.find((x) => x.index === o.index);
            return { label: o.label, weight: t?.weight ?? 0n };
          })
          .sort((a, b) => (a.weight === b.weight ? 0 : a.weight > b.weight ? -1 : 1));
        const votedWeight = totals.reduce((s, t) => s + t.weight, 0n);
        setView({
          election: election.toBase58(),
          totals,
          votedWeight,
          registeredWeight: votedWeight,
          quorumPct,
          quorumMet: true,
          participationPct: 100,
          registeredVoters: Number(priv.privateVoteCount ?? priv.private_vote_count ?? 0),
          yourVote: null,
          privateMode: true,
        });
        return;
      }

      const rows = await fetchVoterRegistriesForElection(
        connection,
        DEFAULT_BOAT_PROGRAM_ID,
        election
      );
      const outcomes = await fetchOutcomes(
        connection,
        election,
        outcomeCount,
        dummy
      );
      const totalW = rows.reduce((s, r) => s + r.weight, 0n);
      const tally = tallyFromRegistries(rows, totalW, quorumPct);
      const mine = wallet.publicKey
        ? rows.find((r) => r.voter.equals(wallet.publicKey!))
        : undefined;
      const totals = totalsWithAllCandidates(
        tally.totalsByCandidate,
        outcomes.map((o) => o.label)
      );
      setView({
        election: election.toBase58(),
        totals,
        votedWeight: tally.votedWeight,
        registeredWeight: tally.registeredWeight,
        quorumPct,
        quorumMet: tally.quorumMet,
        participationPct: tally.participationPct,
        registeredVoters: rows.length,
        yourVote: mine?.hasVoted ? mine.currentVote : null,
        privateMode: false,
      });
    } catch (e: unknown) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }, [connection, election, wallet]);

  useEffect(() => {
    if (election) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [election]);

  const maxWeight = view?.totals[0]?.weight ?? 1n;

  return (
    <main className="min-h-screen px-6 py-10 max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <Link href="/" className="text-teal-800 text-sm">
          ← BOAT
        </Link>
        <BoatWalletButton />
      </div>
      <h1 className="text-3xl font-semibold">Public tally</h1>
      <p className="text-stone-600 mt-2 mb-8">
        {view?.privateMode
          ? "Private elections expose aggregate outcome counters only — no per-wallet choice."
          : "Anyone can recompute results from on-chain voter registries — the answer to “was the count fair?”"}
      </p>
      <label className="block mb-4">
        <span className="text-sm text-stone-600">Election PDA</span>
        <input
          className="mt-1 w-full border border-stone-300 bg-white/70 px-3 py-2 font-mono text-sm"
          value={electionStr}
          onChange={(e) => setElectionStr(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-3 mb-8">
        <button
          type="button"
          disabled={busy}
          onClick={() => void load()}
          className="bg-teal-800 text-white px-4 py-2 disabled:opacity-40"
        >
          {busy ? "Loading…" : "Load tally"}
        </button>
        {electionStr && (
          <Link
            href={`/vote?pda=${electionStr}`}
            className="border border-teal-800 text-teal-900 px-4 py-2 text-sm"
          >
            Go vote
          </Link>
        )}
      </div>
      {err && <p className="text-red-700 mb-4">{err}</p>}
      {view && (
        <section className="space-y-6">
          <div className="text-sm text-stone-600 space-y-1">
            <p>
              Registered voters: <strong>{view.registeredVoters}</strong>
            </p>
            <p>
              Voted weight / registered:{" "}
              <strong>
                {view.votedWeight.toString()} / {view.registeredWeight.toString()}
              </strong>{" "}
              ({view.participationPct.toFixed(1)}%)
            </p>
            <p>
              Quorum {view.quorumPct}%:{" "}
              <strong className={view.quorumMet ? "text-teal-900" : "text-amber-800"}>
                {view.quorumMet ? "met" : "not met"}
              </strong>
            </p>
            {view.yourVote && (
              <p>
                Your ballot: <strong>{view.yourVote}</strong>
              </p>
            )}
          </div>

          <ul className="space-y-4">
            {view.totals.length === 0 && (
              <li className="text-stone-500 text-sm">No votes recorded yet.</li>
            )}
            {view.totals.map((row) => {
              const pct =
                maxWeight === 0n
                  ? 0
                  : Number((row.weight * 10000n) / maxWeight) / 100;
              return (
                <li key={row.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{row.label}</span>
                    <span className="tabular-nums">{row.weight.toString()}</span>
                  </div>
                  <div className="h-2 bg-stone-200 overflow-hidden">
                    <div
                      className="h-full bg-teal-800"
                      style={{ width: `${Math.max(pct, row.weight > 0n ? 4 : 0)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
