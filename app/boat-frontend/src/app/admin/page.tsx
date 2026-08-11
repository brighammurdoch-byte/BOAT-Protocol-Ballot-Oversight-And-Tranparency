"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BoatWalletButton from "../../components/BoatWalletButton";
import { PublicKey } from "@solana/web3.js";
import {
  initializeElection,
  addOutcome,
  registerVoter,
  enablePrivateBallots,
  explorerTxUrl,
} from "@boat/sdk";
import {
  copyText,
  countdownLabel,
  formatLocal,
  friendlyError,
  readPdaQuery,
} from "../../lib/demo";
import { merkleRootFromSecrets } from "../../lib/zkBallot";

type Checklist = {
  created: boolean;
  candidates: number;
  registered: number;
  startTime?: number;
  endTime?: number;
};

export default function AdminPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [title, setTitle] = useState("USU Officers Election");
  const [startInMin, setStartInMin] = useState(5);
  const [durationHours, setDurationHours] = useState(24);
  const [candidates, setCandidates] = useState("Alice\nBob\nCarol");
  const [voters, setVoters] = useState("");
  const [electionPda, setElectionPda] = useState("");
  const [privateSecrets, setPrivateSecrets] = useState(
    "usu-zk-voter-0\nusu-zk-voter-1\nusu-zk-voter-2\nusu-zk-voter-3\nusu-zk-voter-4"
  );
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [checklist, setChecklist] = useState<Checklist>({
    created: false,
    candidates: 0,
    registered: 0,
  });
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const fromQuery = readPdaQuery();
    if (fromQuery) setElectionPda(fromQuery);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const preview = useMemo(() => {
    const start = Math.floor(Date.now() / 1000) + Math.max(1, startInMin) * 60;
    const end = start + Math.max(1, durationHours) * 3600;
    return { start, end };
  }, [startInMin, durationHours, now]);

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
      const startTime = preview.start;
      const endTime = preview.end;
      const res = await initializeElection(connection, wallet as any, {
        title: title.trim(),
        startTime,
        endTime,
      });
      const pda = res.election.toBase58();
      setElectionPda(pda);
      append(`Created election ${pda}`);
      append(`Starts ${formatLocal(startTime)} — ${countdownLabel(startTime)}`);
      append(`Ends ${formatLocal(endTime)}`);
      append(`Tx: ${explorerTxUrl(res.signature, "devnet")}`);

      const labels = candidates
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const [i, label] of labels.entries()) {
        const o = await addOutcome(connection, wallet as any, res.election, label, i);
        append(`Added candidate ${i}: ${label}`);
        append(`  ${explorerTxUrl(o.signature, "devnet")}`);
      }
      setChecklist({
        created: true,
        candidates: labels.length,
        registered: 0,
        startTime,
        endTime,
      });
    } catch (e: unknown) {
      setErr(friendlyError(e));
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
      if (keys.length === 0) throw new Error("Paste at least one voter pubkey.");
      let n = 0;
      for (const k of keys) {
        const voter = new PublicKey(k);
        const r = await registerVoter(
          connection,
          wallet as any,
          election,
          voter,
          BigInt(1)
        );
        append(`Registered ${k}`);
        append(`  ${explorerTxUrl(r.signature, "devnet")}`);
        n += 1;
      }
      setChecklist((c) => ({ ...c, registered: c.registered + n }));
    } catch (e: unknown) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const onEnablePrivate = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new Error("Connect a wallet first.");
      }
      if (!electionPda.trim()) throw new Error("Election PDA required.");
      const secrets = privateSecrets
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (secrets.length === 0) {
        throw new Error("Paste electorate secrets (one per line).");
      }
      const root = merkleRootFromSecrets(secrets);
      const election = new PublicKey(electionPda.trim());
      const r = await enablePrivateBallots(
        connection,
        wallet as any,
        election,
        root,
        true
      );
      append(`Private ballots enabled (dev_mode)`);
      append(`Merkle root committed; share the secret list with eligible voters.`);
      append(`  ${explorerTxUrl(r.signature, "devnet")}`);
    } catch (e: unknown) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const onCopyPda = async () => {
    if (!electionPda) return;
    const ok = await copyText(electionPda);
    setCopied(ok);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="min-h-screen px-6 py-10 max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <Link href="/" className="text-teal-800 text-sm">
          ← BOAT
        </Link>
        <BoatWalletButton />
      </div>
      <h1 className="text-3xl font-semibold">Admin</h1>
      <p className="text-stone-600 mt-2 mb-6">
        Create the election with a future start so candidates can be added
        before voting opens. Then register voter wallets and share the election
        link.
      </p>

      <div className="mb-8 text-sm text-stone-700 bg-white/50 border border-stone-200 px-4 py-3">
        <p>
          Planned window: <strong>{formatLocal(preview.start)}</strong> →{" "}
          <strong>{formatLocal(preview.end)}</strong>
        </p>
        <p className="mt-1 text-teal-900">{countdownLabel(preview.start, now)}</p>
      </div>

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
          {busy ? "Working…" : "Create election + candidates"}
        </button>
      </section>

      {(checklist.created || electionPda) && (
        <section className="mb-10 border border-stone-300 bg-white/60 px-4 py-4 space-y-3">
          <h2 className="font-medium text-lg">Share & checklist</h2>
          <ul className="text-sm text-stone-700 space-y-1">
            <li>{checklist.created ? "✓" : "○"} Election created</li>
            <li>
              {checklist.candidates > 0 ? "✓" : "○"} Candidates added (
              {checklist.candidates})
            </li>
            <li>
              {checklist.registered > 0 ? "✓" : "○"} Voters registered (
              {checklist.registered})
            </li>
            {checklist.startTime != null && (
              <li className="text-teal-900">
                {countdownLabel(checklist.startTime, now)} —{" "}
                {formatLocal(checklist.startTime)}
              </li>
            )}
          </ul>
          {electionPda && (
            <div className="space-y-2">
              <p className="text-xs text-stone-500 break-all font-mono">{electionPda}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onCopyPda}
                  className="border border-stone-400 px-3 py-1 text-sm"
                >
                  {copied ? "Copied" : "Copy PDA"}
                </button>
                <Link
                  href={`/vote?pda=${electionPda}`}
                  className="border border-teal-800 text-teal-900 px-3 py-1 text-sm"
                >
                  Open vote link
                </Link>
                <Link
                  href={`/election?pda=${electionPda}`}
                  className="border border-teal-800 text-teal-900 px-3 py-1 text-sm"
                >
                  Open tally link
                </Link>
              </div>
            </div>
          )}
        </section>
      )}

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
            placeholder="Paste Phantom addresses here"
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

      <section className="space-y-4 mb-10">
        <h2 className="font-medium text-lg">Optional: private ballots</h2>
        <p className="text-sm text-stone-600">
          Before voting starts, commit an eligibility Merkle root. Voters then
          use secrets (not wallet linkage) on the vote page. Dev proofs only —
          see docs/ZK_STATUS.md.
        </p>
        <label className="block">
          <span className="text-sm text-stone-600">
            Electorate secrets (one per line)
          </span>
          <textarea
            className="mt-1 w-full border border-stone-300 bg-white/70 px-3 py-2 min-h-28 font-mono text-sm"
            value={privateSecrets}
            onChange={(e) => setPrivateSecrets(e.target.value)}
          />
        </label>
        <button
          disabled={!canWrite || busy || !electionPda}
          onClick={onEnablePrivate}
          className="bg-teal-900 text-white px-4 py-2 disabled:opacity-40"
        >
          Enable private ballots (dev)
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
