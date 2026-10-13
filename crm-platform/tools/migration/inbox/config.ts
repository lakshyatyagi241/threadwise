import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSecretEntry, looksLikeToken, sha256 } from '../util';

/**
 * The operator-supplied, NON-SECRET channel map: Waboo `botid` -> the WhatsApp number the inbox thread lives on.
 *
 *   { "<botid>": { "kind": "whatsapp_cloud", "externalId": "<phone number id>", "displayAddress": "+91 98xxx", "name": "ISKM main" } }
 *
 * It is NEVER read from `chatbot_misc_config` (that collection holds the access token). The file is checked for credential-looking keys
 * and values and refused if it has any. `externalId` MUST be the phone number id the live WABA connection will report: the live path
 * finds a thread by (channel, peer), and `WabaChannelLinkService` adopts a channel by (org, kind, external_id) or, when the number was
 * released, by the digits of `display_address`. A different id here splits every customer into two threads at cutover (risk R1).
 */
export interface ChannelEntry {
  kind: 'whatsapp_cloud';
  externalId: string;
  displayAddress: string | null;
  name: string;
}
export type ChannelMap = Record<string, ChannelEntry>;

export class InboxConfigError extends Error {
  constructor(message: string) {
    super(`INBOX_CONFIG: ${message}`);
  }
}

const ENTRY_KEYS = new Set(['kind', 'externalId', 'displayAddress', 'name']);

export function parseChannelMap(raw: unknown): ChannelMap {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new InboxConfigError('the channel map must be a JSON object keyed by Waboo botid');
  const out: ChannelMap = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0)
    throw new InboxConfigError(
      'the channel map is empty: every chat message would be quarantined NO_CHANNEL',
    );
  for (const [botid, e] of entries) {
    if (botid.trim() === '') throw new InboxConfigError('a channel map key (botid) is empty');
    if (e === null || typeof e !== 'object' || Array.isArray(e))
      throw new InboxConfigError(`channel map entry "${botid}" must be an object`);
    const o = e as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (!ENTRY_KEYS.has(k))
        throw new InboxConfigError(
          `channel map entry "${botid}" has an unknown key "${k}" (allowed: ${[...ENTRY_KEYS].join(', ')}); only non-secret values belong in this file`,
        );
      if (isSecretEntry(k, v) || (typeof v === 'string' && looksLikeToken(v)))
        throw new InboxConfigError(
          `channel map entry "${botid}", key "${k}" looks like a credential: this file must hold non-secret values only`,
        );
    }
    if (o.kind !== 'whatsapp_cloud')
      throw new InboxConfigError(
        `channel map entry "${botid}": kind must be "whatsapp_cloud" (the only kind this tool supports)`,
      );
    const externalId = typeof o.externalId === 'string' ? o.externalId.trim() : '';
    if (!/^\d{5,32}$/.test(externalId))
      throw new InboxConfigError(
        `channel map entry "${botid}": externalId must be the WhatsApp phone number id (5 to 32 digits)`,
      );
    let displayAddress: string | null = null;
    if (o.displayAddress !== undefined && o.displayAddress !== null) {
      const d = typeof o.displayAddress === 'string' ? o.displayAddress.trim() : '';
      if (!/^\+?[0-9 ()\-.]{5,40}$/.test(d) || d.replace(/\D/g, '').length < 5)
        throw new InboxConfigError(
          `channel map entry "${botid}": displayAddress must look like a phone number`,
        );
      displayAddress = d;
    }
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (name === '' || name.length > 120)
      throw new InboxConfigError(
        `channel map entry "${botid}": name is required (1..120 characters)`,
      );
    out[botid] = { kind: 'whatsapp_cloud', externalId, displayAddress, name };
  }
  // one number, one channel: two botids on the same number must agree on everything else
  const byNumber = new Map<string, ChannelEntry>();
  for (const [botid, e] of Object.entries(out)) {
    const seen = byNumber.get(e.externalId);
    if (seen && (seen.displayAddress !== e.displayAddress || seen.name !== e.name))
      throw new InboxConfigError(
        `botid "${botid}" shares the phone number id of another botid but names it differently: one number is one channel`,
      );
    byNumber.set(e.externalId, e);
  }
  return out;
}

export interface InboxOptions {
  /** The parsed map (tests), else the file below. */
  channelMap?: ChannelMap;
  /** Default: <dumps>/<client>/channel-map.json */
  channelMapPath?: string;
  /** Q3: load the chats of contacts that were soft-deleted at the source (contact_id NULL) instead of excluding them. */
  keepDeletedContactChats?: boolean;
  /** Q4: 'waboo' keeps Open/Closed; 'closed' imports every thread closed (the Open tab is not flooded by old chats). */
  threadStatus?: 'waboo' | 'closed';
  /** Set conversations.assignee_user_id from the newest Waboo agent. Default true. */
  assignAgents?: boolean;
  /** WhatsApp customer-service window used for window_expires_at. Default 24. */
  windowHours?: number;
}

export interface InboxSettings {
  map: ChannelMap;
  mapSha256: string;
  keepDeletedContactChats: boolean;
  threadStatus: 'waboo' | 'closed';
  assignAgents: boolean;
  windowHours: number;
}

export const DEFAULT_MAP_FILE = 'channel-map.json';

/** The map and flags, or a loud InboxConfigError. Called before anything is written. */
export function resolveInbox(
  opts: InboxOptions | undefined,
  dumpsDir: string,
  client: string,
): InboxSettings {
  const o = opts ?? {};
  let map = o.channelMap;
  if (!map) {
    const file = o.channelMapPath ?? join(dumpsDir, client, DEFAULT_MAP_FILE);
    if (!existsSync(file))
      throw new InboxConfigError(
        `the dump of ${client} has chathistory but there is no channel map (${file}). Write it by hand (botid -> phone number id, see README "Stage 2: inbox") and pass --channel-map <file>; this tool never reads chatbot_misc_config`,
      );
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      throw new InboxConfigError(`the channel map ${file} is not valid JSON`);
    }
    map = parseChannelMap(raw);
  }
  const windowHours = o.windowHours ?? 24;
  if (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > 24 * 31)
    throw new InboxConfigError('windowHours must be a whole number of hours (1..744)');
  if (o.threadStatus !== undefined && o.threadStatus !== 'waboo' && o.threadStatus !== 'closed')
    throw new InboxConfigError('threadStatus must be "waboo" or "closed"');
  return {
    map,
    mapSha256: sha256(JSON.stringify(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : 1)))),
    keepDeletedContactChats: Boolean(o.keepDeletedContactChats),
    threadStatus: o.threadStatus ?? 'waboo',
    assignAgents: o.assignAgents !== false,
    windowHours,
  };
}
