"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import {
  initializeElection,
  addOutcome,
  registerVoter,
  explorerTxUrl,
} from "@boat/sdk";

export default function AdminPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [title, setTitle] = useState("USU Officers Election");
  const [startInMin, setStartInMin] = useState(5);
  const [durationHours, setDurationHours] = useState(24);
  const [candidates, setCandidates] = useState("Alice\nBob\nCarol");
  const [voters, setVoters] = useState("");
  const [electionPda, setElectionPda] = useState("");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canWrite = useMemo(
    () => Boolean(wallet.publicKey && wallet.signTransaction),
    [wallet.publicKey, wallet.signTransaction]
  );

  const append = (line: string) => setLog((prev) => `${prev}${line}\n`);

  const onCreate = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new Error("Connect a wallet first.");
      }
      const now = Math.floor(Date.now() / 1000);
      const startTime = now + Math.max(1, startInMin) * 60;
      const endTime = startTime + Math.max(1, durationHours) * 3600;
      const res = await initializeElection(connection, wallet as any, {
        title: title.trim(),
        startTime,
        endTime,
      });
      setElectionPda(res.election.toBase58());
      append(`Created election ${res.election.toBase58()}`);
      append(`Tx: ${explorerTxUrl(res.signature, "devnet")}`);

      const labels = candidates
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const [i, label] of labels.entries()) {
        const o = await addOutcome(connection, wallet as any, res.election, label, i);
        append(`Added outcome ${i}: ${label} (${o.signature})`);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRegister = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new Error("Connect a wallet first.");
      }
      if (!electionPda.trim()) throw new Error("Election PDA required.");
      const election = new PublicKey(electionPda.trim());
      const keys = voters
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const k of keys) {
        const voter = new PublicKey(k);
        const r = await registerVoter(connection, wallet as any, election, voter, 1n);
        append(`Registered ${k} — ${explorerTxUrl(r.signature, "devnet")}`);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen px-6 py-10 max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <Link href="/" className="text-teal-800 text-sm">
          ← BOAT
        </Link>
        <WalletMultiButton />
      </div>
      <h1 className="text-3xl font-semibold">Admin</h1>
      <p className="text-stone-600 mt-2 mb-8">
        Start time defaults to several minutes in the future so you can add
        candidates before voting opens.
      </p>

      <section className="space-y-4 mb-10">
        <label className="block">
          <span className="text-sm text-stone-600">Title</span>
          <input
            className="mt-1 w-full border border-stone-300 bg-white/70 px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm text-stone-600">Start in (minutes)</span>
            <input
              type="number"
              className="mt-1 w-full border border-stone-300 bg-white/70 px-3 py-2"
              value={startInMin}
              onChange={(e) => setStartInMin(Number(e.target.value))}
            />
          </label>
          <label className="block">
            <span className="text-sm text-stone-600">Duration (hours)</span>
            <input
              type="number"
              className="mt-1 w-full border border-stone-300 bg-white/70 px-3 py-2"
              value={durationHours}
              onChange={(e) => setDurationHours(Number(e.target.value))}
            />
          </label>
        </div>
        <label className="block">
          <span className="text-sm text-stone-600">Candidates (one per line)</span>
          <textarea
            className="mt-1 w-full border border-stone-300 bg-white/70 px-3 py-2 min-h-28"
            value={candidates}
            onChange={(e) => setCandidates(e.target.value)}
          />
        </label>
        <button
          disabled={!canWrite || busy}
          onClick={onCreate}
          className="bg-teal-800 text-white px-4 py-2 disabled:opacity-40"
        >
          Create election + candidates
        </button>
      </section>

      <section className="space-y-4 mb-10">
        <label className="block">
          <span className="text-sm text-stone-600">Election PDA</span>
          <input
            className="mt-1 w-full border border-stone-300 bg-white/70 px-3 py-2 font-mono text-sm"
            value={electionPda}
            onChange={(e) => setElectionPda(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm text-stone-600">
            Voter pubkeys (comma, space, or newline separated)
          </span>
          <textarea
            className="mt-1 w-full border border-stone-300 bg-white/70 px-3 py-2 min-h-28 font-mono text-sm"
            value={voters}
            onChange={(e) => setVoters(e.target.value)}
          />
        </label>
        <button
          disabled={!canWrite || busy}
          onClick={onRegister}
          className="bg-stone-800 text-white px-4 py-2 disabled:opacity-40"
        >
          Register voters
        </button>
      </section>

      {err && <p className="text-red-700 mb-4">{err}</p>}
      {log && (
        <pre className="whitespace-pre-wrap text-sm bg-white/60 border border-stone-200 p-4 overflow-auto">
          {log}
        </pre>
      )}
    </main>
  );
}
