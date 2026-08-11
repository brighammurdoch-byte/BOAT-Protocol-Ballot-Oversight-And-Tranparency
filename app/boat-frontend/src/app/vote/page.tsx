"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BoatWalletButton from "../../components/BoatWalletButton";
import { PublicKey } from "@solana/web3.js";
import {
  castVote,
  castVoteZk,
  explorerTxUrl,
  fetchElection,
  fetchOutcomes,
  fetchPrivateConfig,
} from "@boat/sdk";
import {
  countdownLabel,
  formatLocal,
  friendlyError,
  readPdaQuery,
} from "../../lib/demo";
import { buildPrivateBallotPackage } from "../../lib/zkBallot";

export default function VotePage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [electionStr, setElectionStr] = useState("");
  const [outcomes, setOutcomes] = useState<{ index: number; label: string }[]>(
    []
  );
  const [windowInfo, setWindowInfo] = useState<{
    title: string;
    start: number;
    end: number;
  } | null>(null);
  const [privateMode, setPrivateMode] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [voterSecret, setVoterSecret] = useState("");
  const [electorateSecrets, setElectorateSecrets] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const fromQuery = readPdaQuery();
    if (fromQuery) setElectionStr(fromQuery);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
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
    setBusy(true);
    try {
      if (!election) {
        throw new Error("Paste a valid election PDA.");
      }
      if (!wallet.publicKey) {
        throw new Error("Connect a wallet first.");
      }
      const { election: e } = await fetchElection(
        connection,
        election,
        wallet as any
      );
      const start = Number(e.startTime ?? e.start_time);
      const end = Number(e.endTime ?? e.end_time);
      setWindowInfo({
        title: String(e.title),
        start,
        end,
      });
      const list = await fetchOutcomes(
        connection,
        election,
        Number(e.outcomeCount ?? e.outcome_count),
        wallet as any
      );
      setOutcomes(list.map((o) => ({ index: o.index, label: o.label })));
      const { data: priv } = await fetchPrivateConfig(
        connection,
        election,
        wallet as any
      );
      const enabled = Boolean(priv?.enabled);
      setPrivateMode(enabled);
      setDevMode(Boolean(priv?.devMode ?? priv?.dev_mode));
      if (Date.now() / 1000 < start) {
        setErr(
          `Voting has not opened yet. Opens ${formatLocal(start)} (${countdownLabel(start)}).`
        );
      }
    } catch (e: unknown) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }, [connection, election, wallet]);

  useEffect(() => {
    if (electionStr && wallet.publicKey) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.publicKey]);

  const submit = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      if (!election || !wallet.publicKey || selected === null) {
        throw new Error("Select a candidate first.");
      }
      if (privateMode) {
        if (!voterSecret.trim()) {
          throw new Error("Enter your voter secret for the private ballot.");
        }
        const secrets = electorateSecrets
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (secrets.length === 0) {
          throw new Error(
            "Paste the full electorate secret list (same order used when the Merkle root was committed)."
          );
        }
        if (!secrets.includes(voterSecret.trim())) {
          throw new Error("Your secret must appear in the electorate list.");
        }
        const pkg = buildPrivateBallotPackage({
          secret: voterSecret.trim(),
          electionPubkey: election.toBytes(),
          outcomeIndex: selected,
          electorateSecrets: secrets,
        });
        const res = await castVoteZk(connection, wallet as any, election, {
          outcomeIndex: selected,
          nullifier: pkg.nullifier,
          proof: pkg.proof,
          publicInputs: pkg.publicInputs,
        });
        setReceipt(explorerTxUrl(res.signature, "devnet"));
      } else {
        const res = await castVote(
          connection,
          wallet as any,
          election,
          selected,
          wallet.publicKey
        );
        setReceipt(explorerTxUrl(res.signature, "devnet"));
      }
    } catch (e: unknown) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }, [
    connection,
    election,
    selected,
    wallet,
    privateMode,
    voterSecret,
    electorateSecrets,
  ]);

  return (
    <main className="min-h-screen px-6 py-10 max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <Link href="/" className="text-teal-800 text-sm">
          ← BOAT
        </Link>
        <BoatWalletButton />
      </div>
      <h1 className="text-3xl font-semibold">Vote</h1>
      <p className="text-stone-600 mt-2 mb-8">
        {privateMode
          ? "Private ballot mode: your choice is not stored per-wallet; a nullifier prevents double voting."
          : "Voting is only allowed after the election start time and if your wallet was registered by the election authority."}
      </p>

      {privateMode && (
        <p className="mb-6 text-sm text-amber-900 bg-amber-50 border border-amber-200 px-3 py-2">
          Private mode{devMode ? " (dev proofs)" : ""}. Not coercion-resistant;
          not campus-production until audited.
        </p>
      )}

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
        {busy ? "Loading…" : "Load candidates"}
      </button>

      {windowInfo && (
        <div className="mb-6 text-sm border border-stone-200 bg-white/50 px-4 py-3">
          <p className="font-medium">{windowInfo.title}</p>
          <p className="text-stone-600 mt-1">
            {formatLocal(windowInfo.start)} → {formatLocal(windowInfo.end)}
          </p>
          <p className="text-teal-900 mt-1">
            {countdownLabel(windowInfo.start, now)}
          </p>
          {electionStr && (
            <Link
              href={`/election?pda=${electionStr}`}
              className="inline-block mt-2 text-teal-800 underline text-sm"
            >
              View public tally
            </Link>
          )}
        </div>
      )}

      {privateMode && (
        <div className="mb-6 space-y-4">
          <label className="block">
            <span className="text-sm text-stone-600">Your voter secret</span>
            <input
              className="mt-1 w-full border border-stone-300 bg-white/70 px-3 py-2 font-mono text-sm"
              value={voterSecret}
              onChange={(e) => setVoterSecret(e.target.value)}
              placeholder="usu-zk-voter-0"
            />
          </label>
          <label className="block">
            <span className="text-sm text-stone-600">
              Electorate secrets (one per line, same list as Merkle root)
            </span>
            <textarea
              className="mt-1 w-full border border-stone-300 bg-white/70 px-3 py-2 font-mono text-sm min-h-[100px]"
              value={electorateSecrets}
              onChange={(e) => setElectorateSecrets(e.target.value)}
            />
          </label>
        </div>
      )}

      {outcomes.length > 0 && (
        <ul className="space-y-2 mb-6">
          {outcomes.map((o) => (
            <li key={o.index}>
              <label className="flex items-center gap-3 cursor-pointer border border-transparent hover:border-stone-300 px-2 py-2">
                <input
                  type="radio"
                  name="candidate"
                  checked={selected === o.index}
                  onChange={() => setSelected(o.index)}
                />
                <span>{o.label}</span>
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
        {privateMode ? "Cast private ballot" : "Cast / change vote"}
      </button>

      {err && <p className="text-red-700 mt-4">{err}</p>}
      {receipt && (
        <p className="mt-4 text-sm">
          Receipt:{" "}
          <a
            className="text-teal-800 underline break-all"
            href={receipt}
            target="_blank"
            rel="noreferrer"
          >
            View on Solana Explorer
          </a>
        </p>
      )}
    </main>
  );
}
