import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GoogleMailError,
  type GmailHistoryPage,
  type GmailListPage,
  type GmailMessage,
  type NormalisedMail,
} from '../../../src/infra/providers/channel-email';
import { MailDriverError } from '../../../src/modules/channel-email/drivers/mail-driver';
import { MailDriverRegistry } from '../../../src/modules/channel-email/drivers/mail-driver.registry';
import { GoogleMailDriver } from '../../../src/modules/channel-email/drivers/google-mail.driver';
import { MailboxUnavailableError } from '../../../src/modules/channel-email/mail-errors';
import { MailSyncService } from '../../../src/modules/channel-email/mail-sync.service';
import type { MailboxRow } from '../../../src/modules/channel-email/mailboxes.repository';

const mailbox = (over: Partial<MailboxRow> = {}): MailboxRow => ({
  id: 5,
  uuid: 'mb-uuid',
  provider: 'google',
  address: 'support@acme.test',
  accountSub: 'sub',
  displayName: 'Support',
  status: 'connected',
  scope: 'shared',
  ownerUserId: null,
  refreshTokenEnc: 'v1:x',
  accessTokenEnc: null,
  accessTokenExpiresAt: null,
  scopes: null,
  connectionEnc: null,
  connectionPublic: null,
  syncCursor: null,
  pushState: null,
  sendLimitPerHour: null,
  lastSyncedAt: null,
  lastError: null,
  connectedBy: null,
  connectedAt: new Date(),
  channelUuid: 'chan-uuid',
  rowVersion: 1,
  ...over,
});

interface Saved {
  cursor: Record<string, unknown> | null;
  syncedAt: Date | null;
  error: string | null;
  status?: string;
}

/** A Gmail that answers from lists the test sets, and a sync service wired to fakes of everything else. */
function rig(row: MailboxRow, opts: { featureOn?: boolean } = {}) {
  const saves: Saved[] = [];
  const stored = new Set<string>();
  const fetched: string[] = [];
  const ingested: Array<{ id: string; quiet: boolean }> = [];
  const state = {
    profileHistory: '900',
    listPages: [] as GmailListPage[],
    historyPages: [] as Array<GmailHistoryPage | GoogleMailError>,
    listCalls: 0,
    historyCalls: [] as Array<{ startHistoryId: string; pageToken?: string | null }>,
    failIngest: new Set<string>(),
    getMessageError: null as GoogleMailError | null,
  };
  const gmail = {
    getProfile: async () => ({
      emailAddress: row.address,
      historyId: state.profileHistory,
      messagesTotal: 1,
    }),
    listMessages: async () =>
      state.listPages[state.listCalls++] ?? { messages: [], nextPageToken: null },
    listHistory: async (_t: string, o: { startHistoryId: string; pageToken?: string | null }) => {
      state.historyCalls.push(o);
      const next = state.historyPages.shift();
      if (next instanceof GoogleMailError) throw next;
      return next ?? { added: [], historyId: null, lastRecordId: null, nextPageToken: null };
    },
    getMessage: async (_t: string, id: string): Promise<GmailMessage> => {
      fetched.push(id);
      if (state.getMessageError) throw state.getMessageError;
      return { id, threadId: `t-${id}` };
    },
  };
  const registry = new MailDriverRegistry();
  new GoogleMailDriver(gmail as never, {} as never, {} as never, registry).onModuleInit();
  const svc = new MailSyncService(
    { txAs: async (_t: unknown, fn: (tx: object) => unknown) => fn({}) } as never,
    {
      messageStored: async (_tx: unknown, _o: number, _c: string, id: string) => stored.has(id),
      saveSync: async (_tx: unknown, _o: number, _id: number, input: Saved) =>
        void saves.push(input),
    } as never,
    {
      load: async () => row,
      withAccess: async (_o: number, _u: string, fn: (a: unknown, r: MailboxRow) => unknown) =>
        fn({ kind: 'oauth', accessToken: 'tok' }, row),
      markNeedsReauth: async () => undefined,
    } as never,
    registry,
    {
      store: async (_o: number, _m: unknown, mail: NormalisedMail, o: { quiet: boolean }) => {
        if (state.failIngest.has(mail.providerMessageId)) throw new Error('boom');
        ingested.push({ id: mail.providerMessageId, quiet: o.quiet });
        return 'stored' as const;
      },
    } as never,
    { sync: async () => 'chan-uuid' } as never,
    { isEnabled: async () => opts.featureOn ?? true } as never,
  );
  return { svc, saves, stored, fetched, ingested, state };
}

