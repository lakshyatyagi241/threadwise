import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CONVERSATIONS_FACADE,
  MESSAGE_LOG_FACADE,
  type ConversationsFacade,
  type MessageLogFacade,
} from '../../../src/modules/chat-conversations';
import { ChannelAdapterRegistry } from '../../../src/modules/chat-conversations/channel-adapter.registry';
import { MessageLogArchiveService } from '../../../src/modules/chat-conversations/message-log-archive.service';
import { addDays, dayOf } from '../../../src/modules/chat-conversations/message-log-rules';
import type { Tenant } from '../contacts-attributes-tags/support';
import {
  asUser,
  conversationOf,
  messagesOf,
  simChannel,
  simInbound,
  startPipeline,
  until,
  type Pipeline,
  type SimChannel,
} from './pipeline-support';

/**
 * The message delivery log end to end: a provider that accepts a message and then reports it failed (Meta's 131049) is not hidden by
 * Retry, the log shows every event in order, the daily sweep moves events older than 90 days into the archive without losing or
 * duplicating one (and the log still reads them), and an export of a range builds a CSV from the live table and the archive.
 */
let p: Pipeline;
let facade: ConversationsFacade;
let logs: MessageLogFacade;

beforeAll(async () => {
  p = await startPipeline();
  facade = p.h.app.get<ConversationsFacade>(CONVERSATIONS_FACADE);
  logs = p.h.app.get<MessageLogFacade>(MESSAGE_LOG_FACADE);
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

const row = async (uuid: string) =>
  (await p.h.owner.query(`SELECT * FROM messages WHERE uuid = $1`, [uuid])).rows[0] as Record<
    string,
    unknown
  >;
const simAdapter = () => p.h.app.get(ChannelAdapterRegistry).for('simulator');

async function thread(t: Tenant, ch: SimChannel, peer: string) {
  await simInbound(p, t, ch, { from: peer, name: 'Customer', text: 'hello' });
  const conv = await conversationOf(p, t, ch, peer);
  await until('inbound stored', async () => (await messagesOf(p, conv.id as number)).length >= 1);
  return { uuid: conv.uuid as string, id: conv.id as number };
}

/** Sends `/bounce` and waits until the provider has accepted it and then reported it failed. */
async function bounced(t: Tenant, th: { uuid: string }) {
  const { message } = await asUser(t.orgId, t.adminUserId, () =>
    facade.enqueueOutbound({
      conversationId: th.uuid,
      clientMessageId: randomUUID(),
      content: { kind: 'text', body: '/bounce marketing hello' },
    }),
  );
  const failed = await until(
    'accepted, then failed by a receipt',
    async () => {
      const r = await row(message.id);
      return r?.status === 'failed' && r.provider_message_id ? r : undefined;
    },
    20_000,
  );
  return { message, failed };
}

describe('Retry of a message the provider accepted and then failed', () => {
  it('really sends again (a new provider id), keeps the failure visible, and ignores a late receipt of the first send', async () => {
    const t = await p.api.signup('bounce');
    const ch = await simChannel(p, t);
    const th = await thread(t, ch, '919900000101');
    const spy = vi.spyOn(simAdapter(), 'send');

    const { message, failed } = await bounced(t, th);
    expect(failed.failure_code).toBe('ECOSYSTEM_ENGAGEMENT_BLOCKED');
    expect(failed.failure_reason).toContain('#131049');
    const firstId = failed.provider_message_id as string;
    expect(spy).toHaveBeenCalledTimes(1);

    await asUser(t.orgId, t.adminUserId, () => facade.retryOutbound(message.id));
    const again = await until(
      'the second send was reported failed too',
      async () => {
        const r = await row(message.id);
        return r?.status === 'failed' && r.provider_message_id !== firstId ? r : undefined;
      },
      20_000,
    );
    // The adapter was called a second time: the stored answer of the first send was not replayed.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(again.failure_code).toBe('ECOSYSTEM_ENGAGEMENT_BLOCKED');

    // A late `delivered` of the FIRST send must not touch the message that now belongs to the second.
    await p.h.owner.query(`UPDATE messages SET status = 'sent' WHERE uuid = $1`, [message.id]);
    const receipts = p.h.app.get(
      (await import('../../../src/modules/chat-conversations/receipts.service')).ReceiptsService,
    );
    const outcome = await receipts.apply({
      orgId: t.orgId,
      channelUuid: ch.id,
      receipt: {
        providerMessageId: firstId,
        status: 'failed',
        at: new Date().toISOString(),
        errorCode: 'LATE',
      },
    });
    expect(outcome).toBe('ignored');
    expect((await row(message.id)).failure_code).toBe('ECOSYSTEM_ENGAGEMENT_BLOCKED');
  }, 90_000);

  it('the log lists every event in order, with the provider ids, the error and who retried', async () => {
    const t = await p.api.signup('log');
    const ch = await simChannel(p, t);
    const th = await thread(t, ch, '919900000102');
    const { message, failed } = await bounced(t, th);
    const firstId = failed.provider_message_id as string;
    await asUser(t.orgId, t.adminUserId, () => facade.retryOutbound(message.id));
    await until(
      'the second failure',
      async () =>
        Number(
          (
            await p.h.owner.query(
              `SELECT count(*)::int AS n FROM message_events WHERE message_id = $1 AND event = 'failed'`,
              [failed.id],
            )
          ).rows[0].n,
        ) === 2 || undefined,
      20_000,
    );

    const log = await asUser(t.orgId, t.adminUserId, () => logs.messageLog(message.id));
    expect(log).toMatchObject({
      messageId: message.id,
      status: 'failed',
      failureCode: 'ECOSYSTEM_ENGAGEMENT_BLOCKED',
      fromArchive: false,
      expired: false,
    });
    // `sent` twice per send: the pipeline's "the provider accepted it" and the provider's own `sent` receipt.
    expect(log.events.map((e) => `${e.source}:${e.event}`)).toEqual([
      'system:queued',
      'system:attempt',
      'system:sent',
      'provider:sent',
      'provider:failed',
      'system:retry',
      'system:attempt',
      'system:sent',
      'provider:sent',
      'provider:failed',
    ]);
    const firstSent = log.events.find((e) => e.event === 'sent')!;
    expect(firstSent.providerMessageId).toBe(firstId);
    const firstFailure = log.events.find((e) => e.event === 'failed')!;
    expect(firstFailure).toMatchObject({
      errorCode: 'ECOSYSTEM_ENGAGEMENT_BLOCKED',
      applied: true,
    });
    expect(firstFailure.errorMessage).toContain('#131049');
    const retry = log.events.find((e) => e.event === 'retry')!;
    expect(retry.byUserId).not.toBeNull();
    expect(retry.detail).toMatchObject({ manual: true, previousProviderMessageId: firstId });
  }, 90_000);
});

describe('the archive sweep and the export', () => {
  it('moves events older than 90 days to the archive in one step, the log still reads them, and an export has them once', async () => {
    const t = await p.api.signup('arch');
    const ch = await simChannel(p, t);
    const th = await thread(t, ch, '919900000103');
    const { message, failed } = await bounced(t, th);
    const messageId = failed.id as number;

    // Make the message and all its events 100 days old, as the sweep would meet them.
    await p.h.owner.query(
      `UPDATE message_events SET message_created_at = message_created_at - interval '100 days', created_at = created_at - interval '100 days' WHERE message_id = $1`,
      [messageId],
    );
    await p.h.owner.query(
      `UPDATE message_ledger SET message_created_at = message_created_at - interval '100 days' WHERE message_id = $1`,
      [messageId],
    );
    await p.h.owner.query(
      `UPDATE messages SET created_at = created_at - interval '100 days' WHERE id = $1`,
      [messageId],
    );
    const before = Number(
      (
        await p.h.owner.query(
          `SELECT count(*)::int AS n FROM message_events WHERE message_id = $1`,
          [messageId],
        )
      ).rows[0].n,
    );
    expect(before).toBeGreaterThanOrEqual(4);

    const sweep = await p.h.app.get(MessageLogArchiveService).sweep();
    expect(sweep.events).toBeGreaterThanOrEqual(before);

    // Gone from the live table, present once in the archive.
    expect(
      Number(
        (
          await p.h.owner.query(
            `SELECT count(*)::int AS n FROM message_events WHERE message_id = $1`,
            [messageId],
          )
        ).rows[0].n,
      ),
    ).toBe(0);
    const archives = (
      await p.h.owner.query(
        `SELECT event_count, payload_gz FROM message_event_archives WHERE org_id = $1`,
        [t.orgId],
      )
    ).rows as Array<{ event_count: number; payload_gz: Buffer }>;
    expect(archives.reduce((n, a) => n + a.event_count, 0)).toBe(before);
    const lines = archives.flatMap((a) =>
      gunzipSync(a.payload_gz).toString('utf8').split('\n').filter(Boolean),
    );
    expect(lines).toHaveLength(before);

    // Idempotent: a second run finds nothing to move and changes nothing.
    const again = await p.h.app.get(MessageLogArchiveService).sweep();
    expect(again.events).toBe(0);
    expect(
      (
        await p.h.owner.query(
          `SELECT sum(event_count)::int AS n FROM message_event_archives WHERE org_id = $1`,
          [t.orgId],
        )
      ).rows[0].n,
    ).toBe(before);

    // The log of the message reads the archive.
    const log = await asUser(t.orgId, t.adminUserId, () => logs.messageLog(message.id));
    expect(log.fromArchive).toBe(true);
    expect(log.events.map((e) => e.event)).toEqual(['queued', 'attempt', 'sent', 'sent', 'failed']);

    // An export of the last 120 days: queued, built by the worker, ready, with the event lines once each.
    const today = dayOf(new Date());
    const requested = await asUser(t.orgId, t.adminUserId, () =>
      logs.requestExport({ from: addDays(today, -120), to: today }),
    );
    expect(requested.status).toBe('queued');
    // One at a time per workspace.
    await expect(
      asUser(t.orgId, t.adminUserId, () =>
        logs.requestExport({ from: addDays(today, -5), to: today }),
      ),
    ).rejects.toMatchObject({ code: 'MESSAGE_LOG_EXPORT_IN_PROGRESS' });

    const ready = await until(
      'the export is ready',
      async () => {
        const list = await asUser(t.orgId, t.adminUserId, () => logs.listExports());
        const e = list.data.find((x) => x.id === requested.id);
        if (e?.status === 'failed') throw new Error(`export failed: ${e.error}`);
        return e?.status === 'ready' ? e : undefined;
      },
      60_000,
    );
    expect(ready.rowCount).toBe(before);
    expect(ready.expiresAt).not.toBeNull();

    const { stream, fileName } = await asUser(t.orgId, t.adminUserId, () =>
      logs.downloadExport(requested.id),
    );
    expect(fileName).toMatch(/^message-log-.*\.csv$/);
    const csv = (await streamText(stream)).replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(csv[0]).toContain('Time (UTC),Message ID,Recipient');
    const dataLines = csv.slice(1).filter((l) => l.includes(message.id));
    expect(dataLines).toHaveLength(before);
    expect(dataLines.some((l) => l.includes('ECOSYSTEM_ENGAGEMENT_BLOCKED'))).toBe(true);
    expect(dataLines[0]).toContain('919900000103');
  }, 120_000);

  it('refuses a range that is backwards, in the future or older than a year', async () => {
    const t = await p.api.signup('range');
    const today = dayOf(new Date());
    const bad = (from: string, to: string) =>
      expect(
        asUser(t.orgId, t.adminUserId, () => logs.requestExport({ from, to })),
      ).rejects.toMatchObject({ code: 'MESSAGE_LOG_EXPORT_RANGE_INVALID' });
    await bad(today, addDays(today, -1));
    await bad(today, addDays(today, 1));
    await bad(addDays(today, -400), today);
  });
});

async function streamText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}
