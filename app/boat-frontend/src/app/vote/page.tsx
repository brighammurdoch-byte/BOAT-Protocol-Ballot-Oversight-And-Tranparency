"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import {
  castVote,
  explorerTxUrl,
  fetchElection,
  fetchOutcomes,
} from "@boat/sdk";

export default function VotePage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [electionStr, setElectionStr] = useState("");
  const [outcomes, setOutcomes] = useState<{ index: number; label: string }[]>(
    []
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [receipt, setReceipt] = useState("");
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
      if (!election || !wallet.publicKey) {
        throw new Error("Connect wallet and paste a valid election PDA.");
      }
      const { election: e } = await fetchElection(
        connection,
        election,
        wallet as any
      );
      const list = await fetchOutcomes(
        connection,
        election,
        Number(e.outcomeCount),
        wallet as any
      );
      setOutcomes(list.map((o) => ({ index: o.index, label: o.label })));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [connection, election, wallet]);

  const submit = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      if (!election || !wallet.publicKey || selected === null) {
        throw new Error("Select a candidate first.");
      }
      const res = await castVote(
        connection,
        wallet as any,
        election,
        selected,
        wallet.publicKey
      );
      setReceipt(explorerTxUrl(res.signature, "devnet"));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [connection, election, selected, wallet]);

  return (
    <main className="min-h-screen px-6 py-10 max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <Link href="/" className="text-teal-800 text-sm">
          ← BOAT
        </Link>
        <WalletMultiButton />
      </div>
      <h1 className="text-3xl font-semibold">Vote</h1>
      <p className="text-stone-600 mt-2 mb-8">
        Voting is only allowed after the election start time and if your wallet
        was registered by the election authority.
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
        className="bg-teal-800 text-white px-4 py-2 disabled:opacity-40 mb-8"
      >
        Load candidates
      </button>

      {outcomes.length > 0 && (
        <ul className="space-y-2 mb-6">
          {outcomes.map((o) => (
            <li key={o.index}>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="candidate"
                  checked={selected === o.index}
                  onChange={() => setSelected(o.index)}
                />
                <span>
                  {o.index}. {o.label}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <button
        disabled={busy || selected === null}
        onClick={submit}
        className="bg-stone-900 text-white px-4 py-2 disabled:opacity-40"
      >
        Cast / change vote
      </button>

      {err && <p className="text-red-700 mt-4">{err}</p>}
      {receipt && (
        <p className="mt-4 text-sm">
          Receipt:{" "}
          <a className="text-teal-800 underline" href={receipt} target="_blank" rel="noreferrer">
            {receipt}
          </a>
        </p>
      )}
    </main>
  );
}
