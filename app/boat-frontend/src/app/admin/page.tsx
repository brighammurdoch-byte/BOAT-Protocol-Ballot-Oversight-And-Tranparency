"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BoatWalletButton from "../../components/BoatWalletButton";
import { PublicKey } from "@solana/web3.js";
import {
  DEFAULT_BOAT_PROGRAM_ID,
  initializeElectionWithOutcomes,
  registerVoter,
  enablePrivateBallots,
  explorerTxUrl,
  computeElectionWindow,
  parseCandidateLabels,
  parseVoterKeys,
  pdaElection,
} from "@boat/sdk";
import {
  copyText,
  countdownLabel,
  durableConnection,
  durableWallet,
  explorerWalletUrl,
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

/**
 * Survives a React remount (wallet provider / Next client-page abort).
 * Module memory is per-tab — not sessionStorage — so overlapping QA tabs
 * do not overwrite each other's title.
 */
type AdminLive = {
  title: string;
  startInMin: number;
  durationHours: number;
  candidates: string;
  electionPda: string;
  log: string;
  err: string | null;
  busy: boolean;
  sending: boolean;
  checklist: Checklist;
};

function initialAdminLive(): AdminLive {
  return {
    title: "USU Officers Election",
    startInMin: 5,
    durationHours: 24,
    candidates: "Alice\nBob\nCarol",
    electionPda: "",
    log: "",
    err: null,
    busy: false,
    sending: false,
    checklist: { created: false, candidates: 0, registered: 0 },
  };
}

let adminLive = initialAdminLive();
const adminLiveListeners = new Set<() => void>();

function subscribeAdminLive(onStoreChange: () => void) {
  adminLiveListeners.add(onStoreChange);
  return () => adminLiveListeners.delete(onStoreChange);
}

function getAdminLive() {
  return adminLive;
}

function patchAdminLive(partial: Partial<AdminLive>) {
  adminLive = { ...adminLive, ...partial };
  adminLiveListeners.forEach((fn) => fn());
}

export default function AdminPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const live = useSyncExternalStore(subscribeAdminLive, getAdminLive, getAdminLive);
  const {
    title,
    startInMin,
    durationHours,
    candidates,
    electionPda,
    log,
    err,
    busy,
    checklist,
  } = live;
  const [voters, setVoters] = useState("");
  const [privateSecrets, setPrivateSecrets] = useState(
    "usu-zk-voter-0\nusu-zk-voter-1\nusu-zk-voter-2\nusu-zk-voter-3\nusu-zk-voter-4"
  );
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [programMissing, setProgramMissing] = useState(false);

  useEffect(() => {
    const fromQuery = readPdaQuery();
    if (fromQuery && !getAdminLive().electionPda) {
      patchAdminLive({ electionPda: fromQuery });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void connection.getAccountInfo(DEFAULT_BOAT_PROGRAM_ID).then(
      (info) => {
        if (!cancelled) setProgramMissing(!info);
      },
      () => {
        if (!cancelled) setProgramMissing(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [connection]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, []);

  const preview = useMemo(() => {
    const labels = parseCandidateLabels(candidates);
    return computeElectionWindow({
      startInMin,
      durationHours,
      nowMs: now ?? Date.now(),
      candidateCount: labels.length,
    });
  }, [startInMin, durationHours, now, candidates]);

  const canWrite = useMemo(
    () => Boolean(wallet.publicKey && wallet.signTransaction),
    [wallet.publicKey, wallet.signTransaction]
  );

  const append = (line: string) => {
    patchAdminLive({ log: `${getAdminLive().log}${line}\n` });
  };

  const onCreate = async () => {
    const current = getAdminLive();
    if (current.sending) return;
    patchAdminLive({ sending: true, busy: true, err: null });
    const conn = durableConnection(connection);
    try {
      const w = durableWallet(wallet);
      const labels = parseCandidateLabels(current.candidates);
      if (labels.length === 0) {
        throw new Error("Add at least one candidate (one per line).");
      }
      const { start: startTime, end: endTime } = computeElectionWindow({
        startInMin: current.startInMin,
        durationHours: current.durationHours,
        candidateCount: labels.length,
      });
      const res = await initializeElectionWithOutcomes(conn, w, {
        title: current.title.trim(),
        startTime,
        endTime,
        candidateLabels: labels,
      });
      const pda = res.election.toBase58();
      patchAdminLive({ electionPda: pda });
      if (res.reusedExisting) {
        append(`Election already existed ${pda} — added any missing candidates.`);
      } else {
        append(`Created election ${pda}`);
      }
      append(`Starts ${formatLocal(startTime)} — ${countdownLabel(startTime)}`);
      append(`Ends ${formatLocal(endTime)}`);
      for (const sig of res.signatures) {
        append(`Tx: ${explorerTxUrl(sig, "devnet")}`);
      }
      append(`Candidates on-chain: ${labels.join(", ")}`);
      patchAdminLive({
        checklist: {
          created: true,
          candidates: labels.length,
          registered: getAdminLive().checklist.registered,
          startTime,
          endTime,
        },
      });
    } catch (e: unknown) {
      // Show the error before any extra RPC. PR #5 awaited getAccountInfo
      // first; an abort/remount there swallowed the banner and reset the form.
      patchAdminLive({ err: friendlyError(e) });
      const titleNow = getAdminLive().title.trim();
      if (wallet.publicKey && titleNow) {
        try {
          const [pda] = pdaElection(wallet.publicKey, titleNow);
          const info = await conn.getAccountInfo(pda, "confirmed");
          if (info) patchAdminLive({ electionPda: pda.toBase58() });
        } catch {
          // Keep the create error; do not invent a PDA that is not on-chain.
        }
      }
    } finally {
      patchAdminLive({ sending: false, busy: false });
    }
  };

  const onRegister = async () => {
    const current = getAdminLive();
    if (current.sending) return;
    patchAdminLive({ sending: true, busy: true, err: null });
    try {
      const w = durableWallet(wallet);
      const conn = durableConnection(connection);
      if (!current.electionPda.trim()) throw new Error("Election PDA required.");
      const election = new PublicKey(current.electionPda.trim());
      const keys = parseVoterKeys(voters);
      if (keys.length === 0) throw new Error("Paste at least one voter pubkey.");
      let n = 0;
      for (const voter of keys) {
        const r = await registerVoter(conn, w, election, voter, BigInt(1));
        if (r.skipped) {
          append(`Already registered ${voter.toBase58()} — skipped extra prompt.`);
          continue;
        }
        append(`Registered ${voter.toBase58()}`);
        append(`  ${explorerTxUrl(r.signature, "devnet")}`);
        n += 1;
      }
      const c = getAdminLive().checklist;
      patchAdminLive({ checklist: { ...c, registered: c.registered + n } });
    } catch (e: unknown) {
      patchAdminLive({ err: friendlyError(e) });
    } finally {
      patchAdminLive({ sending: false, busy: false });
    }
  };

  const onEnablePrivate = async () => {
    patchAdminLive({ err: null, busy: true });
    try {
      const w = durableWallet(wallet);
      const conn = durableConnection(connection);
      const pda = getAdminLive().electionPda;
      if (!pda.trim()) throw new Error("Election PDA required.");
      const secrets = privateSecrets
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (secrets.length === 0) {
        throw new Error("Paste electorate secrets (one per line).");
      }
      const root = merkleRootFromSecrets(secrets);
      const election = new PublicKey(pda.trim());
      const r = await enablePrivateBallots(conn, w, election, root, true);
      append(`Private ballots enabled (dev_mode)`);
      append(`Merkle root committed; share the secret list with eligible voters.`);
      append(`  ${explorerTxUrl(r.signature, "devnet")}`);
    } catch (e: unknown) {
      patchAdminLive({ err: friendlyError(e) });
    } finally {
      patchAdminLive({ busy: false });
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
        link. Phantom must be on <strong>Devnet</strong>.
      </p>

      {programMissing && (
        <p className="mb-6 text-sm text-red-800 bg-red-50 border border-red-200 px-3 py-2">
          The BOAT program is not on Solana Devnet (
          <a
            className="underline break-all"
            href={explorerWalletUrl(DEFAULT_BOAT_PROGRAM_ID.toBase58())}
            target="_blank"
            rel="noreferrer"
          >
            {DEFAULT_BOAT_PROGRAM_ID.toBase58()}
          </a>
          ). Phantom will fail simulation and nothing will land until this
          program is deployed.
        </p>
      )}

      {wallet.publicKey && (
        <p className="mb-6 text-sm text-stone-600">
          Connected wallet:{" "}
          <a
            className="text-teal-800 underline break-all"
            href={explorerWalletUrl(wallet.publicKey.toBase58())}
            target="_blank"
            rel="noreferrer"
          >
            View on Solana Explorer (Devnet)
          </a>
        </p>
      )}

      <div className="mb-8 text-sm text-stone-700 bg-white/50 border border-stone-200 px-4 py-3">
        {now == null ? (
          <p>Calculating election window…</p>
        ) : (
          <>
            <p>
              Planned window: <strong>{formatLocal(preview.start)}</strong> →{" "}
              <strong>{formatLocal(preview.end)}</strong>
            </p>
            <p className="mt-1 text-teal-900">{countdownLabel(preview.start, now)}</p>
          </>
        )}
      </div>

      <section className="space-y-4 mb-10">
        <label className="block">
          <span className="text-sm text-stone-600">Title</span>
          <input
            className="mt-1 w-full border border-stone-300 bg-white/70 px-3 py-2"
            value={title}
            onChange={(e) => patchAdminLive({ title: e.target.value })}
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm text-stone-600">Start in (minutes)</span>
            <input
              type="number"
              min={0}
              className="mt-1 w-full border border-stone-300 bg-white/70 px-3 py-2"
              value={startInMin}
              onChange={(e) => patchAdminLive({ startInMin: Number(e.target.value) })}
            />
            <span className="block mt-1 text-xs text-stone-500">
              0 still reserves ~10 min so create, candidates, and one retry can
              all land before voting opens.
            </span>
          </label>
          <label className="block">
            <span className="text-sm text-stone-600">Duration (hours)</span>
            <input
              type="number"
              className="mt-1 w-full border border-stone-300 bg-white/70 px-3 py-2"
              value={durationHours}
              onChange={(e) =>
                patchAdminLive({ durationHours: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <label className="block">
          <span className="text-sm text-stone-600">Candidates (one per line)</span>
          <textarea
            className="mt-1 w-full border border-stone-300 bg-white/70 px-3 py-2 min-h-28"
            value={candidates}
            onChange={(e) => patchAdminLive({ candidates: e.target.value })}
          />
        </label>
        <button
          type="button"
          disabled={busy || now == null}
          onClick={() => void onCreate()}
          className="bg-teal-800 text-white px-4 py-2 disabled:opacity-40"
        >
          {busy ? "Working…" : "Create election + candidates"}
        </button>
        <p className="text-xs text-stone-500">
          Two Phantom prompts: create the election, wait for confirm, then all
          candidates in one transaction.
        </p>
        {err ? (
          <p role="alert" className="text-red-700">
            {err}
          </p>
        ) : null}
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
            {checklist.startTime != null && now != null && (
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
            onChange={(e) => patchAdminLive({ electionPda: e.target.value })}
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
          type="button"
          disabled={!canWrite || busy}
          onClick={() => void onRegister()}
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
          type="button"
          disabled={!canWrite || busy || !electionPda}
          onClick={() => void onEnablePrivate()}
          className="bg-teal-900 text-white px-4 py-2 disabled:opacity-40"
        >
          Enable private ballots (dev)
        </button>
      </section>

      {err ? (
        <p role="alert" className="text-red-700 mb-4">
          {err}
        </p>
      ) : null}
      {log && (
        <pre className="whitespace-pre-wrap text-sm bg-white/60 border border-stone-200 p-4 overflow-auto">
          {log}
        </pre>
      )}
    </main>
  );
}
