import { isBuiltInVariable, type SavedReplyScope, type VariableLookup } from '@crm/contracts';
import { resolveToken, type MergeContact, type MergeContext } from '../../crm';

export const SAVED_REPLY_MANAGE = 'inbox.savedreply.manage';

/** The row facts the rules below need. `userId` is the owner of a personal reply, null for a shared one. */
export interface ReplyOwnership {
  userId: number | null;
}

export interface ReplyCaller {
  userId: number;
  /** Holds `inbox.savedreply.manage`. */
  canManage: boolean;
}

export const scopeOf = (row: ReplyOwnership): SavedReplyScope =>
  row.userId === null ? 'shared' : 'mine';

/**
 * A reply is visible to everyone for a shared one and to its owner for a personal one (Reference's `accessibleBy`). Anything else is a
 * 404, so nobody learns that a colleague keeps a personal reply under a shortcut.
 */
export const isVisibleTo = (row: ReplyOwnership, caller: ReplyCaller): boolean =>
  row.userId === null || row.userId === caller.userId;

/**
 * Who may edit or delete a visible reply. A shared reply needs the manage right (Reference let ANY member change a shared reply: a
 * recorded fix), a personal reply is its owner's whether or not they still hold the right (as in Reference).
 */
export const canChange = (row: ReplyOwnership, caller: ReplyCaller): boolean =>
  row.userId === null ? caller.canManage : row.userId === caller.userId;

/** Whether the reply may be inserted on a channel of this kind (no restriction = everywhere). */
export const allowedOnChannel = (channelKinds: readonly string[], kind: string): boolean =>
  channelKinds.length === 0 || channelKinds.includes(kind);

/** Postgres unique violation, however the driver wrapped it. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/** `Amira Khan` to `Amira`. */
const firstWord = (name: string | null | undefined): string =>
  (name ?? '').trim().split(/\s+/)[0] ?? '';

/** A phone-looking value for `{{device_phone}}`; a mailbox address or a page id is not one. */
const looksLikePhone = (v: string | null | undefined): v is string =>
  typeof v === 'string' && /^\+?[\d\s()-]{6,}$/.test(v.trim());

/** What the conversation, the agent and the workspace contribute to a reply's variables. */
export interface RenderFacts {
  contact: MergeContact | undefined;
  base: Omit<MergeContext, 'contact'>;
  /** The conversation's own display name, used when the thread has no contact yet. */
  peerName: string | null;
  agentName: string | null;
  /** The channel the conversation runs on: Reference's "device". */
  deviceName: string | null;
  deviceAddress: string | null;
}

/**
 * The variable lookup for one conversation (see `renderSavedReply`). Agent, workspace and device values are the server's; contact values
 * and custom attributes go through the same resolver as templates and broadcasts, so one name means one value everywhere. A name that is
 * neither built in nor an active custom attribute is `undefined` (unknown, flagged as a typo); a real variable the contact has no value
 * for is `''` (flagged as empty). Nothing here ever invents a value.
 */
export function buildLookup(f: RenderFacts): VariableLookup {
  const ctx: MergeContext = { ...f.base, contact: f.contact };
  return (key) => {
    switch (key) {
      case 'agent_name':
        return f.agentName ?? '';
      case 'agent_first_name':
        return firstWord(f.agentName);
      case 'workspace_name':
        return f.base.system.businessName;
      case 'device_name':
        return f.deviceName ?? '';
      case 'device_phone':
        return looksLikePhone(f.deviceAddress) ? f.deviceAddress.trim() : '';
      default:
        break;
    }
    const resolved = resolveToken(key, ctx);
    if (resolved.source !== 'unresolved') return resolved.value;
    // A thread that has no contact yet still has the name the customer wrote under.
    if (key === 'name' && f.peerName) return f.peerName;
    if (key === 'first_name' && f.peerName) return firstWord(f.peerName);
    if (isBuiltInVariable(key) || f.base.attributeDefaults.has(key)) return '';
    return undefined;
  };
}