const page = (ids: string[], next: string | null = null): GmailListPage => ({
  messages: ids.map((id) => ({ id, threadId: `t-${id}` })),
  nextPageToken: next,
});
const added = (ids: string[], labelIds = ['INBOX']) =>
  ids.map((id) => ({ id, threadId: `t-${id}`, labelIds }));

const saved = ENV_KEYS();
function ENV_KEYS() {
  return ['MAIL_SYNC_MAX_MESSAGES', 'MAIL_SYNC_MAX_PAGES'].map((k) => [k, process.env[k]] as const);
}
beforeEach(() => {
  delete process.env.MAIL_SYNC_MAX_MESSAGES;
  delete process.env.MAIL_SYNC_MAX_PAGES;
});
afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('TW-MAIL-021: the first sync is a quiet backfill', () => {
  it('lists the last days, stores them oldest first as history and takes the cursor from before the listing', async () => {
    const r = rig(mailbox());
    r.state.listPages = [page(['c', 'b'], 'p2'), page(['a'])];
    const res = await r.svc.sync(1, 'mb-uuid');
    expect(res).toMatchObject({ status: 'synced', mode: 'backfill', stored: 3, leftover: false });
    expect(r.ingested).toEqual([
      { id: 'a', quiet: true },
      { id: 'b', quiet: true },
      { id: 'c', quiet: true },
    ]);
    expect(r.saves.at(-1)).toMatchObject({
      cursor: { historyId: '900' },
      error: null,
      status: 'connected',
    });
    expect(r.saves.at(-1)!.syncedAt).toBeInstanceOf(Date);
  });

  it('with more new mail than the cap, the cursor stays and the next run continues', async () => {
    process.env.MAIL_SYNC_MAX_MESSAGES = '2';
    const r = rig(mailbox());
    r.state.listPages = [page(['d', 'c', 'b', 'a'])];
    const res = await r.svc.sync(1, 'mb-uuid');
    expect(res).toMatchObject({ stored: 2, leftover: true });
    expect(r.ingested.map((i) => i.id)).toEqual(['a', 'b']);
    expect(r.saves.at(-1)!.cursor).toBeNull();
  });
});

describe('TW-MAIL-021: incremental sync from the history cursor', () => {
  it('stores what was added as live mail and moves the cursor to the mailbox history id', async () => {
    const r = rig(mailbox({ syncCursor: { historyId: '500' } }));
    r.state.historyPages = [
      { added: added(['x', 'y']), historyId: '610', lastRecordId: '609', nextPageToken: null },
    ];
    const res = await r.svc.sync(1, 'mb-uuid');
    expect(res).toMatchObject({ mode: 'history', stored: 2 });
    expect(r.state.historyCalls).toEqual([{ startHistoryId: '500', pageToken: null }]);
    expect(r.ingested).toEqual([
      { id: 'x', quiet: false },
      { id: 'y', quiet: false },
    ]);
    expect(r.saves.at(-1)!.cursor).toEqual({ historyId: '610' });
  });

  it('follows every page, and a stopped-early run resumes after the last record it read', async () => {
    process.env.MAIL_SYNC_MAX_PAGES = '2';
    const r = rig(mailbox({ syncCursor: { historyId: '500' } }));
    r.state.historyPages = [
      { added: added(['a']), historyId: '700', lastRecordId: '520', nextPageToken: 'n1' },
      { added: added(['b']), historyId: '700', lastRecordId: '540', nextPageToken: 'n2' },
    ];
    const res = await r.svc.sync(1, 'mb-uuid');
    expect(res).toMatchObject({ stored: 2, leftover: false });
    expect(r.state.historyCalls.map((c) => c.pageToken)).toEqual([null, 'n1']);
    expect(r.saves.at(-1)!.cursor).toEqual({ historyId: '540' });
  });

  it('a message already stored is not downloaded again (a redelivery or an overlapping run)', async () => {
    const r = rig(mailbox({ syncCursor: { historyId: '500' } }));
    r.stored.add('x');
    r.state.historyPages = [
      { added: added(['x', 'y']), historyId: '610', lastRecordId: '609', nextPageToken: null },
    ];
    const res = await r.svc.sync(1, 'mb-uuid');
    expect(res).toMatchObject({ stored: 1, duplicates: 1 });
    expect(r.fetched).toEqual(['y']);
  });

  it('the same id twice in one run is handled once; spam and drafts are never downloaded', async () => {
    const r = rig(mailbox({ syncCursor: { historyId: '500' } }));
    r.state.historyPages = [
      {
        added: [
          ...added(['x']),
          ...added(['x']),
          ...added(['s'], ['INBOX', 'SPAM']),
          ...added(['d'], ['DRAFT']),
        ],
        historyId: '610',
        lastRecordId: '609',
        nextPageToken: null,
      },
    ];
    const res = await r.svc.sync(1, 'mb-uuid');
    expect(res).toMatchObject({ stored: 1, skipped: 2 });
    expect(r.fetched).toEqual(['x']);
  });

  it('a cursor Gmail no longer keeps (404) is repaired: the last days are re-read quietly and a new cursor taken', async () => {
    const r = rig(mailbox({ syncCursor: { historyId: '5' } }));
    r.state.historyPages = [new GoogleMailError('not_found', 404, 'notFound')];
    r.state.listPages = [page(['b', 'a'])];
    const res = await r.svc.sync(1, 'mb-uuid');
    expect(res).toMatchObject({ mode: 'repair', stored: 2 });
    expect(r.ingested.every((i) => i.quiet)).toBe(true);
    expect(r.saves.at(-1)!.cursor).toEqual({ historyId: '900' });
  });
});

