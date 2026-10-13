import { createHash } from 'node:crypto';

/**
 * Provider-neutral thread resolution (Phase 2 seams): which conversation does a mail belong to. Pure.
 *
 * The key becomes the conversation's `peer_key` (`t:<key>`), at most {@link THREAD_KEY_MAX} characters.
 *
 *  1. The provider names the thread (Gmail `threadId`): used verbatim, so the conversations Gmail already made keep their key.
 *  2. The provider names a conversation (Microsoft Graph `conversationId`): `c:<id>`, hashed when too long.
 *  3. Headers alone (IMAP): the thread's root Message-ID. `References` starts with the root, so a reply, and its replies, all land on
 *     `m:<hash(root)>` without any lookup. A reply with no `References` names only its parent (`In-Reply-To`): when `known` says which
 *     thread that parent belongs to, that thread wins; otherwise the parent is taken as the root. A mail with neither is its own root.
 *
 * Subjects are never used: two unrelated mails with the same subject stay two conversations.
 */
export const THREAD_KEY_MAX = 128;

export interface ThreadKeyInput {
  /** The provider's own thread id, when it has one (Gmail). */
  providerThreadId?: string | null;
  /** The provider's conversation id, when it has one (Microsoft Graph). */
  conversationId?: string | null;
  /** This mail's Message-ID, with or without brackets. */
  messageId: string;
  inReplyTo?: string | null;
  /** Oldest first. */
  references?: readonly string[];
}

/** Message-ID (as written, any brackets and case) to the thread key already stored for it. */
export type KnownThreadKeys = ReadonlyMap<string, string>;

const bare = (id: string): string => id.trim().replace(/^<|>$/g, '').trim().toLowerCase();
const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 40);

/** A provider's own id, kept verbatim when it fits, otherwise hashed (the prefix tells the two apart). */
function fit(prefix: string, id: string): string {
  const clean = id.trim();
  return prefix.length + clean.length <= THREAD_KEY_MAX
    ? `${prefix}${clean}`
    : `${prefix}h:${hash(clean)}`;
}

export function resolveThreadKey(input: ThreadKeyInput, known?: KnownThreadKeys): string {
  const provider = input.providerThreadId?.trim();
  if (provider) {
    // Verbatim when it fits (Gmail ids are 16 hex characters): the key of a conversation that already exists must not change.
    return provider.length <= THREAD_KEY_MAX ? provider : `h:${hash(provider)}`;
  }
  const conversation = input.conversationId?.trim();
  if (conversation) return fit('c:', conversation);

  const knownBare = new Map<string, string>();
  for (const [id, key] of known ?? []) knownBare.set(bare(id), key);

  const refs = (input.references ?? []).map(bare).filter(Boolean);
  const parent = input.inReplyTo ? bare(input.inReplyTo) : '';
  // A message of a thread we already hold: its newest known ancestor decides.
  for (const id of [parent, ...[...refs].reverse()]) {
    if (!id) continue;
    const hit = knownBare.get(id);
    if (hit) return hit;
  }
  const root = refs[0] || parent || bare(input.messageId);
  return `m:${hash(root)}`;
}
