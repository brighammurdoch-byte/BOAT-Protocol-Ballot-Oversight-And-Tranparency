"use client";

import { useCallback, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import {
  DEFAULT_BOAT_PROGRAM_ID,
  fetchVoterRegistriesForElection,
  tallyFromRegistries,
  NostrForumClient,
  DEFAULT_FORUM_RELAYS,
  BOAT_ELECTION_TAG,
} from "@boat/sdk";
import { generateSecretKey } from "nostr-tools";

export default function Home() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [electionStr, setElectionStr] = useState("");
  const [tallyText, setTallyText] = useState("");
  const [forumPosts, setForumPosts] = useState("");
  const [forumBody, setForumBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const electionKeyOrNull = useMemo(() => {
    const raw = electionStr.trim();
    if (!raw) return null;
    try {
      return new PublicKey(raw);
    } catch {
      return null;
    }
  }, [electionStr]);

  const myRowHint = useMemo(() => {
    if (!publicKey) return "";
    return `Connected wallet: ${publicKey.toBase58()}`;
  }, [publicKey]);

  const loadTally = useCallback(async () => {
    setErr(null);
    setTallyText("");
    setBusy(true);
    try {
      const election = electionKeyOrNull;
      if (!election) {
        throw new Error(
          "Paste a valid Election PDA (base58) first. It looks like a long string starting with a number or letter."
        );
      }
      const rows = await fetchVoterRegistriesForElection(
        connection,
        DEFAULT_BOAT_PROGRAM_ID,
        election
      );
      const quorumPct = 33;
      const totalW = rows.reduce((s, r) => s + r.weight, BigInt(0));
      const tally = tallyFromRegistries(rows, totalW, quorumPct);
      const mine = publicKey
        ? rows.find((r) => r.voter.equals(publicKey))
        : undefined;
      setTallyText(
        JSON.stringify(
          {
            totalsByCandidate: Object.fromEntries(
              Object.entries(tally.totalsByCandidate).map(([k, v]) => [
                k,
                v.toString(),
              ])
            ),
            votedWeight: tally.votedWeight.toString(),
            registeredWeight: tally.registeredWeight.toString(),
            quorumMet: tally.quorumMet,
            participationPct: tally.participationPct,
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
  }, [connection, electionStr, publicKey]);

  const loadForum = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      if (!electionKeyOrNull) {
        throw new Error("Paste a valid Election PDA before loading forum posts.");
      }
      const client = new NostrForumClient(DEFAULT_FORUM_RELAYS);
      const list = await client.listPosts(electionStr.trim());
      client.close();
      setForumPosts(JSON.stringify(list, null, 2));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [electionStr]);

  const postForum = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      if (!electionKeyOrNull) {
        throw new Error("Paste a valid Election PDA before publishing.");
      }
      if (!forumBody.trim()) {
        throw new Error("Type a message before publishing.");
      }
      const sk = generateSecretKey();
      const client = new NostrForumClient(DEFAULT_FORUM_RELAYS);
      await client.publish(sk, electionStr.trim(), forumBody);
      client.close();
      setForumBody("");
      await loadForum();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [electionStr, forumBody, loadForum]);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">BOAT</h1>
        <p className="text-sm text-slate-400">
          This is a static PWA. It does not use a BOAT server: your browser reads
          Solana RPC directly and computes results locally.
        </p>
      </header>

      <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
        <h2 className="text-sm font-semibold text-slate-100">Start here</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-300">
          <li>
            Click <span className="font-medium text-slate-100">Connect Wallet</span>.
          </li>
          <li>
            Paste the <span className="font-medium text-slate-100">Election PDA</span> (base58).
          </li>
          <li>
            Click <span className="font-medium text-slate-100">Load tally (local)</span> to compute results on-device.
          </li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">
          Tip: The Election PDA is the election account address (a long base58 string).
          If you just created an election, copy the election address from your script/CLI logs or Explorer.
        </p>
      </section>

      <WalletMultiButton className="!bg-blue-600" />

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-300">Election PDA (base58)</span>
        <input
          className="rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm"
          value={electionStr}
          onChange={(e) => setElectionStr(e.target.value)}
          placeholder="Example: 9kQq... (paste election address)"
        />
        <span className="text-xs text-slate-500">
          Program: <span className="font-mono">{DEFAULT_BOAT_PROGRAM_ID.toBase58()}</span>
        </span>
      </label>

      <button
        type="button"
        disabled={busy}
        onClick={loadTally}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {busy ? "Loading…" : "Load tally (local)"}
      </button>

      <div className="flex flex-col gap-1">
        {myRowHint ? <p className="text-xs text-slate-500">{myRowHint}</p> : null}
        {electionKeyOrNull ? (
          <p className="text-xs text-slate-500">
            Election: <span className="font-mono">{electionKeyOrNull.toBase58()}</span>
          </p>
        ) : electionStr.trim() ? (
          <p className="text-xs text-red-400">
            Election PDA doesn’t look valid. Double-check you pasted the full base58 address.
          </p>
        ) : null}
      </div>

      <details className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
        <summary className="cursor-pointer text-sm font-medium text-slate-200">
          What am I looking at? (tally + verification)
        </summary>
        <div className="mt-3 space-y-2 text-sm text-slate-300">
          <p>
            <span className="font-medium text-slate-100">Load tally</span> fetches voter registry accounts for this election and
            sums weights by the recorded <span className="font-mono">currentVote</span>.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-slate-300">
            <li>
              <span className="font-medium text-slate-100">No central server</span>: your browser talks to RPC and computes totals locally.
            </li>
            <li>
              <span className="font-medium text-slate-100">Your verification</span>: if your wallet is connected and registered, you’ll see your on-chain record in <span className="font-mono">yourRegistry</span>.
            </li>
            <li>
              <span className="font-medium text-slate-100">Limitations</span>: token-only voting (no registry account) isn’t included in this simple registry-based tally.
            </li>
          </ul>
        </div>
      </details>

      {tallyText ? (
        <pre className="overflow-x-auto rounded border border-slate-800 bg-slate-900 p-3 text-xs">
          {tallyText}
        </pre>
      ) : null}

      <section className="border-t border-slate-800 pt-4">
        <h2 className="mb-2 text-lg font-medium">Forum ({BOAT_ELECTION_TAG})</h2>
        <p className="mb-2 text-xs text-slate-500">
          This forum is stored on public Nostr relays (not the Solana program). It’s keyed by the Election PDA tag so each election has its own thread.
        </p>
        <details className="mb-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-300">
            Forum details (privacy + relays)
          </summary>
          <div className="mt-2 space-y-2 text-xs text-slate-400">
            <p>
              Relays: <span className="font-mono">{DEFAULT_FORUM_RELAYS.join(", ")}</span>
            </p>
            <p>
              Publishing uses a <span className="font-medium text-slate-200">new ephemeral Nostr key</span> each time in this demo.
              That means you can’t edit/delete old posts and you don’t build a consistent identity yet.
            </p>
            <p>
              Note: This does <span className="font-medium text-slate-200">not</span> make voting anonymous. Votes are still recorded on-chain by wallet in the current program.
            </p>
          </div>
        </details>
        <textarea
          className="mb-2 w-full rounded border border-slate-700 bg-slate-900 p-2 text-sm"
          rows={3}
          value={forumBody}
          onChange={(e) => setForumBody(e.target.value)}
          placeholder="Type a proposal or discussion message…"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={postForum}
            className="rounded-lg bg-slate-700 px-3 py-2 text-sm"
          >
            Publish message
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={loadForum}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm"
          >
            Refresh posts
          </button>
        </div>
        {forumPosts ? (
          <pre className="mt-2 max-h-64 overflow-auto rounded border border-slate-800 bg-slate-900 p-2 text-xs">
            {forumPosts}
          </pre>
        ) : null}
      </section>

      {err ? <p className="text-sm text-red-400">{err}</p> : null}
    </main>
  );
}