describe('TW-MAIL-028: failures are recorded, not lost', () => {
  it('an outage is recorded on the mailbox and rethrown so the queue retries with backoff', async () => {
    const r = rig(mailbox({ syncCursor: { historyId: '500' } }));
    r.state.historyPages = [new GoogleMailError('server', 503, 'backendError')];
    await expect(r.svc.sync(1, 'mb-uuid')).rejects.toBeInstanceOf(MailDriverError);
    expect(r.saves.at(-1)).toMatchObject({
      status: 'error',
      error: 'Google did not answer. Syncing will retry shortly.',
    });
  });

  it('a refusal that retrying cannot fix is recorded and the job ends (no retry storm)', async () => {
    const r = rig(mailbox({ syncCursor: { historyId: '500' } }));
    r.state.historyPages = [new GoogleMailError('forbidden', 403, 'insufficientPermissions')];
    const res = await r.svc.sync(1, 'mb-uuid');
    expect(res.status).toBe('synced');
    expect(r.saves.at(-1)).toMatchObject({ status: 'error' });
    expect(r.saves.at(-1)!.error).toMatch(/Reconnect/);
  });

  it('a mail that cannot be stored is counted and skipped; the cursor still advances', async () => {
    const r = rig(mailbox({ syncCursor: { historyId: '500' } }));
    r.state.failIngest.add('bad');
    r.state.historyPages = [
      { added: added(['bad', 'good']), historyId: '610', lastRecordId: '609', nextPageToken: null },
    ];
    const res = await r.svc.sync(1, 'mb-uuid');
    expect(res).toMatchObject({ stored: 1, failed: 1 });
    expect(r.saves.at(-1)).toMatchObject({
      cursor: { historyId: '610' },
      error: '1 message could not be stored and were skipped.',
      status: 'connected',
    });
  });

  it('a message deleted since it was listed is simply gone', async () => {
    const r = rig(mailbox({ syncCursor: { historyId: '500' } }));
    r.state.getMessageError = new GoogleMailError('not_found', 404, 'notFound');
    r.state.historyPages = [
      { added: added(['gone']), historyId: '610', lastRecordId: '609', nextPageToken: null },
    ];
    expect(await r.svc.sync(1, 'mb-uuid')).toMatchObject({ stored: 0, skipped: 1 });
  });
});

describe('TW-MAIL-030: nothing is synced when it should not be', () => {
  it('a workspace without the add-on is not synced and nothing is written', async () => {
    const r = rig(mailbox({ syncCursor: { historyId: '500' } }), { featureOn: false });
    expect(await r.svc.sync(1, 'mb-uuid')).toEqual({ status: 'skipped', reason: 'feature_off' });
    expect(r.saves).toHaveLength(0);
    expect(r.state.historyCalls).toHaveLength(0);
  });

  it('a disconnected mailbox and one that needs reconnecting are skipped', async () => {
    expect(await rig(mailbox({ status: 'disconnected' })).svc.sync(1, 'mb-uuid')).toEqual({
      status: 'skipped',
      reason: 'disconnected',
    });
    expect(await rig(mailbox({ status: 'needs_reauth' })).svc.sync(1, 'mb-uuid')).toEqual({
      status: 'skipped',
      reason: 'needs_reauth',
    });
  });

  it('a mailbox that became unusable mid-run (refresh refused) ends the run quietly', async () => {
    const r = rig(mailbox({ syncCursor: { historyId: '500' } }));
    (r.svc as unknown as { tokens: { withAccess: () => never } }).tokens.withAccess = () => {
      throw new MailboxUnavailableError('needs_reauth');
    };
    expect(await r.svc.sync(1, 'mb-uuid')).toEqual({ status: 'skipped', reason: 'needs_reauth' });
  });
});
