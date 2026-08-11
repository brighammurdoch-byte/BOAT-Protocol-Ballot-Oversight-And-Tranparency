"use client";

import Link from "next/link";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-10 max-w-3xl mx-auto">
      <header className="flex items-start justify-between gap-4 mb-12">
        <div>
          <p className="text-sm tracking-[0.2em] uppercase text-teal-800/80">BOAT</p>
          <h1 className="text-4xl font-semibold text-stone-900 mt-1">
            Ballot Oversight And Transparency
          </h1>
          <p className="mt-3 text-stone-600 max-w-xl">
            Transparent campus elections on Solana. Create an election, register
            voters, cast ballots, and let anyone recompute the tally from chain.
          </p>
        </div>
        <WalletMultiButton />
      </header>

      <nav className="grid gap-4">
        <Link
          href="/admin"
          className="block border-b border-stone-300 pb-4 hover:text-teal-900"
        >
          <span className="text-xl font-medium">Admin</span>
          <p className="text-stone-600 text-sm mt-1">
            Create election, add candidates, register voter wallets.
          </p>
        </Link>
        <Link
          href="/vote"
          className="block border-b border-stone-300 pb-4 hover:text-teal-900"
        >
          <span className="text-xl font-medium">Vote</span>
          <p className="text-stone-600 text-sm mt-1">
            Connect your wallet and cast or change your ballot.
          </p>
        </Link>
        <Link
          href="/election"
          className="block border-b border-stone-300 pb-4 hover:text-teal-900"
        >
          <span className="text-xl font-medium">Public tally</span>
          <p className="text-stone-600 text-sm mt-1">
            Paste an election PDA and verify results independently.
          </p>
        </Link>
      </nav>
    </main>
  );
}
