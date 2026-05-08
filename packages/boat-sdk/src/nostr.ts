import {
  finalizeEvent,
  generateSecretKey,
  type EventTemplate,
} from "nostr-tools";
import { SimplePool, type NostrEvent } from "nostr-tools";
import { BOAT_ELECTION_TAG } from "./constants";

export type ForumPost = {
  id: string;
  pubkey: string;
  created_at: number;
  content: string;
};

export async function listForumPosts(
  relayUrls: string[],
  electionBase58: string
): Promise<ForumPost[]> {
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(relayUrls, {
      kinds: [1],
      "#boat_election": [electionBase58],
      limit: 50,
    });
    const posts = events
      .sort((a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at)
      .map((e: NostrEvent) => ({
        id: e.id,
        pubkey: e.pubkey,
        created_at: e.created_at,
        content: e.content,
      }));
    return posts;
  } finally {
    pool.close(relayUrls);
  }
}

export async function publishForumPost(
  relayUrls: string[],
  secretKey: Uint8Array,
  electionBase58: string,
  body: string
): Promise<string> {
  const pool = new SimplePool();
  try {
    const template: EventTemplate = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [[BOAT_ELECTION_TAG, electionBase58]],
      content: body,
    };
    const evt = finalizeEvent(template, secretKey);
    const pubs = await pool.publish(relayUrls, evt);
    await Promise.allSettled(pubs);
    return evt.id;
  } finally {
    pool.close(relayUrls);
  }
}

export function generateEphemeralForumSecretKey(): Uint8Array {
  return generateSecretKey();
}

