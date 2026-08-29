import { PublicKey } from "@solana/web3.js";

/** Seconds reserved so Phantom can finish create + batched add-candidate approvals. */
export const CANDIDATE_SETUP_LEAD_SEC = 120;

export function computeElectionWindow(opts: {
  startInMin: number;
  durationHours: number;
  nowMs?: number;
  candidateCount?: number;
  setupLeadSec?: number;
}): { start: number; end: number } {
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const startInMin = Number.isFinite(opts.startInMin) ? opts.startInMin : 0;
  const durationHours = Number.isFinite(opts.durationHours)
    ? opts.durationHours
    : 1;
  const requested = Math.max(0, startInMin) * 60;
  const setup =
    (opts.candidateCount ?? 0) > 0
      ? (opts.setupLeadSec ?? CANDIDATE_SETUP_LEAD_SEC)
      : 0;
  const start = nowSec + Math.max(requested, setup);
  const end = start + Math.max(1, durationHours) * 3600;
  return { start, end };
}

/** Split / dedupe voter pubkeys from comma, whitespace, or newline lists. */
export function parseVoterKeys(raw: string): PublicKey[] {
  const seen = new Set<string>();
  const out: PublicKey[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const s = part.trim();
    if (!s) continue;
    const key = new PublicKey(s);
    const id = key.toBase58();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(key);
  }
  return out;
}

export function parseCandidateLabels(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function totalsWithAllCandidates(
  totalsByCandidate: Record<string, bigint>,
  labels: string[]
): { label: string; weight: bigint }[] {
  const map: Record<string, bigint> = { ...totalsByCandidate };
  for (const label of labels) {
    if (!(label in map)) map[label] = 0n;
  }
  return Object.entries(map)
    .map(([label, weight]) => ({ label, weight }))
    .sort((a, b) =>
      a.weight === b.weight ? a.label.localeCompare(b.label) : a.weight > b.weight ? -1 : 1
    );
}
